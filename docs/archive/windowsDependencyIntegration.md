> 2026-10-23 归档：这是文档整理前的历史快照。当前目标见 [总计划](../plan.md)，当前状态见 [进度](../progress.md)，其他记录见 [归档目录](readme.md)。旧文中的“当前”、版本和待办仅适用于原记录日期。

# 2.0.11 依赖整合与原生重开验收

2026-10-20，执行记录第三十九批，对应 F12/M5。第三十八批的依赖与公式资源改动已在同一隔离目录实际安装，本文补齐原生环境证据；完整产品计划仍在执行。

后续第四十一批已实际升级为 2.0.12，并补齐配置校验的原生保存、重启与恢复原值，全部 363 份既有项目文件摘要保持，见 [2.0.12 原生安装](windowsToolProcessIntegration.md)。本页保留 2.0.11 当次的历史验收范围。

## 实际安装

复用第三十八批最终候选 2.0.11 / 2gju0obkclvk5。安装器 69590314 字节，SHA-256 344e12c8ec29debdcf8daf95585808ba88885d1edca1055d216cb7adba8ce0e4；执行前重新核对冻结的三个产物摘要。没有重新构建，也没有使用补许可证前的初次候选。

升级前记录安装数据中 workspaces 下全部 363 份文件，合计 2610221937 字节。原生 2.0.10 的 300 节点画布显示已保存，经 Alt+F4 正常退出，确认旧 Bun 进程结束后执行 NSIS 升级。同一交互用户上下文的登记由 2.0.10 变为 2.0.11，位置不变，安装器退出 0。安装后首次启动前，363 份文件大小和摘要全部一致。

通过实际 SDK 启动器启动后，原生更新说明显示 2.0.11 / 2gju0obkclvk5。实际程序仍位于 `work/windowsSpeechIntegration1792430288397/installedApp/`，应用与 data 分开；本次捆绑 Bun --version 为 1.4.0。

实际安装的两个资源与候选更新归档中的对应条目逐字节摘要一致：

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| app/Resources/app/mcp/stdio.js | 5735846 | f3666d45952f0a96dee9a3e697e910c2b5f3fb0182fc26b4e24e34dfaacc39a7 |
| app/Resources/app/views/mainview/licenses/katex.txt | 2326 | 26de42feff7e969702260a5202a05f7e8546060f7fb003c86ce499221182d4be |

## 安装目录自带 MCP 的实际调用

临时在该隔离应用启用 MCP，HTTP 设置保存同时提供当前 settings 与 base 快照，启用、恢复均返回 200。第三十八批内联保存的 400 来自遗漏必填 base；这次没有修改接口或绕过冲突保护。

实际 stdio 子进程使用安装目录的 Bun 和上述已安装 stdio.js，转发至原生宿主 `http://127.0.0.1:58723/mcp`。客户端列出 46 项工具、12 项资源，读取资源正文，通过 getProjectProduction、workspaceFiles 和 SDK read 读取第三十七批恢复项目及其 zeromuProject.json，均无工具错误。没有创建新的项目文件或调用生成。

随后通过带 base 的设置接口恢复原关闭状态。携带临时有效凭据的请求返回 401；磁盘配置 enabled=false，临时 token 字段不存在。正常重启后仍返回 401。验证只覆盖这次真实连接、资源及项目读取，不代表全部 Agent 会话能力、所有传输故障或插件隔离已验收。

## 原生公式、图表与正常重启

在原空白本地记忆中，经实际个性化文档接口保存 187 字符的本机说明，正文明确标注手动核对、未调用模型生成。原生「设置 → 创作偏好 → 查看与编辑」显示两个块公式、分数、上下标及三节点 Mermaid 图；原生截图保存实际显示。没有修改本地记忆启用开关，也没有改动系统 DPI。

经 Alt+F4 正常退出并确认进程结束，用实际启动器重开，Bun PID 48352 → 35740，端口 58723 → 50204。重新进入同一原生预览，公式和图表仍显示，文档摘要始终为 ffad709ab3d06d605307fe54437e1857857913a894cf97f08a15a211fd763ea1。随后从画布仓库打开原 mediaScaleCanvas，仍为 300 节点、25 条连接、20% 画布缩放并显示已保存。

最终全部 363 份既有项目文件的大小与摘要保持，包括工作画布 JSON；本批相对升级前 2.0.10 检查点，画布 SHA-256 仍为 77a9ee6fa20afa36050f9f3794390b0d55d22f6c9039c9bd3a81b4d64a13b606。这不撤回第三十七批相对归档初次打开时发生初始化的历史差异。新本地说明位于 data/memories，不包含在上述旧项目文件数量中。

本轮没有对 WebView2 做完整网络抓包，不给出完整离线或全部远端资源连接结论；预览控件仍可见部分英文标签，也没有据局部显示声称全部本地化或可访问性完成。不同系统 DPI、干净机器和跨设备继续保留原门槛。

## 证据与当前范围

证据根目录 `work/windowsDependencyIntegration1792463740182/`，指针 `work/currentWindowsDependencyFixture.json`。主要记录包括：

- beforeUpgradeProjects.json、afterInstallProjects.json、finalProjectIntegrity.json。
- installerResult.json、launchResult.json、restartResult.json、nativeProcessIdentity.json。
- installedResources.json、installedMcpStdioHttp.json、installedMcpRestored.json、nativeRestartDocument.json。
- native211Release.jpg/.txt、native211Markdown.jpg/.txt、native211MarkdownRestarted.jpg/.txt、native211ScaleRestarted.jpg/.txt。
- windowsDependencyFinalSummary.json 与 ownedTasksAfter.json；三个本批安装/启动/重启计划任务均退出 0 后移除。

本批没有运行时代码、依赖、测试文件、框架或临时检查脚本变更；沿用第三十八批实际类型检查、构建、冻结安装和零组审计记录，不重复计为本批新执行。主 data/settings.json SHA-256 保持 65bb7d1f460553d78bba7de21ff633dace367b001a74c339d0e5c4901205a84a。

没有新增模型请求、本机配音或背景推理。Agnes 累计六次生成请求、估计占用 0.445 美元及人民币 10 元总上限保持，实际账单未知。当前候选未签名、未公开发布；插件执行隔离、真实成功视频、三类完整作品、账单核对、创作者试用及其余设备和发行条件继续执行。
