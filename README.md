# bilingual-curation-workflow

面向抖音双语长文内容的策展工作流。系统负责整理和生成待发布稿，最终审核与发布由用户手动完成。

## MVP v1

当前第一阶段只验证最核心的数据链路：

1. 接收一个主题与若干已筛选作品片段。
2. 保留英文原文，不允许 AI 或排版流程改写原作。
3. 为每个片段保存中文翻译、出处、来源类型与版权状态。
4. 按作品分段，用明显分隔线组合为双语待发布稿。
5. 对来源未核实、版权状态未知或影视对白等需要人工复核的内容给出 warning。

当前明确不包含：

- AI 原创整篇正文
- 自动修改影视对白或文学原文
- 抖音自动发布 / RPA
- 无人值守发布

## 技术形态

- Cloudflare Worker
- TypeScript
- Vitest
- 后续阶段再接 D1、作品源检索与模型调用

## 本地验证

```bash
npm install
npm run check
npm run dev
```

健康检查：

```text
GET /health
```

生成待发布稿预览：

```text
POST /api/preview
```

请求体使用 `PublicationDraftInput` 结构，定义见 `src/domain.ts`。

## 开发规则

当前开发分支：`feat/mvp-v1`。

在 Hermes 完成本机验证并回报之前，不合并到 `main`。
