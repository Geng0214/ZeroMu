> 2026-10-23 归档：这是文档整理前的历史快照。当前目标见 [总计划](../plan.md)，当前状态见 [进度](../progress.md)，其他记录见 [归档目录](readme.md)。旧文中的“当前”、版本和待办仅适用于原记录日期。

# Windows 桌面版工作清单

第五十七批接通独立进程中的自定义 renderCall、renderResult，保留组件身份、共享状态、主题、焦点输入与异步刷新；实际 SDK 组件/HTML 导出、本地异常与边界核对、全工作区类型检查和仓库外 Bun 1.4.0 编译运行通过。完整 Windows 候选为 2.0.26 / 2vtjab8zslcnu，实际安装仍为 2.0.24，未计为新版原生联合验收。现有单元测试命令无匹配文件，没有计为通过，见 [同步钩子进度](toolSyncHooks.md)。

第五十六批完成自定义参数预处理的源码与编译冷运行，完整 2.0.25 / 1uuno8563ryfp 候选打包退出 0，468 份归档资源包含新增传输工作线程。本机仍为 2.0.24，未将候选构建计为实际安装或原生联合验收；自定义显示钩子继续实现。类型检查通过，现有单元测试命令无匹配文件，见 [同步钩子进度](toolSyncHooks.md)。

第五十五批已实际安装 2.0.24 / 158414d162n4e，467 份资源匹配、639 份原项目文件保持。卡片与节点定位及正常重开通过，两次卡片加载后的控制台均为 0 条消息，上一批两条子页面错误未再出现。三项表单标签提示及页面权限直接核对仍待完成；桌面归档及指定既有 NSIS 路径后的安装器打包通过，现有单元测试命令无匹配文件。见 [启动与重开记录](nativeStartupDiagnostics.md)。

第五十四批已实际安装 2.0.23 / 1rsn8e5axrea9，类型检查与完整打包通过，467 份安装资源匹配。原生工具卡片及正常重开后恢复和定位通过，639 份原项目文件保持；主页面启动控制台无消息，工具子页面仍有两条框架错误，完整原生桥验收继续保留未完成状态。现有单元测试命令无匹配测试文件，未记为通过。见 [启动与重开记录](nativeStartupDiagnostics.md)。

第五十三批明确启用桌面页面的受限原生桥模式，完整 Windows 候选构建及 2.0.19 → 2.0.21 / 2zrk9nrq2bytz 实际安装通过。首次启动前 467 份程序与页面资源匹配，649 份项目文件及设置保持；原生首页、文件夹选择、手动历史工具卡片与节点定位通过。正常重开首页已观察，639 份原项目文件及重开前 11 份验收项目文件保持。页面权限的额外检查、重开后的工具卡片界面复核及控制台异常仍未全部验收，见 [桌面原生桥记录](desktopNativeBridge.md)。

第五十一批将工具界面移入独立页面，保留当前提问提交、节点定位及复制能力，并补齐应用语言、主题和字号继承。语言修订后在深浅主题、三种窗口和三种字号下完成 18 组核对；后续修正另核对画布切换恢复与错误提示完整显示；选项、自由补充、制作表单与跳过取得实际本地回执，节点定位和键盘操作通过。Windows 2.0.20 / 1n5ckjgp6fgym 候选构建通过；本机实装仍为 2.0.19，原生整合继续验收。见 [工具界面独立页面](toolViewIsolation.md)。 安装器 69756735 字节，SHA-256 b9c94a50ccf8c2a1387bd88e2cc7982e62df2fcf4c24a4082d2f75ede473246c。本条是候选构建与浏览器工具界面范围。

第五十批补齐应用 85%–150% 字号，修复制作导航遮挡焦点、页签断词、缩小窗口过渡裁切，以及成片保存和导出后的键盘焦点。成片面板在深浅主题下完成 18 组标准窗口/字号组合及 2 组补充窄窗核对；键盘保存、两次本地 MP4 导出与播放至结束通过。实际安装为 2.0.19 / m1cu5aex0c9i，464 份程序与页面资源匹配，639 份既有项目文件保持，原始字号设置恢复。见 [成片键盘与窗口记录](filmKeyboardAndLayout.md)。这些结果不替代系统 DPI、其他设备、真实模型作品或正式发行验收。 安装器 69732415 字节，SHA-256 `cecadcc19fcf4fc7e22e58fa7ffbabd09a0314fe586c65e290761ad6395ad8e2`，冻结于 work/workspaceLayout1792507686801/candidate219/artifacts。未签名、未公开发布。

