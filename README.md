# bilingual-curation-workflow

面向抖音双语长文内容的策展工作流。系统负责作品源检索、候选片段整理和待发布稿生成，最终审核与发布由用户手动完成。

## 已完成：MVP v1

1. 接收主题与已筛选作品片段。
2. 保留英文原文，不允许 AI 或排版流程改写原作。
3. 保存中文翻译、出处、来源类型与版权状态。
4. 按作品分段，用明显分隔线组合为双语待发布稿。
5. 对需要人工复核的来源给出 warning。

## 开发中：Source Pipeline v1

第二阶段增加作品源获取与候选筛选：

- 公版文学：Project Gutenberg 元数据经 Gutendex 获取，再从英文纯文本中按主题/查询词提取候选段落。
- 影视对白：English Wikiquote / MediaWiki API。支持直接指定 3～5 部影视作品名，再从对应页面抽取候选对白块。
- 所有影视对白默认 `quotation_review_required`。
- Gutenberg 候选默认 `public_domain_review_required`，发布前仍需按实际发布地区做最终公版确认。
- 当前阶段不调用 AI 改写原文。

作品源搜索接口：

```text
POST /api/sources/search
```

示例请求：

```json
{
  "theme": "love",
  "query": "love",
  "literatureQueries": ["love poetry", "romantic poetry"],
  "screenWorks": ["Before Sunrise", "Her", "La La Land"],
  "limitPerSource": 3
}
```

返回候选项包含：作品名、作者/来源、英文候选片段、来源 URL、匹配评分与版权复核状态。

## 当前明确不包含

- AI 原创整篇正文
- AI 改写影视对白或文学原文
- 抖音自动发布 / RPA
- 无人值守发布

## 技术形态

- Cloudflare Worker
- TypeScript
- Vitest
- 作品源：Gutendex / Project Gutenberg、English Wikiquote / MediaWiki API
- 后续再接 D1、AI 筛选/翻译层

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
```

数据结构定义见 `src/domain.ts`。

## 开发规则

当前第二阶段开发分支：`feat/source-pipeline-v1`。

Hermes 完成本机与真实网络源验收前，不合并到 `main`。
