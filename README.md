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

AI 只负责：

1. 主题匹配与上下文独立性筛选。
2. 忠实的简体中文翻译。

AI 不负责创作、润色、现代化、缩写或改写英文原文。最终 `originalEn` 永远从抓取层对象回填。

### End-to-End Workflow v1

```text
主题
→ 真实作品源检索
→ AI筛选/翻译
→ 原文安全回填
→ 双语待发布稿
```

接口：

```text
POST /api/workflows/generate
```

搜不到素材或 AI 没有选中合格候选时，流程明确失败，不为了产量硬生成低质量稿件。

## 开发中：Batch Pipeline v1

第五阶段增加 Cloudflare D1 批次持久化。一次最多创建 20 个主题任务；一次运行请求最多处理 3 个 `pending` 项，避免单次 Worker 请求过重。

批次状态：

```text
pending → running → completed
                  ↘ partial_failed
                  ↘ failed
```

每个批次项独立保存请求、状态、成功结果或失败原因。某一项失败不会删除已经成功的待发布稿。

接口：

```text
POST /api/batches
GET  /api/batches/:batchId
POST /api/batches/:batchId/run
```

创建批次示例：

```json
{
  "items": [
    {
      "theme": "love",
      "literatureQueries": ["Pride and Prejudice"],
      "sourceKinds": ["public_domain_literature"],
      "limitPerSource": 1,
      "maxSelected": 1
    },
    {
      "theme": "marriage",
      "literatureQueries": ["Pride and Prejudice"],
      "sourceKinds": ["public_domain_literature"],
      "limitPerSource": 1,
      "maxSelected": 1
    }
  ]
}
```

运行批次：

```json
{
  "maxItems": 3
}
```

## 技术形态

- Cloudflare Worker
- Cloudflare D1
- TypeScript
- Vitest
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

AI 本地配置放在 `.dev.vars`，该文件已被 Git 忽略。

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
```

## 当前明确不包含

- AI 原创整篇正文
- AI 改写英文原文
- 抖音自动发布 / RPA
- 无人值守发布
- Cron / Queue 自动调度
- 生产 D1 部署

## 开发规则

当前第五阶段分支：`feat/batch-pipeline-v1`。

该分支从已验收的 End-to-End Workflow v1 HEAD `3aa3cbc66fd595c9e0e81a2b9ddf64abe7195c91` 创建。此前堆叠 PR 保持未合并，在本阶段 Hermes 验收前不得修改 `main`。