第四十九批已完成《迟到的回信》8 句本机配音与 32 秒声音草稿，保留字幕、逐镜头声音依据和含 8 项任务回执的完整项目包。修复了素材版本回执归档遗漏及媒体节点载入时自动填写模型、改写参数的问题；实际安装更新为 2.0.17 / 25ifo3zirucek，新恢复副本原生打开后 82 份归档文件保持，声音播放至结束，正常重开后 639 份项目文件保持。见 [声音制作与归档](comicAudioProduction.md)。画面和人工听审仍待完成，未计作完整成片；外部新增生成与支出为 0。 安装器 69719566 字节，SHA-256 `e91ca3ac126d3ab090f7e18a6fc9f57f40aa4f58409a0c1c37e8b0c1c8ac47ab`，冻结于本批 candidate217/artifacts；未签名、未公开发布。

第四十七批新候选 2.0.15 / idgql0zyin6t：供应商加载与生成工作进程、宿主能力及任务持久化已接入，源码/编译 HTTP/仓库外 Bun 1.4.0 冷运行通过，完整 Windows 打包退出 0。安装器 69725044 字节，SHA-256 `a7a489cc3e1e41374d1823668193dfcd9f3d4928ba77c3b1e43de7e4d183e631`，见 [供应商执行隔离](providerExecutionIsolation.md)。第四十八批已完成实际安装与原生内置供应商回归，见 [2.0.15 原生验收](windowsProviderExecution.md)；未签名、未公开发布。

第四十四批新候选：2.0.14 / 6lnv5wewuvtl，完整打包退出 0。安装器 69706055 字节，SHA-256 `45b162b077dbe7ead35403d21acbb03fb04ef787b1fba1b507f505a1ca04be16`，冻结于 `work/canvasPersistence1792496806264/candidate214/artifacts/`。画布、文本节点与隔离工具资源已核对；保存修复已在独立 300 节点副本完成编辑、失败重试与重载，见 [画布保存一致性](canvasPersistence.md)。第四十五批已在原隔离目录实际升级为 2.0.14，原生编辑、重命名和正常重开通过，367 份既有文件保持，见 [原生保存验收](windowsCanvasPersistence.md)。未签名、未公开发布。

更新：2026-10-21；基础检查始于 2026-10-09。路线见 [桌面计划](windowsDesktopPlan.md)，风险和证据见 [安全检查记录](desktopSecurityReview.md)。

## 本轮已完成

- [x] 将 Windows 本地创作工具定为首阶段；API 中转、充值与云账号移到后续商业化阶段。
- [x] 使用 `impeccable` 整理首页入口、画布卡片、搜索与选择操作、提示词信息层级；保留深浅主题和固定左侧创作面板。
- [x] 实际检查 1280×720、900×650、640×700 窗口，以及应用字体 125%；这不等同于所有系统 DPI 和浏览器版本的覆盖。
- [x] 验证画布新建、节点添加、自动保存、刷新重开，画布搜索与选择删除入口；保留真实用户数据，未执行用户文件删除。
- [x] 验证工作站草稿恢复、左侧面板宽度恢复及必要生成参数；提示词可带入生图创作；验证资产新增、刷新重开与文字预览。
- [x] 应用 `security-best-practices`；安装 `security-threat-model` 供后续专项使用。
- [x] 限制本机 API 来源、危险文件路径、目录链接越界、请求体大小；保护文件预览和解析错误响应。
- [x] 修复更新未配置时的状态、HTTPS 下载和重定向检查；避免旧更新地址阻断无关设置保存。
- [x] 给零幕独立安装标识和启动协议，避免覆盖已有 Toonflow 登记。
- [x] 修复 Electrobun SDK 准备及 Windows 编译器/NSIS 路径检查；使用真实 SDK 完成全仓类型检查。
- [x] 完成 26 项 HTTP 检查、更新状态/传输验证、前端构建、Windows 桌面构建和 NSIS 打包。
- [x] 升级 `proxy-addr` 至 2.0.8；第三十八批继续处理当时剩余 9 组告警，当前源码锁文件审计为 0 组，实际兼容范围见 [依赖维护](dependencyMaintenance.md)。

