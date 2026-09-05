# Hermes Handoff — Selection + Translation v1

目标：验证 `feat/selection-translation-v1` 的 AI 筛选/翻译层在 Windows 本机可通过类型检查、单测，并通过本地 mock OpenAI-compatible provider 完成 Worker HTTP E2E。此次不需要任何真实 AI API Key。

## 严格边界

- 不修改 `main`。
- 不合并 PR #2 或后续 PR。
- 不修改产品代码；发现缺陷只收集证据并回报。
- 不部署生产环境。
- 不接抖音自动发布。
- 不使用真实付费 AI API 做本次验收。

## 1. 同步分支

```powershell
cd D:\Projects\bilingual-curation-workflow
git fetch origin
git checkout feat/selection-translation-v1
git pull --ff-only origin feat/selection-translation-v1
git rev-parse HEAD
git status --short
```

## 2. 静态检查与单测

```powershell
npm install
npm run check
```

记录：typecheck 是否 0 error、Vitest Test Files / Tests 数量。

重点确认 `tests/ai.test.ts` 覆盖：

1. AI 响应即使偷偷返回伪造 `originalEn`，最终结果仍使用抓取层原文。
2. 超过 `maxSelected` 的候选会被截断并进入 rejected。
3. AI 选中但没给中文翻译时，该候选不能进入 selected。
4. 缺 AI 配置时调用会被拒绝。

## 3. 启动本地 mock AI provider

PowerShell 窗口 A：

```powershell
npm run mock:ai
```

必须看到类似：

```text
Mock AI provider listening on http://127.0.0.1:8790/v1
```

## 4. 创建本地临时 AI 配置

在仓库根目录创建 `.dev.vars`，内容：

```text
AI_BASE_URL=http://127.0.0.1:8790/v1
AI_API_KEY=local-test-only
AI_MODEL=mock-model
```

`.dev.vars` 已被 `.gitignore` 忽略，严禁提交真实 Key。

## 5. 启动 Worker

PowerShell 窗口 B：

```powershell
npm run dev
```

确认：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

返回 `ok: true`。

## 6. `/api/ai/curate` 本地 HTTP E2E

PowerShell 窗口 C：

```powershell
$body = @{
  theme = "love"
  maxSelected = 1
  candidates = @(
    @{
      id = "film-a"
      theme = "love"
      sourceKind = "screen_dialogue"
      provider = "wikiquote"
      workTitle = "Before Sunrise"
      sourceUrl = "https://en.wikiquote.org/wiki/Before_Sunrise"
      originalEn = "But loving someone, and being loved means so much to me."
      rightsStatus = "quotation_review_required"
      sourceVerified = $true
      score = 3
    },
    @{
      id = "lit-b"
      theme = "love"
      sourceKind = "public_domain_literature"
      provider = "gutendex"
      workTitle = "Pride and Prejudice"
      creator = "Austen, Jane"
      sourceUrl = "https://www.gutenberg.org/ebooks/1342"
      originalEn = "In vain I have struggled. It will not do. My feelings will not be repressed."
      rightsStatus = "public_domain_review_required"
      sourceVerified = $true
      score = 2
    }
  )
} | ConvertTo-Json -Depth 8

$result = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/ai/curate -ContentType "application/json" -Body $body
$result | ConvertTo-Json -Depth 10
```

### E2E 验收标准

全部满足：

- HTTP 200。
- `model = mock-model`。
- `selected` 恰好 1 条。
- selected 首条 `id = film-a`。
- selected 首条 `originalEn` 必须逐字等于：

```text
But loving someone, and being loved means so much to me.
```

- 绝不能出现 mock provider 故意注入的：

```text
THIS MUST NEVER REPLACE SOURCE ORIGINAL
```

- `translationZh` 包含 `【本地模拟翻译】`。
- `themeFitScore` / `contextIndependenceScore` 存在。
- `warnings` 包含 screen dialogue 的 manual rights/context review。
- `lit-b` 因 `maxSelected = 1` 出现在 `rejected`。

## 7. 缺配置安全行为

停止 Worker，临时把 `.dev.vars` 改名为 `.dev.vars.off` 后重新：

```powershell
npm run dev
```

再次请求 `/api/ai/curate`，验收：

- HTTP 状态为 503。
- error 包含：

```text
AI_BASE_URL, AI_API_KEY and AI_MODEL must be configured.
```

测试后恢复 `.dev.vars` 名称或删除本地测试文件均可。

## 8. Source Pipeline 回归

至少再执行一次：

```powershell
$sourceBody = @{
  theme = "love"
  literatureQueries = @("Pride and Prejudice")
  sourceKinds = @("public_domain_literature")
  limitPerSource = 1
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/sources/search -ContentType "application/json" -Body $sourceBody
```

要求至少返回 1 条 Gutendex 候选，证明第三阶段未破坏第二阶段。

## 9. 工作区

```powershell
git status --short
```

必须为空。`.dev.vars`、`.wrangler/`、`node_modules/` 均应被忽略。

## PASS 标准

1. `npm run check` 全绿。
2. `/health` 正常。
3. mock AI provider E2E 全部满足。
4. 英文原文不可被模型响应覆盖。
5. 缺 AI 配置时 HTTP 503。
6. Gutendex Source Pipeline 回归正常。
7. 最终 `git status --short` 为空。

## 回报格式

只回报：

1. 总体：PASS / FAIL
2. HEAD SHA
3. Node / npm 版本
4. `npm run check`：typecheck + Test Files / Tests 数量
5. `/health`：PASS / FAIL
6. `/api/ai/curate` mock E2E：selected 数量、首条 ID、originalEn、translationZh、scores、warning、rejected
7. AI 伪造 originalEn 是否被成功忽略：是 / 否
8. 缺 AI 配置是否返回 503：是 / 否
9. Gutendex 回归：PASS / FAIL
10. 最终 `git status --short`
11. 若 FAIL：最小完整错误、复现命令、失败步骤
