# Hermes Handoff — MVP v1

目标：只验证当前 `feat/mvp-v1` 分支是否能在 Windows 本机完成安装、类型检查、单测和 Worker 本地运行。

## 严格边界

- 不修改 `main`。
- 不合并 PR。
- 不修改产品代码；若发现代码缺陷，只收集完整错误证据并回报。
- 不部署生产环境。
- 不接抖音自动发布。

## 执行步骤

1. 克隆仓库或更新已有副本：

```powershell
git clone https://github.com/Felix8686/bilingual-curation-workflow.git
cd bilingual-curation-workflow
git fetch origin
git checkout feat/mvp-v1
git pull --ff-only origin feat/mvp-v1
```

2. 记录环境：

```powershell
node -v
npm -v
git rev-parse HEAD
git status --short
```

3. 安装依赖并执行检查。当前 MVP 尚未提交 package-lock，为保持验收后的工作区纯净，本轮禁止生成 lockfile：

```powershell
npm install --package-lock=false
npm run check
```

4. 启动 Worker：

```powershell
npm run dev
```

5. 在另一 PowerShell 窗口验证健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
```

6. 验证待发布稿预览：

```powershell
$body = @{
  theme = "love"
  hook = "关于爱情的几段英文"
  segments = @(
    @{
      id = "lit-1"
      theme = "love"
      sourceKind = "public_domain_literature"
      workTitle = "She Walks in Beauty"
      creator = "Lord Byron"
      originalEn = "She walks in beauty, like the night"
      translationZh = "她走在美中，如同夜色。"
      rightsStatus = "public_domain"
      sourceVerified = $true
    },
    @{
      id = "film-1"
      theme = "love"
      sourceKind = "screen_dialogue"
      workTitle = "Example Film"
      originalEn = "Do you still believe in love?`nI think I do."
      translationZh = "你还相信爱情吗？`n我想，我相信。"
      rightsStatus = "quotation_review_required"
      sourceVerified = $true
    }
  )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/preview -ContentType "application/json" -Body $body
```

## 验收标准

全部满足才算 PASS：

1. `npm install --package-lock=false` 成功。
2. `npm run typecheck` 0 错误。
3. `npm run test` 全部通过。
4. `/health` 返回 `ok: true`。
5. `/api/preview` 返回两段内容，中间包含分隔线。
6. 返回文本中的两段 `originalEn` 与输入逐字一致，没有被改写。
7. 影视对白片段产生 `quotation_review_required` warning。
8. `git status --short` 最终为空。

## 回报格式

请只回报以下内容：

1. 总体：PASS / FAIL
2. 当前 HEAD SHA
3. Node / npm 版本
4. `npm run typecheck` 结果
5. `npm run test` 结果与测试数量
6. `/health` 结果
7. `/api/preview` 是否保留英文原文、是否包含分隔线、是否产生版权复核 warning
8. 最终 `git status --short`
9. 若 FAIL：附最小必要完整错误信息与复现命令
