# Hermes Handoff — Source Pipeline v1

目标：验证 `feat/source-pipeline-v1` 在 Windows 本机可通过类型检查/单测，并且能真实访问 Project Gutenberg/Gutendex 与 English Wikiquote，产出结构化候选作品片段。

## 严格边界

- 不修改 `main`。
- 不合并 PR。
- 不修改产品代码；发现缺陷只回报证据。
- 不部署生产环境。
- 不接入抖音自动发布。
- 不自行增加 AI 改写步骤。

## 1. 同步分支

```powershell
cd D:\Projects\bilingual-curation-workflow
git fetch origin
git checkout feat/source-pipeline-v1
git pull --ff-only origin feat/source-pipeline-v1
git rev-parse HEAD
git status --short
```

## 2. 静态检查与单测

```powershell
npm install
npm run check
```

记录：typecheck 是否 0 error、Vitest test files/tests 数量。

## 3. 启动 Worker

```powershell
npm run dev
```

另开 PowerShell：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

## 4. 真实文学源测试

```powershell
$litBody = @{
  theme = "love"
  literatureQueries = @("Pride and Prejudice")
  sourceKinds = @("public_domain_literature")
  limitPerSource = 1
} | ConvertTo-Json -Depth 6

$lit = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/sources/search -ContentType "application/json" -Body $litBody
$lit | ConvertTo-Json -Depth 8
```

验收：

- HTTP 成功。
- `candidates` 至少 1 条。
- 至少一条 `provider = gutendex`。
- `sourceKind = public_domain_literature`。
- `originalEn` 非空且像正常英文正文，不是纯元数据/目录。
- `sourceUrl` 指向 `gutenberg.org/ebooks/...`。
- `rightsStatus = public_domain_review_required`。
- warnings 包含最终公版检查提示。

## 5. 真实影视对白源测试

```powershell
$screenBody = @{
  theme = "love"
  query = "love"
  screenWorks = @("Before Sunrise")
  sourceKinds = @("screen_dialogue")
  limitPerSource = 1
} | ConvertTo-Json -Depth 6

$screen = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/sources/search -ContentType "application/json" -Body $screenBody
$screen | ConvertTo-Json -Depth 8
```

验收：

- HTTP 成功。
- `candidates` 至少 1 条。
- `provider = wikiquote`。
- `workTitle` 能对应 `Before Sunrise`。
- `originalEn` 非空，包含可阅读英文候选引文/对白，而不是 Wiki 标记或导航文本。
- `sourceUrl` 指向 English Wikiquote。
- `rightsStatus = quotation_review_required`。
- warnings 包含人工版权/上下文复核提示。

注意：此步骤只验证候选抓取，不验证该对白可以直接发布；不要自行大量复制/扩展影视对白。

## 6. 原 MVP 回归

确认以下两个接口仍正常：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

原 `docs/HANDOFF_MVP_V1.md` 中 `/api/preview` 的示例至少再执行一次，确认英文原文保留、分隔线与 warning 行为未回归。

## 7. 工作区

```powershell
git status --short
```

必须为空。

## PASS 标准

全部满足才算 PASS：

1. `npm run check` 全绿。
2. `/health` 正常。
3. Gutendex 真实源至少返回 1 个合格文学候选片段。
4. Wikiquote 真实源至少返回 1 个合格影视候选片段。
5. 两类候选的 rightsStatus 与 warnings 正确。
6. `/api/preview` 回归正常。
7. 最终 `git status --short` 为空。

## 回报格式

只回报：

1. 总体：PASS / FAIL
2. HEAD SHA
3. Node / npm 版本
4. `npm run check`：typecheck + test files/tests 数量
5. `/health` 结果
6. Gutendex 真实源：候选数量、首条作品名、originalEn 前 200 字、rightsStatus、warning
7. Wikiquote 真实源：候选数量、首条作品名、originalEn 前 200 字、rightsStatus、warning
8. `/api/preview` 回归：PASS / FAIL
9. 最终 `git status --short`
10. 若 FAIL：完整最小错误与复现命令
