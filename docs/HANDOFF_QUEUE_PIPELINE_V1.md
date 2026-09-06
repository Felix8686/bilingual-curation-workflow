# Hermes Handoff — Queue Pipeline v1

目标：验证 `feat/queue-pipeline-v1` 能在 Windows 本机通过 Wrangler/Miniflare 同时模拟 Cloudflare D1 与 Queues，实现批次 enqueue 后自动异步消费，并验证 D1 幂等、重试和重启持久化。

## 严格边界

- 不修改 `main`。
- 不合并 PR #2 / #3 / #4 / #5 / #6。
- 不修改产品代码；发现问题只回报证据。
- 不创建远端 Queue。
- 不创建或修改远端/生产 D1。
- 不部署 Worker。
- 不使用真实付费 AI；继续使用仓库内置 mock AI provider。
- 所有 D1 操作必须显式使用 `--local` 和本阶段隔离的 `--persist-to`。

## 1. 同步分支

```powershell
cd D:\Projects\bilingual-curation-workflow
git fetch origin
git checkout feat/queue-pipeline-v1
git pull --ff-only origin feat/queue-pipeline-v1
git rev-parse HEAD
git status --short
```

记录 HEAD。

## 2. 静态检查与单测

```powershell
npm install
npm run check
```

要求：

- typecheck 0 error。
- 所有既有测试全绿。
- `tests/queue.test.ts` 至少覆盖：
  1. 同一个 pending item 只能 enqueue 一次；
  2. duplicate Queue delivery 不会重复执行 workflow；
  3. 第 1/2 次失败会 retry 且 item 回到 pending；
  4. 第 3 次仍失败会落为 failed。

## 3. 准备隔离本地状态

停止旧 Worker 后：

```powershell
Remove-Item -Recurse -Force .wrangler\queue-pipeline-v1 -ErrorAction SilentlyContinue
```

应用全部本地 migration：

```powershell
npx wrangler d1 migrations apply bilingual-curation-workflow --local --persist-to .wrangler/queue-pipeline-v1
```

必须看到 `0001_batch_pipeline.sql` 与 `0002_queue_pipeline.sql` 均成功应用。

核对 queued_at：

```powershell
npx wrangler d1 execute bilingual-curation-workflow --local --persist-to .wrangler/queue-pipeline-v1 --command "PRAGMA table_info(batch_items);"
```

要求包含 `queued_at` 列。

## 4. 启动 mock AI

PowerShell A：

```powershell
npm run mock:ai
```

应看到：

```text
Mock AI provider listening on http://127.0.0.1:8790/v1
```

仓库根目录创建 `.dev.vars`：

```text
AI_BASE_URL=http://127.0.0.1:8790/v1
AI_API_KEY=local-test-only
AI_MODEL=mock-model
```

`.dev.vars` 已被 Git 忽略。

## 5. 启动同时带 D1 + Queue 的本地 Worker

PowerShell B：

```powershell
npx wrangler dev --local --persist-to .wrangler/queue-pipeline-v1
```

Wrangler 输出必须显示本地 bindings 至少包含：

- D1 `DB`
- Queue producer `BATCH_QUEUE`
- Queue consumer `bilingual-curation-workflow-batches`

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

要求 `ok = true`。

## 6. 创建并异步运行 2 项成功批次

PowerShell C：

```powershell
$body = @{
  items = @(
    @{
      theme = "love"
      hook = "关于爱情的英文片段"
      literatureQueries = @("Pride and Prejudice")
      sourceKinds = @("public_domain_literature")
      limitPerSource = 1
      maxSelected = 1
    },
    @{
      theme = "marriage"
      hook = "关于婚姻的英文片段"
      literatureQueries = @("Pride and Prejudice")
      sourceKinds = @("public_domain_literature")
      limitPerSource = 1
      maxSelected = 1
    }
  )
} | ConvertTo-Json -Depth 10

$batch = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/batches -ContentType "application/json" -Body $body
$batchId = $batch.id
$batch | ConvertTo-Json -Depth 14
```

然后 enqueue：

```powershell
$enqueue = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/batches/$batchId/enqueue" -ContentType "application/json" -Body '{}'
$enqueue | ConvertTo-Json -Depth 14
```

要求：

- HTTP 202。
- `enqueuedItemIds` 恰好 2 条。
- 两个 item 都出现非空 `queuedAt`。
- 不再调用 `/run`。

轮询：

```powershell
for ($i = 0; $i -lt 30; $i++) {
  $state = Invoke-RestMethod "http://127.0.0.1:8787/api/batches/$batchId"
  $state | ConvertTo-Json -Depth 14
  if ($state.status -eq "completed") { break }
  Start-Sleep -Seconds 2
}
```