## 本机交付物

- 安装包：`work/windowsToolBoundaryIntegration1792494593269/candidate213/artifacts/zeromu-2.0.13-Setup.exe`，69,716,703 字节。
- SHA-256：`42b5e832df7a9945bfa2a1e9bff10c3b82c620fa52c62f371db29360f04d3d2c`。
- 更新清单：`build/desktop/artifacts/stable-win-x64-update.json`。
- 更新包：`build/desktop/artifacts/stable-win-x64-zeromu.tar.zst`。
- 安装包身份：`local.zeromu.desktop`；版本 `2.0.13`；构建 `1yh6hryb6dxfa`；Windows x64；当前未签名、未公开发布。
- 当前实装构建副本：`work/windowsToolBoundaryIntegration1792494593269/candidate213/artifacts/`。第四十三批实际完成工具边界加固、安装版隔离工具与原生宿主联合验收及正常重开，见 [2.0.13 联合验收](windowsToolBoundaryIntegration.md)。安装后首次打开前 363 份旧文件保持；原生交互后 362 份及原媒体保持，工作画布字节变化单独记录。旧 2.0.13 中间候选保留于本批 `priorCandidate/`。
- 较早 2.0.12 实装副本：`work/toolProcessAcceptance1792465604356/candidate212/artifacts/`。第四十一批的配置保存、拒绝非法参数、重启保留与项目摘要保持范围见 [原生验收](windowsToolProcessIntegration.md)。
- 较早 2.0.11 实装构建副本：`work/dependencyMaintenance1792461918207/candidate211/artifacts/`。第三十八批处理源码九组依赖告警、验证 MCP stdio → HTTP 和本机公式/图表资源，完整打包退出 0；第三十九批已实际安装为 2.0.11，安装目录自带 MCP 和原生公式/图表、正常重启与 363 份项目文件保持通过，见 [2.0.11 原生整合](windowsDependencyIntegration.md)。candidate211Initial 是补许可证前的历史候选，不与当前摘要混用。
- 较早 2.0.10 安装器副本在 `work/windowsPerformanceIntegration1792459664638/candidate210/artifacts/`。第三十七批实际完成 2.0.9 → 2.0.10，56 份既有项目文件摘要一致；原生选择上传 1.20 GiB 项目包、独立恢复 303 份文件、300 节点视频操作及换端口重开通过，200 份原媒体保持。画布参数初始化与布局差异单独记录，见 [2.0.10 大项目验收](windowsScaleRecovery.md)。
- 较早 2.0.9 安装器副本：`work/studioContextAcceptance1792456453037/candidate209/artifacts/`。第三十三批完成 2.0.8 → 2.0.9、55 份既有文件保持及未生成草稿换端口恢复；第三十七批升级后再次确认该草稿保持，见 [2.0.9 验收](studioContextRecovery.md)。
- 较早 2.0.8 安装器副本：`work/localBackgroundAcceptance1792450278332/nativeCandidate208/artifacts/`；第三十二批日志在 `work/nativeBackgroundInstall1792455077166/`。当批原隔离安装由 2.0.7 实际更新为 2.0.8，25 份既有项目文件摘要一致；安装版完成背景移除以及图片另存为覆盖、拒绝和取消，见 [2.0.8 安装版验收](windowsBackgroundFiles.md)。安装仍位于 `work/windowsSpeechIntegration1792430288397/installedApp/`，本机配音原目录五条及恢复目录三条音频保留。较早 2.0.7 安装器与原生音频记录保留在 `saveDialogCandidate/` 和 [第三十批记录](windowsNativeFiles.md)。
- 第二十八批较早的 2.0.5 安装器在 `work/windowsRegistrationRecovery1792417564896/candidate/`，补齐开始菜单入口；仅替换 app 更新包不会创建该链接。第二十七批模板数据仍在 `work/windowsTemplateIntegration1792415669053/installedApp/data/`；该旧隔离安装已默认卸载，111 份项目文件摘要保持。较早安装器和记录保留于各批 work 目录及 `build/desktopReview/`，均不纳入 Git，不与当前摘要混用。
- 界面证据：`build/desktopReview/homeVerified.png`、`canvasVerified.png`、`studioVerified.png`。

