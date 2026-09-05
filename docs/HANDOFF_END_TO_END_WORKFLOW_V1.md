# Hermes Handoff — End-to-End Workflow v1

目标：验证 `feat/end-to-end-workflow-v1` 已把“真实作品源检索 → AI筛选/翻译 → 待发布稿”串成单一 HTTP 工作流，同时继续保证英文原文不可被 AI 改写。

## 严格边界

- 不修改 `main`。
- 不合并 PR #2 / #3 / #4。
- 不修改产品代码；发现缺陷只收集证据并回报。
- 不部署生产环境。
- 不接抖音自动发布。
- 不使用真实付费 AI API。

## 1. 同步分支

```powershell
cd D:\Projects\bilingual-curation-workflow
git fetch origin
git checkout feat/end-to-end-workflow-v1
git pull --ff-only origin feat/end-to-end-workflow-v1
git rev-parse HEAD
git status --short
```

## 2. 静态检查与单测

```powershell
npm install
npm run check
```

重点确认新增 `tests/workflow.test.ts` 覆盖：

1. source → AI → publication draft 可串联。
2. 最终待发布稿保留抓取层英文原文。
3. source 0 候选时拒绝硬生成。
4. AI 0 入选时拒绝硬生成。
5. 单次 AI 调用最多接收 15 个最高分候选。

## 3. 启动本地 mock AI

窗口 A：

```powershell
npm run mock:ai
```

## 4. 创建本地 AI 配置

仓库根目录 `.dev.vars`：

```text
AI_BASE_URL=http://127.0.0.1:8790/v1
AI_API_KEY=local-test-only
AI_MODEL=mock-model
```

该文件必须保持 git ignored。

## 5. 启动 Worker

窗口 B：

```powershell
npm run dev
```

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

## 6. 完整工作流真实 E2E

窗口 C：

```powershell
$body = @{
  theme = "love"
  hook = "关于爱情的一段英文"
  literatureQueries = @("Pride and Prejudice")
  sourceKinds = @("public_domain_literature")
  limitPerSource = 2
  maxSelected = 1
} | ConvertTo-Json -Depth 8

$result = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/workflows/generate -ContentType "application/json" -Body $body
$result | ConvertTo-Json -Depth 12
```

### PASS 标准

全部满足：

- HTTP 200。
- `candidateCount >= 1`。
- `selectedCount = 1`。
- `model = mock-model`。
- `selected[0].provider = gutendex`。
- `selected[0].originalEn` 是真实 Gutenberg 英文片段。
- `selected[0].translationZh` 包含 `【本地模拟翻译】`。
- `publicationDraft.segmentCount = 1`。
- `publicationDraft.publicationText` 包含同一段 `selected[0].originalEn`，逐字不变。
- `publicationDraft.publicationText` 包含中文翻译。
- `publicationDraft.publicationText` 以 hook 开头。
- `warnings` 包含 Project Gutenberg 公版最终复核提示。
- 绝不能出现 `THIS MUST NEVER REPLACE SOURCE ORIGINAL`。

## 7. 不强制产出验证

### 7.1 Source 无候选

用极不可能存在的文学查询或通过测试已有单测证据确认：当 source 结果为空时，工作流必须失败，错误包含：

```text
Source search returned no candidates
```

不得构造空壳 publication draft。

### 7.2 AI 无入选

以 `tests/workflow.test.ts` 单测为证据即可：AI 0 selected 时必须失败，错误包含：

```text
AI curation selected no candidates
```

不得为了批量产量硬塞低质量候选。

## 8. 原接口回归

至少确认：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

并确认以下三个接口没有被删除：

- `POST /api/preview`
- `POST /api/sources/search`
- `POST /api/ai/curate`

## 9. 工作区

测试结束后删除本地 `.dev.vars` 或保留均可，但它必须被忽略：

```powershell
git status --short
```

必须为空。

## 回报格式

只回报：

1. 总体：PASS / FAIL
2. HEAD SHA
3. Node / npm 版本
4. `npm run check`：typecheck + Test Files / Tests 数量
5. `/health`：PASS / FAIL
6. `/api/workflows/generate`：HTTP 状态、candidateCount、selectedCount、model、作品名、originalEn 前 200 字、translationZh、publicationDraft 前 500 字、warnings
7. 原文是否从 selected 到 publicationDraft 逐字保持：是 / 否
8. 是否出现伪造 `THIS MUST NEVER REPLACE SOURCE ORIGINAL`：是 / 否
9. 0 source / 0 selected 防硬生成测试：PASS / FAIL
10. 原三个接口是否仍存在：是 / 否
11. 最终 `git status --short`
12. 若 FAIL：最小完整错误、复现命令、失败步骤