最终必须：

- `status = completed`
- `completedCount = 2`
- `failedCount = 0`
- `pendingCount = 0`
- 两项都保存 `publicationDraft`
- 英文原文仍来自抓取层，未出现 `THIS MUST NEVER REPLACE SOURCE ORIGINAL`

## 7. duplicate enqueue 防重

对已经 completed 的同一批次再次：

```powershell
$again = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/batches/$batchId/enqueue" -ContentType "application/json" -Body '{}'
$again | ConvertTo-Json -Depth 14
```

要求：

- `enqueuedItemIds` 为空。
- completedCount 仍为 2。
- 已保存 publicationDraft 不变化。

## 8. Worker 重启后持久化

停止 Worker，保留 `.wrangler/queue-pipeline-v1`，然后重新：

```powershell
npx wrangler dev --local --persist-to .wrangler/queue-pipeline-v1
```

重新 GET：

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/batches/$batchId" | ConvertTo-Json -Depth 14
```

要求批次仍为 completed，两条结果完整存在。

## 9. 真实本地 Queue 重试 / 最终失败

创建一个仅 1 项、故意无法获取候选的批次：

```powershell
$badBody = @{
  items = @(
    @{
      theme = "queue-retry-test"
      literatureQueries = @("zzzz-no-such-gutenberg-work-92837465")
      sourceKinds = @("public_domain_literature")
      limitPerSource = 1
      maxSelected = 1
    }
  )
} | ConvertTo-Json -Depth 10

$bad = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/batches -ContentType "application/json" -Body $badBody
$badId = $bad.id
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/batches/$badId/enqueue" -ContentType "application/json" -Body '{}'
```

观察 Worker 日志并轮询最多 90 秒：

```powershell
for ($i = 0; $i -lt 45; $i++) {
  $state = Invoke-RestMethod "http://127.0.0.1:8787/api/batches/$badId"
  if ($state.status -eq "failed") { break }
  Start-Sleep -Seconds 2
}
$state | ConvertTo-Json -Depth 14
```

要求：

- Queue 至少发生重试，而不是第一次失败立即永久失败。
- 最终 item = `failed`。
- batch = `failed`。
- error 字段保存最后失败原因。
- Worker 不崩溃。

如果该特殊搜索词意外仍能被 Gutendex 模糊匹配到候选，请换一个更随机的不存在字符串重新测试；不要修改产品代码。

## 10. 手动 `/run` 兜底回归

新建一个不 enqueue 的单项批次，然后执行：

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/batches/<NEW_BATCH_ID>/run" -ContentType "application/json" -Body '{"maxItems":1}'
```

要求原第五阶段手动执行路径仍可完成，证明 Queue 并未删除故障兜底能力。

## 11. 工作区

停止 Worker 和 mock AI，确认 8787 / 8790 无残留监听，然后：

```powershell
git status --short
```

必须为空；`.dev.vars`、`.wrangler/`、`node_modules/` 均应被忽略。

## PASS 标准

全部满足才 PASS：

1. `npm run check` 全绿。
2. 0001 + 0002 migration 仅在隔离本地 D1 成功应用。
3. 本地 Wrangler 同时模拟 D1 + Queue producer + consumer。
4. `/enqueue` 后不调用 `/run` 也能自动完成 2 项批次。
5. duplicate enqueue 不重复生产。
6. Queue 单测证明 duplicate delivery 幂等。
7. Queue 本地 E2E 证明失败会重试，达到最终尝试后才 failed。
8. Worker 重启后 D1 结果仍存在。
9. 手动 `/run` fallback 不回归。
10. 最终 `git status --short` 为空，端口无残留。

## 回报格式

只回报：

1. 总体：PASS / FAIL
2. HEAD SHA
3. Node / npm / Wrangler 版本
4. `npm run check`：typecheck + Test Files / Tests 数量
5. migrations：0001 / 0002 是否都仅 local PASS
6. Wrangler local bindings：DB / producer / consumer 是否识别
7. 成功批次 E2E：batchId、enqueue 数量、最终状态、completed/failed/pending、publicationDraft 是否存在
8. duplicate enqueue：是否 0 条、是否无重复执行
9. duplicate delivery 幂等单测：PASS / FAIL
10. Queue retry E2E：是否发生 retry、最终 attempts/状态/error
11. Worker 重启恢复：PASS / FAIL
12. 手动 `/run` fallback：PASS / FAIL
13. 最终 `git status --short`
14. 8787 / 8790 是否无残留监听
15. 若 FAIL：最小完整错误、复现命令、失败步骤
