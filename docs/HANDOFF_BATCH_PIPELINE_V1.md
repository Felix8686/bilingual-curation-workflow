# Hermes Handoff — Batch Pipeline v1

目标：验证 `feat/batch-pipeline-v1` 能在 Windows 本机使用隔离的 Cloudflare D1 本地数据库完成批次创建、分段运行、成功/失败独立持久化和 Worker 重启后的数据恢复。

## 严格边界

- 不修改 `main`。
- 不合并 PR #2 / #3 / #4 / #5。
- 不修改产品代码；发现缺陷只记录证据并回报。
- 不创建或修改远端/生产 D1。
- 所有 D1 migration 只允许加 `--local`。
- 不部署 Worker。
- 不接抖音自动发布。
- 不使用真实付费 AI；继续使用仓库内置 mock AI provider。

## 1. 同步分支

```powershell
cd D:\Projects\bilingual-curation-workflow
git fetch origin
git checkout feat/batch-pipeline-v1
git pull --ff-only origin feat/batch-pipeline-v1
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
- 所有既有测试与 `tests/batch.test.ts` 全绿。
- batch 单测至少覆盖：
  - 批次创建顺序与 pending 状态；
  - 单次最多处理 3 项；
  - 一项失败不删除另一项成功结果；
  - 超过 20 项拒绝创建。

## 3. 准备完全隔离的本地 D1

先确保旧 Worker 已停止，然后删除本阶段专用本地状态：

```powershell
Remove-Item -Recurse -Force .wrangler\batch-pipeline-v1 -ErrorAction SilentlyContinue
```

只对本地 D1 执行 migration：

```powershell
npx wrangler d1 migrations apply bilingual-curation-workflow --local --persist-to .wrangler/batch-pipeline-v1
```

如 Wrangler 询问是否执行 migration，确认执行。

验收：

- `0001_batch_pipeline.sql` 成功应用。
- 严禁去掉 `--local`。

可用下面命令核对表：

```powershell
npx wrangler d1 execute bilingual-curation-workflow --local --persist-to .wrangler/batch-pipeline-v1 --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

应至少看到：

- `batches`
- `batch_items`
- `d1_migrations`

## 4. 启动本地 mock AI

PowerShell 窗口 A：

```powershell
npm run mock:ai
```

应看到：

```text
Mock AI provider listening on http://127.0.0.1:8790/v1
```

## 5. 创建本地 AI 配置

仓库根目录创建 `.dev.vars`：

```text
AI_BASE_URL=http://127.0.0.1:8790/v1
AI_API_KEY=local-test-only
AI_MODEL=mock-model
```

该文件已被 `.gitignore` 忽略，不得提交。

## 6. 用同一个隔离 D1 启动 Worker

PowerShell 窗口 B：