## 本机生命周期验收（2026-10-16）

本次使用真实 NSIS 安装包和 Electrobun 原生窗口，安装位置为独立的 `work/windowsLifecycleAcceptance1792161753287/installedApp/`。执行前本机没有零幕的卸载登记、协议或快捷方式；验收结束后已卸载这份隔离安装并清理对应登记，项目和证据仍保留。没有改动用户原有项目，也没有使用真实模型凭据。

设备为 Windows 11 家庭中文版 x64（10.0.26300），Ryzen 7 8845H、8 核 16 线程、系统报告内存 25,012,031,488 字节；显卡清单含 Radeon 780M 和 RTX 4060 Laptop。这是一台已有 WebView2 155.0.4283.45 的开发机器，不能代表干净机器、缺失运行时或所有显示器缩放。

| 实际路径 | 结果与证据 |
| --- | --- |
| 安装与原生启动 | 旧版 2.0.0 静默安装返回 0；原生窗口显示版本、首页和画布。实际经原生文件对话框导入八节点画布并打开 |
| 关闭重开 | 通过窗口关闭按钮退出，确认本安装的进程退出；重新启动后画布列表仍含 legacyCanvas |
| 覆盖升级 | 运行时安装返回 2 且旧版保持；关闭后 2.0.0 → 2.0.1 安装返回 0，旧画布八个节点身份保留，并在新版原生工作区打开 |
| 快捷方式记录 | 修复 SDK 记录 zeromu.lnk、实际创建「零幕 ZEROMU.lnk」的不一致；最终安装包实装后路径一致 |
| 默认卸载 | 原生卸载页的「同时删除用户数据」默认未勾选；运行时卸载被拒绝。默认静默卸载移除程序、卸载器、登记、协议和快捷方式；五份设置、项目和保留标记的卸载前后摘要一致 |
| 应用内更新 | 本机 HTTP 更新源提供真实的两个版本产物；检查、全量下载、Task Scheduler 更新交接和原生自动重启成功；最终运行版本 2.0.1、构建 3nzac1f2q75e9，界面就绪事务与版本吻合 |
| 下载中断与重试 | 更新包传输截断后仍运行旧版，临时下载清理；重试成功。最终安装后的客户端也实际返回「更新包不完整或无法读取，请重新下载。当前应用和项目数据未改变。」 |
| 更新助手保护 | SHA-256 不符时拒绝；就绪后撤销计划，原应用继续运行；一次窗口操作延误触发 60 秒超时取消，没有替换程序 |
| 启动失败恢复 | 只把真实 2.0.1 构建独立副本的 main.js 截为 0 字节；助手确认新版在界面就绪前退出，自动恢复并启动 2.0.0。已实际看到恢复后的原生首页，接口可用并说明已恢复旧版本 |

完整记录在上述隔离目录中的 `upgradeAcceptanceResult.json`、`uninstallAcceptanceResult.json`、`updateTransportAcceptanceResult.json`、`inAppUpdateAcceptanceResult.json`、`updateIntegrityAcceptanceResult.json`、`updateCancellationAcceptanceResult.json`、`handoffTimeoutAcceptanceResult.json`、`rollbackAcceptanceResult.json`、`finalInAppUpdateAcceptanceResult.json`、`finalDownloadFailureAcceptanceResult.json`、`finalInstallerAcceptanceResult.json` 和 `finalUninstallAcceptanceResult.json`。`finalBuild.log` 保存最终完整构建日志，`baseline/`、`candidate/`、`finalCandidate/` 保留各次实际产物及摘要。

原生截图为 `baselineCanvasOpen.png`、`baselineReopenCanvasLibrary.png`、`candidateLegacyOpen.png`、`uninstallDefaults.png`、`inAppUpdatedNative.png`、`rollbackNativeRestored.png` 和 `finalNativeVersion.png`。WebView2 数据保留摘要包含自建标记；尚未完成缺失运行时安装和完整浏览器配置迁移验收。原生「另存为」、完整制作项目在安装环境中的归集恢复，以及系统 100%/125%/150% 缩放继续验收。

