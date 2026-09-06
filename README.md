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

## 开发中：Review Console v1

第七阶段提供一个由同一 Cloudflare Worker 直接托管的人工审核台，不再要求用户手工拼 API 请求。

打开：

```text
GET /
```

审核台支持：

- 一次输入最多 20 个主题，创建批次并直接 enqueue。
- 查看最近一次批次的 Queue 执行进度。
- 查看已经生成完成的双语待发布稿。
- 一键复制 publication draft，供用户手动发布。
- 人工标记 `未审核 / 可发布 / 暂缓 / 已发布`。
- 保存最多 2000 字的人工审核备注。
- 按审核状态筛选稿件。

审核状态只修改 D1 中独立的 review 字段，不会修改已经生成的 `result_json`、英文原文、中文翻译或 publication draft。

新增 API：

```text
GET   /api/review/items?status=unreviewed&limit=100
PATCH /api/review/items/:itemId
```

PATCH 示例：

```json
{
  "reviewStatus": "approved",
  "note": "可发布，发布前再人工核对版权 warning"
}
```

审核状态：

```text
unreviewed | approved | held | published
```

`published` 只是用户手动发布后做记录，系统没有任何抖音发布接口。

## 技术形态

- Cloudflare Worker
- Cloudflare D1
- Cloudflare Queues
- Worker 内置无框架 Review Console
- TypeScript / Vitest
- Project Gutenberg / Gutendex
- English Wikiquote / MediaWiki API
- 可替换的 OpenAI-compatible AI provider

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
- 生产 D1 / Queue 创建或部署

## 开发规则

当前第七阶段分支：`feat/review-console-v1`。

该分支从已验收的 Queue Pipeline v1 HEAD `ecab8b6c66ea482e8d5721847ffd847689622c0e` 创建。此前堆叠 PR 保持未合并，在本阶段 Hermes 验收前不得修改 `main`。
