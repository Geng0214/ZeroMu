# GitHub 版本管理

## 仓库范围

上传本仓库根目录（当前本机文件夹名为 Toonflow-app），GitHub 仓库为 [Geng0214/ZeroMu](https://github.com/Geng0214/ZeroMu)。文件夹名不影响网页里的“零幕”品牌。

上一级 ZeroOne 是本地工作区，包含独立参考项目 infinite-canvas 和 localArchive，不作为一个大仓库上传。

- apps/、packages/：源码与正式品牌资源。
- docs/：项目文档，branding/ 内有品牌说明和界面预览。
- bun.lock、package.json：依赖及锁文件，一起提交。
- LICENSE：保留上游 MIT 许可。
- data/：API Key、渠道配置等本地运行数据，已忽略。
- node_modules/、build/、.hutch/、日志、环境文件及私钥：本地依赖、产物或配置，已忽略。

GitHub 保存源码版本；已忽略的 API 配置和创作素材需要另行备份。不要将真实密钥写入源码或提交记录。

## 仓库连接

- 自己的仓库（origin）：https://github.com/Geng0214/ZeroMu.git
- 上游仓库（upstream）：https://github.com/HBAI-Ltd/Toonflow-app.git
- 本地及远端主分支：main。
- 保留原项目完整 Git 历史，零幕修改作为后续提交记录。

模型渠道仍是开发中的进度，保存基线不代表所有接口已验证。

## 日常保存

在功能达到一个可回退的节点时：

```powershell
git status --short
git diff
git add .
git diff --cached --stat
git commit -m "简要说明本次修改"
git push origin main
```

多人或多个 Agent 同时编辑时，先协调好当前修改，再提交。不要向 upstream 推送。

## 更新与发布

- 上游为 HBAI-Ltd/Toonflow-app。需要查看新版本时运行 git fetch upstream，合并前检查与本地定制功能的差异。
- .github/workflows/release.yml 会在推送 v* 标签时发布桌面包；普通源码提交不会触发该发布流程。
- 桌面 SDK 及 macOS 签名配置需另行准备。尚未配置发布环境时，先只提交源码，不推送发布标签。
- 零幕的客户端更新使用你自己的发布源。

## 本次整理检查（2026-10-05）

当前待纳入 Git 的文件完成了常见令牌、私钥和硬编码密钥模式检查，未发现明确密钥；这不是对任意历史提交或所有凭据格式的完整审计。本地运行配置仍留在 data/。

此前网页构建及后端类型检查通过。前端完整类型检查因缺少 .hutch/devkit 桌面 SDK 类型声明而受阻。