## 2.0.2 整合版原生验收（2026-10-19）

在同一开发机的独立目录 `work/windowsIntegratedAcceptance1792343968893/installedApp/` 实际安装、升级和卸载，未使用真实模型凭据。完整执行记录见 [第二十一批](productDevelopmentProgress.md)。

| 实际路径 | 结果与证据 |
| --- | --- |
| 构建与运行中保护 | 整合第十一至二十批实现，实际打包退出 0；2.0.1 运行时执行新版安装返回 2，抽查文件不变。`buildFinal.log`、`candidateBuildResult.json`、`runningInstallProtection.json` |
| 应用内升级 | 真实 2.0.1 → 2.0.2 经本机源检查、全量下载、助手交接和原生自动重启成功；实际回执和界面均匹配 uub1bcrlgi8d。`nativeUpdateCheck/Download/Apply.json`、`nativeUpgradeVerification.json`、`updateTransactionReceipts/` |
| 技能与用户资料 | 三项指定内置工作流资料迁移到新版，用户编辑的 canvas 技能保留；267/268 项检查点逐字节一致，设置仅增加已读版本字段。16 个节点/工具与新资源一致，禁用标记和嵌套包存档保留。9 项迁移、10 项模拟回执检查通过；真实首页缺失回退另见下节 |
| 原生分镜 | 通过既有 MCP 打开隔离八节点项目，实际按钮下移/恢复、鼠标把手拖动和方向键恢复，修订 75 → 79；除修订与时间外制作记录一致。`nativeStoryboardResult.json`、`nativeStoryboardBefore/After.png` |
| 安装版项目包恢复 | 现有接口打包 4,318,272 字节，恢复新目录；122 项包摘要均匹配，121 项源文件字节相同，画布仅序列化不同且完整对象相同。六镜头、六候选、一剪辑、九导出记录保持。`nativeProjectRecoveryResult.json` |
| 原生成片预览 | 恢复项目通过 MCP 打开后，原生界面读取裁切、两音轨和字幕；已有成片播放到 8.9 秒、267 帧末尾，字幕可见。素材是本地色块和测试音，没有验收声音听感。`nativeRecoveredPlaybackResult.json`、`nativeRecoveredPlaybackStart/End.png` |
| 同构建重装 | 最终 2.0.2 安装返回 0，11 项资料摘要保持；首次启动重写节点/工具标记为新构建，16 个资源匹配。`sameBuildReinstallResult.json`、`nativeReinstalled.png` |
| 默认卸载 | 运行中卸载返回 2；正常 `/S` 卸载后程序、卸载器、登记、协议和快捷方式均移除，隔离数据保留。首次误用原地执行参数的失败单独记录；又从完整安装重复正常卸载，432 项数据文件及标记全部保留。`defaultUninstallResult.json`、`finalNormalUninstallResult.json` |

原生文件导入确认受到工具跨进程窗口判定阻断；另存为进程和对话框已出现，但工具没有返回可控窗口，未验证落盘。没有把接口恢复算作原生文件上传/选择目录成功。MCP 仅对自建实例临时开启，验收后关闭；安装与登记最终清理，本轮本机更新服务停止，所有证据保留。WebView2 只核对自建标记，不能据此声称完整配置迁移完成。

## 服务已启动但界面缺失的实际回退（2026-10-19）

第二十二批在 `work/windowsUiRollbackAcceptance1792404365461/` 使用真实 2.0.1 安装包和 2.0.2 更新包独立副本，只移除副本首页 HTML。没有改动正式交付产物，也没有伪造 `/api/desktop/ready` 或助手回执。

新版服务实际运行，首页 404，六镜头制作接口返回 200，16 个插件文件匹配新包（9 个较旧版变化）。此时 12 份旧技能全部保持，workflow 为 2.7.0，未新增通用视频参考。实际助手 PID 与事务对应，连续观察到等待期间旧技能保持；120 秒界面超时后，助手自动恢复并启动 2.0.1 / 3nzac1f2q75e9。全部插件恢复旧摘要，项目和技能保持，设置只新增更新失败记录。原生界面显示失败目标，且仍能新建画布、添加文本节点和自动保存。

