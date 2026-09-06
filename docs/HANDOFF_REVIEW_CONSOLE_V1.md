# Hermes Handoff — Review Console v1

目标：验证 `feat/review-console-v1` 在 Windows 本机使用隔离 D1 + 本地 Queue + mock AI 时，能提供可用的人工审核台，并确认审核状态与备注只写入 review 字段，不修改既有生成结果和英文原文。

## 严格边界

- 不修改 `main`。
- 不合并 PR #2～#7。
- 不修改产品代码；发现缺陷只记录证据并回报。
- 不创建或修改远端 D1 / Queue。
- 所有 migration 只能使用 `--local`。
- 不部署 Worker。
- 不调用真实付费 AI。
- 不接抖音自动发布。

## 1. 同步分支

```powershell
cd D:\Projects\bilingual-curation-workflow
git fetch origin
git checkout feat/review-console-v1
git pull --ff-only origin feat/review-console-v1
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
- 所有既有测试继续通过。
- `tests/review.test.ts` 通过，至少验证：
  - 按 review status 列出稿件；
  - 更新 `approved / held / published / unreviewed` 所需数据结构；
  - review 更新不会改变 publication result；
  - Review Console HTML 正常生成。

## 3. 准备完全隔离的本地 D1

停止旧 Worker 后删除本阶段状态：

```powershell
Remove-Item -Recurse -Force .wrangler\review-console-v1 -ErrorAction SilentlyContinue
```

仅对隔离本地 D1 应用全部 migration：

```powershell
npx wrangler d1 migrations apply bilingual-curation-workflow --local --persist-to .wrangler/review-console-v1
```

必须看到 `0001_batch_pipeline.sql`、`0002_queue_pipeline.sql`、`0003_review_console.sql` 均已应用或已处于 applied 状态。

核对 schema：

```powershell
npx wrangler d1 execute bilingual-curation-workflow --local --persist-to .wrangler/review-console-v1 --command "PRAGMA table_info(batch_items);"
```

必须包含：

- `review_status`
- `review_note`
- `reviewed_at`

## 4. 启动 mock AI

PowerShell 窗口 A：

```powershell
npm run mock:ai
```

应监听：

```text
http://127.0.0.1:8790/v1
```

## 5. 本地 AI 配置

仓库根目录创建 `.dev.vars`：

```text
AI_BASE_URL=http://127.0.0.1:8790/v1
AI_API_KEY=local-test-only
AI_MODEL=mock-model
```

`.dev.vars` 已被 Git 忽略，不得提交。

## 6. 启动 Worker + 本地 D1/Queue

PowerShell 窗口 B：

```powershell
npx wrangler dev --persist-to .wrangler/review-console-v1
```

确认健康：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

要求 `ok = true`。

## 7. Review Console 首页验证

```powershell
$home = Invoke-WebRequest http://127.0.0.1:8787/
$home.StatusCode
$home.Headers["Content-Type"]
$home.Headers["Content-Security-Policy"]
$home.Content
```

必须满足：

- HTTP 200。
- `Content-Type` 包含 `text/html`。
- 存在 `Content-Security-Policy`。
- HTML 包含：
  - `双语策展审核台`
  - `创建并入队`
  - `复制待发布稿`
  - `可发布`
  - `暂缓`
  - `已发布`

如果当前环境可以直接打开浏览器，请额外实际打开 `http://127.0.0.1:8787/`，确认页面无明显空白、乱码或脚本报错；该项作为附加证据，不替代下面的 API E2E。

## 8. 创建并异步生成 2 条稿件

```powershell
$batchBody = @{
  items = @(
    @{
      theme = "love"
      hook = "关于爱情的几段英文"
      literatureQueries = @("Pride and Prejudice")
      sourceKinds = @("public_domain_literature")
      limitPerSource = 1
      maxSelected = 1
    },
    @{
      theme = "marriage"
      hook = "关于婚姻的几段英文"
      literatureQueries = @("Pride and Prejudice")
      sourceKinds = @("public_domain_literature")
      limitPerSource = 1
      maxSelected = 1
    }
  )
} | ConvertTo-Json -Depth 10

$batch = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/batches -ContentType "application/json" -Body $batchBody
$batchId = $batch.id

$enqueue = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/batches/$batchId/enqueue" -ContentType "application/json" -Body '{"maxItems":20}'
$enqueue | ConvertTo-Json -Depth 12
```

只允许调用 `/enqueue`，不要调用 `/run`。

轮询：

```powershell
for ($i = 0; $i -lt 30; $i++) {
  $state = Invoke-RestMethod "http://127.0.0.1:8787/api/batches/$batchId"
  $state | ConvertTo-Json -Depth 14
  if ($state.pendingCount -eq 0) { break }
  Start-Sleep -Seconds 2
}
```

要求两项最终均为 `completed`，并各自存在 `publicationDraft.publicationText`。

## 9. 未审核列表 E2E

```powershell
$unreviewed = Invoke-RestMethod "http://127.0.0.1:8787/api/review/items?status=unreviewed&limit=100"
$unreviewed | ConvertTo-Json -Depth 16
```

必须满足：

- 至少包含刚生成的 2 条 item。
- `reviewStatus = unreviewed`。
- 每条存在完整 `result.publicationDraft.publicationText`。
- 英文原文仍来自抓取层，不能出现 mock AI 的：

```text
THIS MUST NEVER REPLACE SOURCE ORIGINAL
```

保存第一条稿件文本供后续不变性比较：

```powershell
$itemA = $unreviewed.items | Where-Object { $_.batchId -eq $batchId } | Select-Object -First 1
$beforeText = $itemA.result.publicationDraft.publicationText
$itemAId = $itemA.id
```

