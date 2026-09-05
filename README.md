# bilingual-curation-workflow

面向抖音双语长文内容的策展工作流。系统负责作品源检索、候选筛选、中文翻译和待发布稿生成，最终审核与发布由用户手动完成。

## 已完成：MVP v1

1. 接收主题与已筛选作品片段。
2. 保留英文原文，不允许 AI 或排版流程改写原作。
3. 保存中文翻译、出处、来源类型与版权状态。
4. 按作品分段，用明显分隔线组合为双语待发布稿。
5. 对需要人工复核的来源给出 warning。

## 已验收：Source Pipeline v1

- 公版文学：Project Gutenberg 元数据经 Gutendex 获取，再从英文纯文本中按主题/查询词提取候选段落。
- 影视对白：English Wikiquote / MediaWiki API。支持指定 3～5 部影视作品名，再从对应页面抽取候选对白块。
- 所有影视对白默认 `quotation_review_required`。
- Gutenberg 候选默认 `public_domain_review_required`，发布前仍需按实际发布地区做最终公版确认。
- Hermes 已完成 Gutendex / Pride and Prejudice 与 Wikiquote / Before Sunrise 的真实网络源验收。

作品源搜索接口：

```text
POST /api/sources/search
```

## 开发中：Selection + Translation v1

第三阶段让 AI 只承担两项工作：

1. 判断候选片段与本期主题的匹配度，以及脱离原剧情/上下文后能否独立理解。
2. 为入选片段生成忠实的简体中文翻译。

核心约束：

- AI 不负责创作整篇正文。
- AI 不负责重写、润色、现代化或缩写英文原文。
- AI 的响应结构中不需要返回英文原文；最终 `originalEn` 永远从抓取层候选对象回填。
- AI 只返回候选 ID、是否入选、主题匹配分、上下文独立性分、中文翻译与简短理由。
- 影视对白和公版文学仍保留人工版权复核 warning。
- 最终发布仍由用户人工完成。

AI 策展接口：

```text
POST /api/ai/curate
```

运行时配置：

```text
AI_BASE_URL=https://provider.example/v1
AI_API_KEY=...
AI_MODEL=...
```

接口按 OpenAI-compatible `POST /chat/completions` 形式调用，但业务层不绑定具体厂商。

## 当前明确不包含

- AI 原创整篇正文
- AI 改写影视对白或文学原文
- 抖音自动发布 / RPA
- 无人值守发布
- D1 持久化与批次任务调度

## 技术形态

- Cloudflare Worker
- TypeScript
- Vitest
- 作品源：Gutendex / Project Gutenberg、English Wikiquote / MediaWiki API
- AI 层：可替换的 OpenAI-compatible provider

## 本地验证

```bash
npm install
npm run check
npm run dev
```

接口：

```text
GET  /health
POST /api/preview
POST /api/sources/search
POST /api/ai/curate
```

数据结构定义见 `src/domain.ts`。

## 开发规则

当前第三阶段开发分支：`feat/selection-translation-v1`。

该分支从已验收的 Source Pipeline v1 HEAD `6fb6cbb1a75449f26f5f97a05a132c5b26c28c76` 创建。第二阶段 PR #2 仍未合并到 `main`。