证据为 `liveNewServiceObservation.json`、`liveHelperObservation.json`、`rollbackTimeline.jsonl`、`actualRollbackReceipt.json`、`restoredVerification.json`、`restoredCanvasResult.json` 与 `uiRollbackFinalSummary.json`；截图为 `newServiceMissingUi.png`、`restoredNative.png`、`restoredCanvasUsable.png`。旧版提示采用“版本或构建与目标不一致”的恢复说明；准确的 120 秒超时原因位于助手回执，不把它说成界面展示了该具体原因。

验收后正常卸载本次安装，168 个 data 文件全部保留，登记、协议和快捷方式清理，更新服务停止。该案例覆盖首页缺失、服务存活但未发送就绪确认的实际路径；首次绘制后崩溃、其他系统/设备及原生文件对话框仍需各自验证。

## 从源码构建

在仓库根目录运行；需要 Bun、Windows 系统 C# 编译器、NSIS 及能够访问官方 SDK 下载源的网络。

```powershell
bun install
bun run prepare:desktop
bun run typecheck
$env:appVersion = "2.0.5"
bun run package:desktop
```

`package:desktop` 包含桌面构建。仅构建可运行目录时用 `bun run build:desktop`。NSIS 不在默认安装位置时，先设置 `$env:NSIS_PATH` 为 `makensis.exe` 的绝对路径。SDK 下载失败时排查官方资源连接和完整性，不用临时类型声明代替 SDK。

## 下一阶段验收顺序

第二十五批已生成 2.0.4 / 2thb34hvynafi，通过项目文件持久化修复第二十四批发现的草稿丢失。实际 2.0.3 → 2.0.4 更新后，在原生界面修改正文并保存，再关闭重开；端口 58598 → 52006，正文、1K、3:4 和 PNG 参考完整恢复，草稿摘要一致。21 项实际 HTTP 检查、当前来源旧缓存迁移、双窗口冲突和读取失败保护、完整项目包恢复通过。更早其他端口的旧缓存未自动取回；该包仍为内部验收候选。详见执行记录第二十五批。

**第二十六批发现的旧模板文本缺陷已整合进第二十七批 2.0.5。** 本机实际 2.0.4 → 2.0.5 更新成功；原生“打开项目”经 Windows 文件夹选择器打开旧项目。三个项目共 15 个文字节点迁移为编辑副本，33 个固定素材文件保持；原生编辑、项目切换和换端口重开保留文字。另在安装版应用一个新模板，4 个编辑副本直接创建成功，详见执行记录第二十七批。三个具体范例仍为输入项目包，均无成片。

**第二十八批更正版本登记判定：此前混读了两个执行上下文的 HKCU 记录。** 任务服务读到早先 2.0.1 验收目录的登记，命令环境读到本轮目录；2.0.5 按归属保护保留另一目录的登记。现已在同一任务服务上下文完成实际 NSIS 2.0.4 安装、2.0.4 → 2.0.5 更新及登记读取，更新首次启动后 DisplayVersion 即为 2.0.5，不需要重开。原有混读观察不再作为产品同步缺陷证据；本机一致性范围见执行记录第二十八批。原生上传和“另存为”、真实视频与音频、账单及发行门槛继续保持未完成。

同批确认原 NSIS 仅创建桌面链接，开始菜单链接虽已写入卸载元数据却未创建。当前安装器补齐该入口，实际同目录安装后，桌面和开始菜单链接都指向本安装启动器，协议与版本登记匹配。默认卸载后的同一上下文复核确认两种链接、程序、协议和登记均清理，项目与早先范例数据保留。本次卸载退出码因信息收集进程误用 bun.ps1 未留存，随后仅重新读取最终状态，没有再次执行卸载；不据此报告未观察到的退出码 0。快捷方式失败警告分支、干净 Windows 及其他系统缩放不在本批验证范围。

