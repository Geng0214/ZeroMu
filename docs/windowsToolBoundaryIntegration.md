# 2.0.13 工具边界加固与安装版联合验收

2026-10-20，执行记录第四十三批。本机隔离安装已由 2.0.12 升级为包含工具执行隔离及本次防御性加固的 2.0.13。安装资源、原生窗口、安装目录自带 MCP、实际工具回调、取消清理及正常重开均已核对。本文只记录结果，不公开绕过细节或验证载荷。

## 交付与安装

- Windows x64，应用身份 `local.zeromu.desktop`，版本 `2.0.13`，构建 `1yh6hryb6dxfa`。
- 安装器 `zeromu-2.0.13-Setup.exe`，69,716,703 字节，SHA-256 `42b5e832df7a9945bfa2a1e9bff10c3b82c620fa52c62f371db29360f04d3d2c`。
- 冻结目录 `work/windowsToolBoundaryIntegration1792494593269/candidate213/artifacts/`，包含安装器、更新清单及更新归档。原先未包含本次加固的 2.0.13 中间候选另存于 `priorCandidate/`，不与最终构建混用。
- 实际安装目录继续为 `work/windowsSpeechIntegration1792430288397/installedApp/`；NSIS 退出 0，安装登记、资源版本与原生更新说明一致，捆绑 Bun 为 1.4.0。没有公开发布或签名。

本批重新执行 server、desktop 类型检查，均退出 0。`package:desktop` 已完成工具、节点、Web、MCP 与桌面资源构建，但默认 NSIS 路径不存在，最后打包步骤退出 1；保留 `packageBuild.log`。指定仓库已有 NSIS 3.13 后，对相同版本执行 `packageWindows.ts`，退出 0，见 `packageWindows.log`。没有将初次失败改写为完整命令一次成功，也没有重复计算前一轮的全仓类型检查与 58 项内存断言。

安装后的以下五个资源与冻结归档逐项匹配；宿主与执行工作进程均包含本次加固。

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| toolConfigWorker.js | 464395 | d9db8f8dbe323a03c79c4d0bea094f9f59db90a29439e009ca846cb4795cac40 |
| toolRuntimeWorker.js | 537310 | 4ddf6ced4947c3324a0b0b2c054d762b91e87998095b936f3d742226022276b6 |
| toolSyncClient.js | 625 | d689085ce1e68d14cfe54a095793c7b2667421afa3f30ddd82be4f4869678d7d |
| bun/index.js | 14835238 | 28132d5c7da6f3a1d466cdfa5f9925501649f7287ae568e51365a26bc5922f41 |
| mcp/stdio.js | 5735846 | f3666d45952f0a96dee9a3e697e910c2b5f3fb0182fc26b4e24e34dfaacc39a7 |

## 安装版实际结果

| 范围 | 本批结果 |
| --- | --- |
| 原生版本与启动 | 实际窗口显示 2.0.13 / 1yh6hryb6dxfa，宿主 PID 53284、端口 64514；不是源码服务替代安装版 |
| 安装目录 stdio → 原生 HTTP | 使用安装目录的 Bun 与 stdio.js，46 项工具、12 项资源及资源正文读取通过，桥接 stderr 为空 |
| 隔离工具与宿主 SDK | 实际 write、edit、read、ls、skillOperator、ffprobe 通过；最终文字为 second，媒体探测为 16000 Hz / 0.2 秒 |
| 工作区范围 | 跨项目读取与写入均拒绝，另一项目原文件保持；8 次并发设置读取均为 200 |
| 真实画布回调 | 原生打开旧 mediaScaleCanvas，实际隔离 getCanvas/getCanvasEdges 回调到同一 WebView，通过；300 节点、25 连线、20% 缩放及已保存状态可见 |
| 长任务取消 | 实际循环媒体任务取消后请求拒绝，宿主继续返回 200；已开始的输出可能留下部分文件，不将取消当作撤销 |
| 进程清理 | 第一段采样捕获 132 个独立工具工作进程；取消段另捕获 57 个相关进程，包含工作进程 59208 派生的 FFmpeg 59340。后续检查这些 PID 均已结束，宿主无遗留工具工作进程及该 FFmpeg |
| 配置保护 | 非法工具配置返回 400，设置摘要保持；已有工具重复确认启用返回 200，设置仍保持 |
| 临时连接恢复 | MCP 恢复关闭，临时 token 移除，原有效凭据返回 401；正常重启后仍关闭且无临时 token |
| 正常重开 | Alt+F4 后旧 PID 确认结束，实际安装启动器重开为 PID 50428、端口 57899，设置接口 200。用户协助手动还原窗口后，再由原生画布仓库打开旧画布，仍为 300 节点、25 连线、20% 和已保存 |

窗口恢复期间 Computer Use 曾返回人工输入与最小化状态；刷新后按实际窗口继续，没有把未成功的恢复动作计为通过。最后重开显示已在原生窗口实际观察。

## 项目完整性与例外

本批升级前基线为 363 份文件、2,610,222,121 字节；此基线按当前磁盘建立，不回溯宣称与第四十一批旧基线完全相同。安装后、首次打开旧画布前，363 份文件的大小及摘要全部一致。

原生打开后，362 份其他既有文件及全部原媒体摘要保持；工作画布首次由 314275 变为 314279 字节，摘要变化。本批最初只保存了打开前摘要，没有保存该时点正文，不能精确归因这 4 字节到具体叶字段，也没有用历史快照覆盖当前文件。

后续保存了首次打开后、重开过程及最终画布正文。重开过程中一度补齐 99 个空文本输出字段并更新连线派生坐标，随后空字段又被运行态处理；最终相对首次打开后快照，仅有 9 处连线派生坐标变化，非空内容及已有输出保持。与保留的历史画布比较，节点身份、位置、连线端点、非空正文及原媒体引用保持；既有默认模型、空编辑器及派生坐标差异单独记录。

因此本批不宣称原生交互结束后全部 363 份文件字节一致。工作画布的运行态字段、派生坐标及首次 4 字节差异继续随规模回归跟踪；实际最终摘要与逐项结果以 `finalProjectIntegrity.json` 为准。

## 证据与剩余范围

证据根目录 `work/windowsToolBoundaryIntegration1792494593269/`，指针 `work/currentWindowsToolBoundaryFixture.json`。主要记录为 `candidateArtifacts.json`、`installerResult.json`、`afterInstallIntegrity.json`、`installedMcpJoint.json`、`installedCanvasJoint.json`、`installedCancellation.json`、`nativeWorkerObservations.json`、`nativeCancellationProcesses.json`、`workerCleanup.json`、`installedConfigValidation.json`、`mcpRestored.json`、`nativeRestart.json`、`finalProjectIntegrity.json` 与画布比较快照。

本次运行时代码、锁文件与主仓库 `data/settings.json` 的构建前摘要保持，没有新增依赖、测试文件、临时检查脚本或测试框架。安装目录仅在两个本批专用工作区生成文字、短 PCM 媒体及取消输出；未修改真实生成任务，也没有新增付费模型请求、本机配音或背景推理。

本机安装版与隔离工具主链路已完成联合验收，上述画布字节差异作为明确例外保留。自定义同步钩子兼容、真实 Agent/团队及 A2A 多轮模型交互、真实提问与持久媒体故障、供应商和浏览器界面边界仍按原计划推进。普通用户子进程不等于操作系统沙箱；本次不替代干净机器、其他设备/系统 DPI、完整作品、账单核对、签名及正式发行验收。
