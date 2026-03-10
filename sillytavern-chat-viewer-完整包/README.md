# SillyTavern Export Viewer

本地前端查看器，用来读取 SillyTavern 导出的 `.txt` / `.jsonl` 聊天记录。

功能：

- 默认净化显示正文，隐藏思维链
- 可切换为混合视图或原始文本视图
- 支持渲染摘要、状态栏、Markdown 表格、HTML 卡片、前端 `srcdoc` 块
- 支持主题切换
- 可导出当前主题下的完整 HTML，或只保留正文的纯文本

运行：

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```
