# bilingual-curation-workflow

面向抖音双语长文内容的策展工作流。系统负责作品源检索、候选筛选、中文翻译、待发布稿生成、批次执行和人工审核；最终发布始终由用户手动完成。

## 已验收能力

### MVP v1

- 保留英文原文，排版流程不得改写原作。
- 保存中文翻译、出处、来源类型与版权状态。
- 多作品用明显分隔线组合为双语待发布稿。

### Source Pipeline v1

- 公版文学：Project Gutenberg / Gutendex。
- 影视对白：English Wikiquote / MediaWiki API。
- 影视对白默认 `quotation_review_required`。
- Gutenberg 候选默认 `public_domain_review_required`。

### Selection + Translation v1

AI 只负责主题/上下文筛选和忠实的简体中文翻译。AI 不负责创作、润色、现代化、缩写或改写英文原文；最终 `originalEn` 永远从抓取层对象回填。

### End-to-End Workflow v1

```text
主题 → 真实作品源检索 → AI筛选/翻译 → 原文安全回填 → 双语待发布稿
```

接口：`POST /api/workflows/generate`

### Batch Pipeline v1

Cloudflare D1 保存批次和每个主题任务。单批最多 20 项；手动 `run` 单次最多处理 3 项。每项独立保存成功结果或失败原因，Worker 重启后仍可恢复。

```text
POST /api/batches
GET  /api/batches/:batchId
POST /api/batches/:batchId/run
```

### Queue Pipeline v1

Cloudflare Queues 异步执行 D1 中的批次任务。消费端通过 D1 原子抢占抵御 at-least-once 重复投递；前两次失败进入重试，最终失败才落库。手动 `/run` 继续作为故障兜底。

```text
POST /api/batches/:batchId/enqueue
```

### Review Console v1

同一个 Worker 提供人工审核台：

```text
GET /
```

审核台支持：

- 一次输入最多 20 个主题，创建批次并直接 enqueue。
- 查看 Queue 执行进度和已完成双语稿。
- 一键复制 publication draft，供用户手动发布。
- 人工标记 `未审核 / 可发布 / 暂缓 / 已发布`。
- 保存最多 2000 字的人工审核备注。
- 按审核状态筛选稿件。

审核状态只修改 D1 中独立的 review 字段，不会修改 `result_json`、英文原文、中文翻译或 publication draft。

```text
GET   /api/review/items?status=unreviewed&limit=100
PATCH /api/review/items/:itemId
```

`published` 只是用户手动发布后的记录，系统没有任何抖音发布接口。

## 开发中：Production Readiness v1

生产版继续采用纯 Cloudflare 架构：

```text
Cloudflare Access
        ↓
Worker + Review Console / API
        ├─ Workers AI
        ├─ D1
        └─ Queues
        ↓
人工审核 → 手动发布抖音
```

生产安全规则：

- `REQUIRE_ACCESS=true` 时，HTTP 请求必须具有 Cloudflare 运行时提供的 `ctx.access`，否则 Worker 自身返回 403。
- 生产 AI 使用原生 Workers AI binding `env.AI`，不需要在 Worker Secret 中保存 Cloudflare API Token。
- 当前生产候选模型：`@cf/qwen/qwen3-30b-a3b-fp8`。
- 本地 mock / 未来其他模型厂商仍可使用 `AI_BASE_URL + AI_API_KEY + AI_MODEL`；显式配置外部 provider 时优先于 Workers AI binding。
- `wrangler.production.toml` 独立于本地配置，使用专门的 `-prod` D1 / Queue 名称。
- 生产 Preview URLs 明确关闭。
- `wrangler.production.toml` 中 D1 ID 当前故意为占位值；创建真实远端 D1 前不允许部署。

生产预检：

```bash
npm run prod:preflight
```

在真实 D1 ID 尚未填入时，该命令必须 FAIL。这是部署保险丝，不是故障。

## 技术形态

- Cloudflare Worker
- Cloudflare Access（生产）
- Cloudflare Workers AI（生产）
- Cloudflare D1
- Cloudflare Queues
- Worker 内置无框架 Review Console
- TypeScript / Vitest
- Project Gutenberg / Gutendex
- English Wikiquote / MediaWiki API
- OpenAI-compatible provider fallback（本地 mock / 可替换）

## 本地验证

```bash
npm install
npm run check
npm run d1:migrate:local
npm run dev
```

Wrangler 本地开发会通过 Miniflare 模拟 D1 和 Queues。AI 本地配置放在 `.dev.vars`，该文件已被 Git 忽略。

完整主要接口：

```text
GET   /
GET   /health
POST  /api/preview
POST  /api/sources/search
POST  /api/ai/curate
POST  /api/workflows/generate
POST  /api/batches
GET   /api/batches/:batchId
POST  /api/batches/:batchId/run
POST  /api/batches/:batchId/enqueue
GET   /api/review/items
PATCH /api/review/items/:itemId
```

## 当前明确不包含

- AI 原创整篇正文
- AI 改写英文原文
- 抖音自动发布 / RPA
- Cron 自动调度
- 未经 Access 保护的生产后台

## 开发规则

当前生产准备分支：`chore/production-readiness-v1`。

该分支从完成合并后全链路回归的 `main` HEAD `00601a909e73acf29a7c22db1d8b90dc6be6203f` 创建。未经本阶段验收，不修改 `main`，不执行生产部署。