```powershell
npx wrangler dev --persist-to .wrangler/batch-pipeline-v1
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

要求 `ok = true`。

## 7. 创建一个 2 项成功批次

PowerShell 窗口 C：

```powershell
$batchBody = @{
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

$batch = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/batches -ContentType "application/json" -Body $batchBody
$batch | ConvertTo-Json -Depth 12
$batchId = $batch.id
```

创建后必须满足：

- HTTP 201。
- `status = pending`。
- `totalCount = 2`。
- `completedCount = 0`。
- `failedCount = 0`。
- `pendingCount = 2`。
- 两个 item 都为 `pending`，position 分别为 0 / 1。

## 8. 第一次只运行 1 项

```powershell
$run1Body = @{ maxItems = 1 } | ConvertTo-Json
$run1 = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/batches/$batchId/run" -ContentType "application/json" -Body $run1Body
$run1 | ConvertTo-Json -Depth 14
```

必须满足：

- `processedItemIds` 恰好 1 个。
- batch `status = running`。
- `completedCount = 1`。
- `failedCount = 0`。
- `pendingCount = 1`。
- 已完成 item 有 `result.publicationDraft.publicationText`。
- result 中 mock 中文翻译含 `【本地模拟翻译】`。
- result 中 `selected[0].originalEn` 必须来自真实 Gutenberg 抓取结果。
- publicationText 必须包含同一份 `originalEn`，不能出现 `THIS MUST NEVER REPLACE SOURCE ORIGINAL`。

## 9. GET 批次并验证 D1 已持久化

```powershell
$get1 = Invoke-RestMethod "http://127.0.0.1:8787/api/batches/$batchId"
$get1 | ConvertTo-Json -Depth 14
```

必须仍为：1 completed + 1 pending。

再直接查本地 D1：

```powershell
npx wrangler d1 execute bilingual-curation-workflow --local --persist-to .wrangler/batch-pipeline-v1 --command "SELECT batch_id, position, theme, status, length(result_json) AS result_len, error_text FROM batch_items ORDER BY position;"
```

要求第 0 项 `completed` 且 `result_len > 0`，第 1 项 `pending`。

## 10. 重启 Worker 后验证数据仍在

停止窗口 B 的 Worker，但不要删除 `.wrangler/batch-pipeline-v1`。

重新启动：

```powershell
npx wrangler dev --persist-to .wrangler/batch-pipeline-v1
```

再次：

```powershell
$getAfterRestart = Invoke-RestMethod "http://127.0.0.1:8787/api/batches/$batchId"
$getAfterRestart | ConvertTo-Json -Depth 14
```

必须仍然保持：

- 同一个 batchId。
- 1 completed。
- 1 pending。
- 第一个成功结果完整存在。

这是本阶段关键验收项。

## 11. 运行剩余项直到 completed

```powershell
$run2Body = @{ maxItems = 3 } | ConvertTo-Json
$run2 = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/batches/$batchId/run" -ContentType "application/json" -Body $run2Body
$run2 | ConvertTo-Json -Depth 14
```

必须满足：

- `processedItemIds` 为 1 个。
- `status = completed`。
- `completedCount = 2`。
- `failedCount = 0`。
- `pendingCount = 0`。
- 两个 item 都存在独立的 publicationDraft。

再次对 completed 批次调用 run：

```powershell
$run3 = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/batches/$batchId/run" -ContentType "application/json" -Body (@{maxItems=3} | ConvertTo-Json)
$run3 | ConvertTo-Json -Depth 10
```

要求：

- `processedItemIds` 为空。
- 不重复执行已经 completed 的 item。
- 状态仍为 completed。

## 12. 验证部分失败不丢成功结果

创建第二个批次：第一项继续使用真实 Gutenberg；第二项指定一个确定不存在的 Wikiquote 页面。

```powershell
$mixedBody = @{
  items = @(
    @{
      theme = "love"
      literatureQueries = @("Pride and Prejudice")
      sourceKinds = @("public_domain_literature")
      limitPerSource = 1
      maxSelected = 1
    },
    @{
      theme = "love"
      query = "love"
      screenWorks = @("Definitely Nonexistent Film 9F3C8B7A")
      sourceKinds = @("screen_dialogue")
      limitPerSource = 1
      maxSelected = 1
    }
  )
} | ConvertTo-Json -Depth 10

$mixed = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/batches -ContentType "application/json" -Body $mixedBody
$mixedId = $mixed.id
$mixedRun = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/batches/$mixedId/run" -ContentType "application/json" -Body (@{maxItems=2} | ConvertTo-Json)
$mixedRun | ConvertTo-Json -Depth 14
```

要求：

- 最终 `status = partial_failed`。
- `completedCount = 1`。
- `failedCount = 1`。
- `pendingCount = 0`。
- 成功项的 result 仍完整存在。
- 失败项有明确 `error`，但不能覆盖或删除成功项结果。

若不存在页面因外部服务异常表现不同，请保留完整响应作为 FAIL 证据，不要自行改代码。

## 13. API 边界

### 超过 20 个批次项

由单元测试验证必须拒绝。

### maxItems > 3

由单元测试验证单次最多只处理 3 项。

### 不存在的 batchId

```powershell
try {
  Invoke-RestMethod http://127.0.0.1:8787/api/batches/not-exist
} catch {
  $_.Exception.Response.StatusCode.value__
}
```

必须为 404。

## 14. 原能力回归

至少确认：

- `/health` 正常。
- `/api/workflows/generate` 仍可完成一条 Gutenberg → mock AI → publicationDraft。
- 不需要重复全部旧阶段长验收，但 `npm run check` 必须包含全部回归测试。

## 15. 最终工作区

```powershell
git status --short
```

必须为空。

`.dev.vars`、`.wrangler/`、`node_modules/` 均应被忽略。

## PASS 标准

全部满足才算 PASS：

1. `npm run check` 全绿。
2. `0001_batch_pipeline.sql` 只在隔离本地 D1 成功应用。
3. 批次创建正常。
4. 第一次 run 只处理 1 项并持久化结果。
5. Worker 重启后仍能读回相同批次和成功结果。
6. 第二次 run 完成剩余项，批次进入 completed。
7. completed 项不会重复执行。
8. 部分失败批次进入 partial_failed，成功项结果不丢失。
9. 单次最多处理 3 项、单批最多 20 项。
10. 不存在 batch 返回 404。
11. 原 End-to-End Workflow 回归正常。
12. 最终 `git status --short` 为空。

## 回报格式

只回报：

1. 总体：PASS / FAIL
2. HEAD SHA
3. Node / npm / Wrangler 版本
4. `npm run check`：typecheck + Test Files / Tests 数量
5. 本地 D1 migration：PASS / FAIL；表名
6. 成功批次创建：batchId、初始 counts/status
7. 第一次 run：processed 数、counts/status、首条 publicationDraft 摘要、原文防篡改结果
8. Worker 重启后 D1 持久化：PASS / FAIL
9. 第二次 run：最终 counts/status；completed 重跑是否 0 processed
10. partial_failed 验证：counts/status、成功结果是否保留、失败 error
11. 404 / 20项 / 3项上限验证
12. `/api/workflows/generate` 回归：PASS / FAIL
13. 最终 `git status --short`
14. 若 FAIL：最小完整错误、复现命令、失败步骤
