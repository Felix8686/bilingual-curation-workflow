# bilingual-curation-workflow

面向抖音双语长文内容的策展工作流。系统负责作品源检索、候选筛选、中文翻译、待发布稿生成和批次管理；最终审核与发布始终由用户手动完成。

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

## 开发中：Queue Pipeline v1

第六阶段增加 Cloudflare Queues，让已保存到 D1 的批次可以异步执行，而不需要用户反复调用 `/run`。

```text
创建批次
→ POST /api/batches/:batchId/enqueue
→ Queue 异步投递 batchId + itemId
→ Consumer 用 D1 原子抢占执行权
→ 运行完整内容工作流
→ 成功/失败写回 D1
```

关键规则：

- Queue 采用 at-least-once 投递，因此消费端必须幂等；重复消息拿不到 D1 执行权会直接跳过。
- 投递前记录 `queuedAt`，避免同一 pending item 被重复 enqueue。
- Queue 发布失败会回滚 `queuedAt`。
- 前两次消费失败进入延迟重试；第三次仍失败才将 item 标记为 `failed`。
- 第五阶段的手动 `/run` 继续保留为故障兜底，并自动避开已经入队的 item。
- 仍然不自动发布抖音。

新增接口：

```text
POST /api/batches/:batchId/enqueue
```

## 技术形态

- Cloudflare Worker
- Cloudflare D1
- Cloudflare Queues
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

完整接口：

```text
GET  /health
POST /api/preview
POST /api/sources/search
POST /api/ai/curate
POST /api/workflows/generate
POST /api/batches
GET  /api/batches/:batchId
POST /api/batches/:batchId/run
POST /api/batches/:batchId/enqueue
```

## 当前明确不包含

- AI 原创整篇正文
- AI 改写英文原文
- 抖音自动发布 / RPA
- Cron 自动调度
- 生产 D1 / Queue 创建或部署

## 开发规则

当前第六阶段分支：`feat/queue-pipeline-v1`。

该分支从已验收的 Batch Pipeline v1 HEAD `cd3018f7a9db2d22fa2ab4e1d602493eb881f4da` 创建。此前堆叠 PR 保持未合并，在本阶段 Hermes 验收前不得修改 `main`。
