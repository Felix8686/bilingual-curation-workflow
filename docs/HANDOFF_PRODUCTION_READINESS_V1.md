# Hermes Handoff — Production Readiness v1

目标：在不创建任何远端 Cloudflare 资源、不部署 Worker、不调用真实 AI 的前提下，验证生产安全框架已经可用：Workers AI binding 路径、Cloudflare Access fail-closed 保险丝、独立生产 Wrangler 配置和部署预检。

## 严格边界

- 不修改 `main`。
- 不修改产品代码或配置文件。
- 不创建或修改远端 D1 / Queue / Worker / Access Application。
- 不运行 `wrangler deploy`。
- 不运行远端 D1 migration。
- 不调用真实 Workers AI 或任何真实付费 AI。
- 本轮只验证代码、测试和本地 mock 回归。

## 1. 同步分支

```powershell
cd D:\Projects\bilingual-curation-workflow
git fetch origin
git checkout chore/production-readiness-v1
git pull --ff-only origin chore/production-readiness-v1
git rev-parse HEAD
git status --short
```

HEAD 必须等于交接指令给出的预期 SHA，初始工作区必须为空。

## 2. 完整静态检查

```powershell
npm install
npm run check
```

要求：

- typecheck 0 error。
- 8 个测试文件全部 PASS。
- 29 个测试全部 PASS。
- `tests/ai.test.ts` 中 Workers AI binding 路径 PASS。
- `tests/production.test.ts` 中 3 个 Access guard 测试全部 PASS。
- Review Console inline script 编译回归继续 PASS。

## 3. 验证 Workers AI binding 单测语义

检查测试结果并确认：

- 生产路径可以只提供 `AI_MODEL + env.AI`，不需要 `AI_BASE_URL / AI_API_KEY`。
- mock Workers AI 返回伪造 `originalEn` 时，最终 `selected.originalEn` 仍严格来自 source candidate。
- 当显式配置 `AI_BASE_URL + AI_API_KEY` 时，旧 OpenAI-compatible 路径仍可使用，保证本地 mock 与未来备用 provider 不回归。

不得为了本项调用真实 Workers AI。

## 4. 验证 Access fail-closed

`tests/production.test.ts` 必须证明：

1. `REQUIRE_ACCESS=true` 且没有 `ctx.access` → HTTP 403。
2. `REQUIRE_ACCESS=true` 且有运行时 `ctx.access` → `/health` HTTP 200。
3. 本地开发未设置 `REQUIRE_ACCESS` → 不改变现有行为。

额外检查源码：

```powershell
Select-String -Path src\index.ts -Pattern "REQUIRE_ACCESS|ctx.*access|Cloudflare Access authentication is required"
```

不得将普通 HTTP Header 当成 Access 认证依据；必须检查 Worker runtime context 的 `ctx.access`。

## 5. 验证生产配置安全默认值

查看：

```powershell
Get-Content wrangler.production.toml
```

必须确认：

- `preview_urls = false`
- `[ai] binding = "AI"`
- `AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"`
- `REQUIRE_ACCESS = "true"`
- D1 名称为 `bilingual-curation-workflow-prod`
- Queue 名称为 `bilingual-curation-workflow-batches-prod`
- 不存在 `AI_BASE_URL`
- 不存在 `AI_API_KEY`
- D1 `database_id` 当前仍为 `REPLACE_WITH_PRODUCTION_D1_ID`

最后一项是本阶段的故意部署闸门，不是缺陷。

## 6. 验证生产预检“会拦截”

在仓库原始状态直接执行：

```powershell
npm run prod:preflight
```

本步骤**必须返回非 0 / FAIL**，并至少指出：

```text
production D1 database_id is still a placeholder
```

如果仓库原始配置反而 PASS，本阶段总体 FAIL，因为这代表尚未创建真实 D1 时也能误进入部署流程。

## 7. 验证生产预检“补齐后会放行”

不要修改仓库文件。复制到临时目录：

```powershell
$tempConfig = Join-Path $env:TEMP "bilingual-curation-wrangler-production-test.toml"
(Get-Content wrangler.production.toml -Raw).Replace(
  "REPLACE_WITH_PRODUCTION_D1_ID",
  "11111111-2222-3333-4444-555555555555"
) | Set-Content $tempConfig -Encoding UTF8

node scripts/production-preflight.mjs $tempConfig
$preflightExit = $LASTEXITCODE
Remove-Item $tempConfig -Force
$preflightExit
```

要求：

- 临时配置 preflight PASS。
- exit code = 0。
- 输出确认 D1 / Queue / Workers AI / REQUIRE_ACCESS / preview URLs 均通过。
- 临时文件最终删除。
- 仓库中的 `wrangler.production.toml` 不得被修改。

这里的 UUID 只是格式测试，严禁拿它部署或访问远端 D1。

## 8. 本地 mock AI + Worker 回归

继续使用现有本地隔离方式，不使用 `wrangler.production.toml`。

创建或确认 `.dev.vars`：

```text
AI_BASE_URL=http://127.0.0.1:8790/v1
AI_API_KEY=local-test-only
AI_MODEL=mock-model
```

窗口 A：

```powershell
npm run mock:ai
```

窗口 B：

```powershell
npx wrangler dev --persist-to .wrangler/production-readiness-v1
```

确认：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

必须 HTTP 200。

再实际调用一次：

```text
POST /api/workflows/generate
```

使用 Pride and Prejudice / public_domain_literature / maxSelected=1。

要求：

- HTTP 200。
- `model = mock-model`。
- 中文翻译来自本地 mock。
- `originalEn` 仍来自真实 source。
- 不出现 `THIS MUST NEVER REPLACE SOURCE ORIGINAL`。

目的：证明新增 Workers AI 支持没有破坏现有本地 mock 路径。

本轮无需重复 Queue / Review Console 完整 E2E；这些能力已经在最新 main 做过合并后全链路回归，且本阶段没有修改相关实现。

## 9. 最终清理

停止 Worker 与 mock AI。

确认：

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 8787,8790 }
```

必须无结果。

最后：

```powershell
git status --short
```

必须为空。

## PASS 标准

只有以下全部满足才可判定 Production Readiness v1 本地框架 PASS：

- 精确 HEAD。
- typecheck PASS。
- 8 files / 29 tests PASS。
- Workers AI binding mock 路径 PASS。
- external OpenAI-compatible fallback 不回归。
- Access fail-closed 3 tests PASS。
- 原始生产配置 preflight 按预期 FAIL。
- 临时已补 UUID 的配置 preflight PASS。
- 本地 mock `/api/workflows/generate` 回归 PASS。
- originalEn 防篡改继续 PASS。
- git clean。
- 8787 / 8790 已停止。
- 没有任何远端 Cloudflare 写操作或真实 AI 调用。

## 回报格式

1. Overall PASS / FAIL
2. HEAD
3. Node / npm
4. `npm run check`：Test Files / Tests
5. Workers AI binding mock test
6. OpenAI-compatible fallback regression
7. Access fail-closed 3 tests
8. 原始 `prod:preflight` 是否按预期 FAIL + 原因
9. 临时补 UUID 后 preflight 是否 PASS
10. 本地 `/health`
11. 本地 `/api/workflows/generate`：HTTP、model、work、translation、original 前 200 字
12. fake original 是否出现
13. git status
14. 8787 / 8790 清理状态
15. 是否发生任何远端 Cloudflare 写操作 / 真实 AI 调用（必须否）