- [x] 本机独立目录的真实安装、原生启动、关闭重开、已有 WebView2 检测、旧画布和默认卸载保留数据；范围与证据见上。
- [x] 2.0.2 整合包、跨版本成功更新、资源/技能迁移、同构建重装、原生分镜及六片段项目包的安装版接口恢复与原生播放；范围见上。
- [x] 新版服务存活而首页缺失时，真实 120 秒界面超时回退、旧技能保持、旧插件恢复以及恢复后继续创作。
- [x] 2.0.7 本机原生音频另存为落盘及取消、正常关闭换端口重开；项目包原生选择上传、选择恢复目录及独立恢复，见 `windowsNativeFiles.md`。
- [x] 2.0.8 完整打包、内部原生副本的镜头编辑入口，以及实际安装更新后的背景移除和图片另存为覆盖/拒绝/取消，见 `backgroundRemoval.md`、`windowsBackgroundFiles.md`。
- [x] 2.0.10 实装整合隐藏视频浮层优化；原生选择上传 1.20 GiB 大包、303 文件独立恢复、300 节点播放/静音/截帧/撤销及正常重启，详见 `windowsScaleRecovery.md`。
- [ ] 干净 Windows、缺失或旧 WebView2、不同系统缩放、跨设备，以及原生对话框的超长路径等边界；图片覆盖确认、拒绝和取消已在第三十二批通过。
- [x] 模型与插件市场 API Key 存储、迁移、脱敏响应、请求目标及恢复专项检查，见 `apiCredentialSecurity.md`（2026-10-13）。
- [x] 本机依赖维护整合及安装兼容验收：源码九组告警处理、路由/MCP/公式与图表回归、2.0.11 实装、安装目录自带 stdio、原生预览、重启和 363 项目文件保持通过，见 `dependencyMaintenance.md`、`windowsDependencyIntegration.md`；不扩大为干净机器或所有功能兼容结论。
- [x] 2.0.12 本机安装及配置校验跟进：原生保存、安装版非法参数拒绝和重复确认启用、正常重启保留、恢复原值与旧项目文件保持，见 `windowsToolProcessIntegration.md`；本批没有从原生界面禁用到启用内置工具。
- [x] 2.0.13 工具边界加固及本机安装联合验收：实际安装资源、SDK 文件/技能/FFprobe、真实画布回调、工作区拒绝、取消清理与正常重开通过；临时 MCP 关闭，项目字节变化例外见 `windowsToolBoundaryIntegration.md`。
- [ ] 完整插件进程隔离；第四十二至四十三批已接入 Agent/MCP/团队执行并整合实际 2.0.13，文件队列、取消、FFmpeg 原生流、46 工具及安装版真实回调通过；同步钩子的候选安装版联合验收、真实模型多轮联合交互及界面边界仍待完成，见 `pluginExecutionIsolation.md`、`pluginExecutionBoundary.md`。
- [ ] 授权真实渠道的图片、视频、音频生成，以及取消、失败重试、素材复用与完整导出。
- [x] 两个真实构建在本机源下完成更新、下载中断与重试；原生更新助手完成校验拒绝、取消、超时和新版启动失败后的恢复。
- [ ] 自有 HTTPS 更新源、发布签名、干净机器验证与小范围创作者内测。
- [ ] 上述稳定后再启动独立 API 中转服务和收费体系。

当前实际安装版为 2.0.15 / idgql0zyin6t。第四十八批原生本机配音、背景移除和正常重开通过，369 份既有文件保持，详情见 [原生供应商验收](windowsProviderExecution.md)。第四十五批原生新增、正文编辑、重命名及正常重开通过；367 份既有项目文件完整保持，旧 300 节点画布字节、修改时间和文件标识均保持，详情见 [原生保存验收](windowsCanvasPersistence.md)。第四十三批的画布初始化例外仍保留在对应历史记录。此前工具隔离、公式/图表、本机更新与恢复、系统配音、背景移除、草稿及大型项目包等证据保持原范围。本批无新增生成请求，原供应商账单及未知提交状态不变；完整作品、完整插件边界、跨设备/系统 DPI、干净机器、可信更新源、签名和创作者试用继续推进，正式发行尚未完成。

第四十六批另行补齐 [工作站历史项目包恢复](studioHistoryPackage.md)：两张既有真实图片和一条本地视频在全新应用数据目录中恢复，8 份文件保持，无模型或原任务缓存时图片解码与视频播放通过。仅为本机浏览器和数据恢复证据；安装版及构建未变，不计作真实模型视频、干净机器或原生文件窗口验收。
