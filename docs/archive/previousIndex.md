> 2026-10-23 归档：这是文档整理前的历史快照。当前目标见 [总计划](../plan.md)，当前状态见 [进度](../progress.md)，其他记录见 [归档目录](readme.md)。旧文中的“当前”、版本和待办仅适用于原记录日期。

# 零幕文档目录

[返回项目首页](../../README.md)

## 项目介绍

项目介绍只有[简体中文 README](../../README.md)一份。原 21 种语言的介绍页属于上游项目文档，2026-10-28 随品牌整理删除，不再提供入口。

## 使用与开发

- [使用教程](https://qcn7xdsqgc4z.feishu.cn/docx/RXFqdgR2Xo0dXZxGfd0cZCGgnwf)：日常操作与创作流程。
- [开发与扩展指南](previousDevelopment.md)：源码运行、插件扩展、桌面打包和更新发布。
- [贡献指南](../../CONTRIBUTING.md)与[开发规范](../../AGENTS.md)：参与项目的约定。
- [多语言维护说明](../../packages/i18n/readme.md)：字典抽取、动态文案、前后端接入和语言回退。
- [多语言回归记录](../../packages/i18n/regression.md)：已完成的检查与已知范围。
- [MCP 接入说明](../../packages/mcp/README.md)：外部客户端连接与工具能力。

## 目录约定

```text
docs/
  readme.md          文档入口
  development.md     开发与扩展指南
  readme/            各语言项目介绍
  images/            标识、认证与社区图片
    screenshots/     产品截图
    sponsors/        赞助商图片
```

各子包的实现与维护说明保留在对应 `packages/` 目录。更新项目介绍时，以根目录 `README.md` 为准同步其余二十份译版；图片统一复用 `images/`，移动文件时同时更新 Markdown 和 HTML 中的相对链接。