再取第二条：

```powershell
$itemB = $unreviewed.items | Where-Object { $_.batchId -eq $batchId -and $_.id -ne $itemAId } | Select-Object -First 1
$itemBId = $itemB.id
```

## 10. 人工审核状态写入

第一条标记为可发布：

```powershell
$approvedBody = @{
  reviewStatus = "approved"
  note = "可发布；发布前再人工核对版权 warning"
} | ConvertTo-Json

$approved = Invoke-RestMethod -Method Patch -Uri "http://127.0.0.1:8787/api/review/items/$itemAId" -ContentType "application/json" -Body $approvedBody
$approved | ConvertTo-Json -Depth 16
```

要求：

- `reviewStatus = approved`
- `reviewNote` 正确保存
- `reviewedAt` 非空
- `$approved.result.publicationDraft.publicationText` 必须逐字等于 `$beforeText`

第二条标记为暂缓：

```powershell
$held = Invoke-RestMethod -Method Patch -Uri "http://127.0.0.1:8787/api/review/items/$itemBId" -ContentType "application/json" -Body '{"reviewStatus":"held","note":"暂缓，稍后再看"}'
$held | ConvertTo-Json -Depth 16
```

要求 `reviewStatus = held`。

## 11. 状态筛选

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/review/items?status=approved&limit=100" | ConvertTo-Json -Depth 16
Invoke-RestMethod "http://127.0.0.1:8787/api/review/items?status=held&limit=100" | ConvertTo-Json -Depth 16
```

要求：

- approved 过滤中能找到 `$itemAId`。
- held 过滤中能找到 `$itemBId`。
- 两者不能被错误混入对方状态。

## 12. 已发布仅作为人工记录

```powershell
$published = Invoke-RestMethod -Method Patch -Uri "http://127.0.0.1:8787/api/review/items/$itemAId" -ContentType "application/json" -Body '{"reviewStatus":"published","note":"已由用户手动发布"}'
$published | ConvertTo-Json -Depth 16
```

要求：

- `reviewStatus = published`。
- 系统只修改 D1 review 字段；不存在任何抖音发布请求或自动化动作。
- publication text 仍逐字等于 `$beforeText`。

## 13. 错误边界

### 非法状态

请求：

```powershell
try {
  Invoke-RestMethod -Method Patch -Uri "http://127.0.0.1:8787/api/review/items/$itemBId" -ContentType "application/json" -Body '{"reviewStatus":"deleted"}'
} catch {
  $_.Exception.Response.StatusCode.value__
}
```

要求 HTTP 400。

### 不存在 item

```powershell
try {
  Invoke-RestMethod -Method Patch -Uri "http://127.0.0.1:8787/api/review/items/not-found" -ContentType "application/json" -Body '{"reviewStatus":"approved"}'
} catch {
  $_.Exception.Response.StatusCode.value__
}
```

要求 HTTP 404。

## 14. Worker 重启持久化

停止 Worker（不要删除 `.wrangler/review-console-v1`），然后用同一命令重新启动：

```powershell
npx wrangler dev --persist-to .wrangler/review-console-v1
```

重新查询：

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/review/items?status=published&limit=100" | ConvertTo-Json -Depth 16
Invoke-RestMethod "http://127.0.0.1:8787/api/review/items?status=held&limit=100" | ConvertTo-Json -Depth 16
```

要求 `published / held` 状态、备注和 publicationDraft 全部恢复。

## 15. 既有能力回归

至少验证：

- `/health` 正常。
- `/api/batches/:batchId` 可读取。
- `/api/batches/:batchId/enqueue` 对 completed 项再次调用时不会重复生产。
- `/api/batches/:batchId/run` 兜底路径仍存在并能对新的未入队 pending item 工作。

## 16. 工作区与进程清理

```powershell
git status --short
```

必须为空。

停止 Worker 和 mock AI，并确认至少以下端口无监听：

```text
8787
8790
```

如 Wrangler 另开调试端口，也一并确认无残留。

## PASS 标准

1. `npm run check` 全绿。
2. 0003 migration 仅应用本地隔离 D1。
3. `/` 返回完整 Review Console HTML + 安全响应头。
4. Queue 异步生成的 completed 稿件自动进入 `unreviewed` 列表。
5. `approved / held / published / unreviewed` 状态可正确写入和过滤。
6. 审核操作不改变 `result_json` / publication text / 英文原文。
7. 非法状态 400，不存在 item 404。
8. Worker 重启后审核状态、备注和稿件完整恢复。
9. 既有 Queue / batch 能力无回归。
10. 最终 Git 工作区干净，相关本地进程全部停止。

## 回报格式

只回报：

1. 总体：PASS / FAIL
2. HEAD SHA
3. Node / npm 版本
4. `npm run check`：typecheck + Test Files / Tests 数量
5. 0001 / 0002 / 0003 本地 migration：PASS / FAIL
6. `/` Review Console：HTTP、Content-Type、CSP、关键文本验证
7. Queue 生成 2 条稿件：PASS / FAIL
8. `unreviewed` 列表：条数、稿件完整性、原文防篡改
9. approved 更新：状态、note、reviewedAt、publicationText 不变
10. held 更新与状态过滤：PASS / FAIL
11. published 仅人工记录：PASS / FAIL
12. 非法 reviewStatus 400：PASS / FAIL
13. 不存在 item 404：PASS / FAIL
14. Worker 重启后审核状态/备注/稿件恢复：PASS / FAIL
15. 既有 batch / Queue 回归：PASS / FAIL
16. 最终 `git status --short`
17. 端口清理结果
18. 若 FAIL：最小完整错误、失败步骤、复现命令
