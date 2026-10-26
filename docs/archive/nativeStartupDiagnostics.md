> 2026-10-23 归档：这是文档整理前的历史快照。当前目标见 [总计划](../plan.md)，当前状态见 [进度](../progress.md)，其他记录见 [归档目录](readme.md)。旧文中的“当前”、版本和待办仅适用于原记录日期。

# 原生启动与工具卡片重开记录

最新进度：2026-10-22，第五十五批实际安装为 **2.0.24 / 158414d162n4e**。两张工具卡片加载、节点定位及正常重开后的控制台均为 0 条消息，上一批两条工具子页面错误未再出现。三项表单标签提示与页面权限直接核对继续保留，完整计划未完成。第五十四批记录保留如下，第五十五批补充见文末。

日期：2026-10-22，第五十四批。承接 [桌面原生桥记录](desktopNativeBridge.md)。本批实际安装版本为 **2.0.23 / 1rsn8e5axrea9**。

## 修改及构建

未配置更新源时，启动检查保持只读，避免自动提交无效检查；用户主动检查仍保留明确错误。Windows 主页面清理已禁用通道的残留异步引用，继续保留非预期错误报告。桌面受限页面模式保持开启，固定原生 SDK 及依赖未替换。此前 toolChannel.ts、isolatedTool.ts 的边界加固、工具独立页面与锁文件均保持。

前端和桌面类型检查退出 0，完整 Windows 打包退出 0。两组各五项内存手动核对通过，范围分别为更新状态与主页面预载；这些结果不替代原生运行观察。现有命令 `bun test ./apps/web/src ./apps/desktop/src` 扫描 193 份文件，退出 1，无匹配测试文件，未记为单元测试通过；没有新增测试文件、框架或检查入口。

冻结安装器为 [zeromu-2.0.23-Setup.exe](../../work/nativeDiagnostics1792680107091/candidate223/artifacts/zeromu-2.0.23-Setup.exe)，69758765 字节，SHA-256：c04360598ec75276d372e8ca6d6e632a5c1b3da4966da712c8ae080dc94574db。四份产物均有摘要，467 份安装资源匹配。2.0.22 仅为中间构建，未安装。

## 原生结果

2.0.21 正常退出后完成升级，安装器退出 0；首次启动前 650 份项目文件内容与元数据及设置字节保持。2.0.23 启动时，默认日志级别、空筛选器下控制台为 0 条消息，未再观察到上一批主页面启动错误及无更新源的启动请求错误。问题面板仍有表单标签提示。

实际原生窗口打开专用 toolViewNative52 画布，工具卡片、已答制作表单及节点定位可用。随后正常退出，旧宿主 50828 及端口 56741 结束，单次重开为宿主 66100 / 端口 50636。重开后再次通过原生界面进入该项目，已答表单和节点入口恢复，定位另一节点并选中通过。画面见 [重开后的原生工具卡片](../../work/nativeDiagnostics1792680107091/nativeReopenToolView54.png)。这些会话明确标注为手动界面历史，没有调用语言模型，不计为新提问或真实 Agent 验收。

加载两张工具卡片后仍观察到 **2 条来自工具子页面的未处理 Promise 错误**，展开信息为原生对象缺失。主页面修复未解决该框架兼容问题；未屏蔽全局错误，未将完整控制台或原生桥验收记为通过。浏览器粘贴保护保持，上一批受阻的页面权限直接检查仍未取得运行态结论。

## 数据与范围

原有 639 份项目文件内容、修改时间和文件标识保持。650 份安装前文件中 649 份保持，只有专用验收项目的 toolViewDemo.json 在节点定位后变化；新增五份本批截图与记录，当前共 655 份。重开前独立记录的 14 份验收文件在重新进入画布、尚未进行卡片定位时内容与元数据全部保持。设置仅变化项目最近打开记录、项目列表及已读构建记录；外观、MCP 和其余设置保持。

本批无外部生成及新增支出，三笔未知视频继续保留。普通用户进程及 SDK 页面模式不等于操作系统权限沙箱。节点界面、自定义同步钩子、真实 Agent/团队/A2A、真实媒体和账单、三部完整作品、跨设备与系统 DPI、干净 Windows、创作者试用、签名和正式发行仍待完成。

## 证据

根目录 `work/nativeDiagnostics1792680107091`，指针 `work/currentNativeDiagnosticsFixture.json`。保留类型与构建日志、existingUnitTests.log、sourceSnapshots.json、updateStartupContract.json、nativePreloadContract.json、runtimeDiagnostic.json、installIntegrity.json、nativeUiEvidence54.json、nativeToolConsole54.json、nativeReopenUi54.json、restartFixtureIntegrity.json、finalProjectIntegrity.json、settingsAudit.json、finalSourceAndArtifactAudit.json 和 nativeDiagnosticsSummary.json。未新增测试文件；未签名、未公开发布。完整计划继续执行。

## 第五十五批子页面修复

Windows 子页面不需要原生事件通道，现已清理其残留引用；主页面事件入口继续保留，受限页面模式保持开启，没有增加全局错误屏蔽或修改原生 SDK。修改依据包含固定 SDK 的本机实现及 [微软 WebView2 帧文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/frames)，实际效果以下述原生观察为准。toolChannel.ts、isolatedTool.ts 的既有加固及其余保护源码、主设置与锁文件保持。

桌面类型检查及六项内存手动核对通过。首次 `package:desktop` 已完成插件、页面、MCP 与桌面归档，但在安装器阶段因默认 NSIS 路径不存在退出 1；使用项目此前采用的 NSIS 3.13 路径，直接续跑 `packageWindows.ts` 退出 0，没有把首次命令改写为成功。现有 `bun test ./apps/desktop/src` 扫描 7 份文件，退出 1，无匹配测试文件，未记为单元测试通过；没有新增测试文件或检查入口。

四份产物冻结在 `work/nativeFrameBoundary1792683092549/candidate224/artifacts`。安装器 [zeromu-2.0.24-Setup.exe](../../work/nativeFrameBoundary1792683092549/candidate224/artifacts/zeromu-2.0.24-Setup.exe) 为 69757299 字节，SHA-256：cb1c9c913c7c5733a645d45fde269abb0749f84b374bc1c3dbd5ef7d64cefc46。实际安装退出 0，467 份资源与归档一致，原生核心库与上一版一致。

升级前基线在旧版正常退出前采集。首次启动前 655 份基线文件中 654 份保持，只有专用验收画布 toolViewDemo.json 变化；缺少退出后、安装前的独立快照，未将该变化归因安装器，也未声称 655 份全部一致。原有 639 份项目文件内容与元数据以及设置字节保持。

实际原生版本 2.0.24，首次宿主 60496 / 52940。两张工具卡片、已答表单及节点定位通过，默认级别、空筛选器、未经清空的控制台为 0 条消息，见 [控制台截图](../../work/nativeFrameBoundary1792683092549/nativeConsole55.png)。问题面板的三项提示归类为表单标签使用问题，没有计为已修复。

正常退出后，19 份专用验收文件保持，关闭前后画布内容无变化。单次重开为宿主 68924 / 57437，在再次进入项目之前核对这 19 份文件内容和元数据全部保持；原生重开卡片、已答表单与定位另一节点通过，控制台仍为 0 条消息。见 [重开后的原生画面](../../work/nativeFrameBoundary1792683092549/nativeReopenToolView55.png)。所有会话仍为明确标注未调用模型的手动历史，没有计为新的模型或 Agent 验收。

结束时原有 639 份文件保持；当前共 660 份项目文件，新增五份本批截图与记录，唯一变化仍为专用验收画布。设置仅变化最近打开记录、项目列表与已读构建记录。13 份保护源码/配置、当前修改源码、四份冻结产物和 467 份安装资源再次核对一致。诊断窗口已正常关闭，应用保留运行。页面权限直接核对、标签问题、节点界面、自定义同步钩子及真实渠道、作品、设备、试用和发行门槛继续保留；无新增外部生成或支出，没有重发三笔未知视频。

本批证据根目录 `work/nativeFrameBoundary1792683092549`，指针 `work/currentNativeFrameBoundaryFixture.json`。主要记录为 sourceSnapshot.json、preloadContract.json、desktopTypecheck.log、desktopPackage224.log、windowsInstaller224.log、existingDesktopUnitTests.log、candidate224/manifest.json、prelaunchProjectChanges.json、installIntegrity.json、nativeUiEvidence55.json、normalClosePersistence.json、restartFixtureIntegrity.json、nativeReopenUi55.json、finalProjectIntegrity.json、settingsAudit.json、finalSourceAndArtifactAudit.json 和 nativeFrameBoundarySummary.json。第五十四批的错误记录保持历史范围。


## 第五十七批候选说明

第五十七批已接通自定义参数预处理及显示钩子的独立进程同步路径，实际 SDK 组件、共享状态、主题、输入、刷新和 HTML 导出核对通过；同步调用保留约两秒上限，2.0.26 / 2vtjab8zslcnu 候选构建通过。实际安装仍为 2.0.24，候选安装版、真实 Agent/团队/A2A 及持久媒体故障联合验收继续推进，见 [同步钩子进度](toolSyncHooks.md)。普通用户子进程不等于操作系统权限沙箱。 本轮没有新的原生界面观察；SDK 显示组件与 HTML 导出的本地结果不替代现有 Vue 工具页面、节点界面或原生权限验收。

## 第五十八批：2.0.26 本机安装与部分联合验收

2026-10-23：安装冻结候选 **2.0.26 / 2vtjab8zslcnu**，安装器退出 0，注册版本及安装内 468 份程序资源与候选清单吻合。关闭 2.0.24 后，先备份安装目录中的 1,048 份数据文件（约 3.06 GB）并记录摘要；安装后未启动时仅缺少 `nodes/initialized` 与 `tools/initialized`，符合安装脚本要求首次启动重新同步内置插件。首次启动后这两个标记重建。与安装前基线相比，只有设置、两个标记和专用画布 `toolViewDemo.json` 内容变化；其余 1,044 份文件保持摘要。专用画布变化发生在原生节点定位操作期间，不归因于安装器。

原生界面首次启动与一次正常重开均显示两张历史工具卡片；四字段已答表单可读，点击“镜头说明甲”可定位并选中对应节点。重开后默认日志级别、空筛选器的控制台为 0 条消息。开发者工具仍报告 3 处 `label for` 不匹配；违规节点指向模型弹层的推理等级分段控件。已把该控件改为 `fieldset`/`legend`，前端类型检查和构建退出 0；重建后的浏览器预览展开模型弹层，分段控件及标签布局可见，页面中没有指向缺失元素的 `label[for]`。这项源码修正发生于冻结候选之后，**不计为 2.0.26 原生修复通过**。预览使用隔离的临时服务数据，检查后已关闭。

安装版真实 Agent/团队/A2A、同步钩子在真实会话中的行为、页面原生权限直接核对、节点 UI 与宿主页面隔离、标准化性能三次样本和正式发行条件仍未完成。节点 UMD 当前由 `loadNodeComponent.ts` 向主页面插入脚本，并直接使用主页面提供的 Vue、Vue Flow 和 Element Plus 运行时；它不是工具卡片的独立页面路径。不能通过给现有节点外层补一个 `iframe` 就宣称隔离完成，后续需要迁移节点运行契约并复验交互。升级前曾在 2.0.24 原生窗口打开 300 节点样本并看到文字加载，但仅有一次非标准自动化往返观察，不能当作性能阈值参考或候选回退通过。本轮没有提交模型/媒体请求，没有新增付费生成或重发未知视频。

本轮证据在 `work/candidateAcceptance226/`：`beforeInstallData.json`、`beforeInstallSummary.json`、`dataBackup/`、`installIntegrity.json`、`afterLaunchData.json` 和 `nativeAcceptanceSummary.json`。冻结 2.0.26 安装器及清单仍沿用第五十七批产物。

## 第五十九批：原生工具子页面权限策略直接核对

2026-10-23：保持 2.0.26 安装版及原有专用验收画布，使用客户端既有 `/api/desktop/devtools` 入口打开 WebView2 开发工具；未提交生成请求。在“应用程序 → 帧”面板中，主页面下有两张可见工具卡片对应的 `about:srcdoc` 子页面。分别选择两帧后，面板均显示内联 CSP 的 `default-src 'none'`、`connect-src 'none'`、`frame-src 'none'`、`form-action 'none'`；权限策略的禁用列表包含 `camera`、`microphone`、`geolocation`、`clipboard-read`、`clipboard-write`、`payment`、`fullscreen` 等。两帧的所有者元素均为 `iframe`，与安装版界面中的 `selectNodes`、`askUser` 工具卡片相符。检查结束后关闭开发工具，主程序保留运行。

这是**安装版 WebView2 对当前两张工具子页面的浏览器权限直接观察**。面板同时显示主页面是本机安全上下文但未跨源隔离；该结果不证明原生桥对象不可达，不证明操作系统层面沙箱，也不覆盖节点 UMD。目前节点 UMD 仍在主页面加载。详细字段已加入 `work/candidateAcceptance226/nativeAcceptanceSummary.json`；上一批安装资源、数据摘要与性能限制保持各自原有范围。

## 第六十批：冻结资源的 300 节点暖开对照

2026-10-23：从冻结候选包分别提取 2.0.24 / 158414d162n4e 与 2.0.26 / 2vtjab8zslcnu 到独立目录，归档 SHA-256 及清单中的 467/468 份程序资源均核对相同。各复制同一份 309 文件、约 1.20 GiB 的项目；画布 JSON 摘要均为 `062ef6a21c745f43e777d1601d0b9464b97d27fe19f096577617dd16f8ab7cea`，共 300 节点、25 连线。两版原生窗口均调至 1280×720、暗色与 35% 缩放。每次从仓库点击打开画布，到可访问性树同时出现 300 节点控制与首项文字为止，计入 UI 自动化与轮询；两版截图也可见文字与连线。2.0.24 三次 3097/2391/2332 毫秒，中位数 2391；2.0.26 三次 2464/2660/2354 毫秒，中位数 2464，候选高 3.05%。两份样本 JSON 在运行后摘要未变。隔离实例正常退出，原安装版 2.0.26 通过启动器恢复运行。该对照只支持本机大画布暖开子项，计时不是 INP/帧耗时，也未覆盖安装版差异及其他性能门槛。完整方法和样本见 `work/performanceComparison226/warmOpenComparison.json`，未提交新的付费生成请求。

在同一安装版 2.0.26 的 WebView2 开发工具控制台，以只读 `typeof window[name]` 查询主页面和历史 `selectNodes`、`askUser` 两张可见工具子页面。主页面 `__electrobunInternalBridge`、`__electrobunHostBridge`、`__electrobunBunBridge` 为 `undefined`，`__electrobunEventBridge` 为 `function`；两张 `about:srcdoc` 中上述四项、`electrobun` 和 `toonflowNodeHost` 均为 `undefined`。与前批帧面板的 CSP、权限策略观察互补，但仍不证明所有间接通道或操作系统沙箱。节点 UMD 在主页面执行，不能把工具子页面结果移用于节点。查询没有调用生成接口；结果追加至 `work/candidateAcceptance226/nativeAcceptanceSummary.json`。

## 第六十一批：表单标签修正的独立原生预览

2026-10-23：前端源码的 `fieldset`/`legend` 修正通过 `@toonflow/web` 类型检查和构建。将新网页产物复制到隔离的 2.0.26 程序副本中，未改动正式安装位置。原生 WebView2 上的模型弹层显示推理等级控件组；打开弹层后开发工具显示控制台 0 条消息、问题 0 项。`work/nativeFormFix226/modelPopoverNative.jpg` 留存截图，资源和截图摘要见 `work/nativeFormFix226/nativeFormFixSummary.json`。该副本只是组合预览，未按完整候选重新打包；安装版仍是原冻结网页，不能称安装版标签问题已关闭。预览和开发工具正常退出，原安装版恢复运行；没有外部生成请求。

同批还使用第六十批的两份冻结便携资源、相同摘要的单节点 `nativeCanvas45.json` 补测小画布暖开。两版窗口同为 1266×953、暗色、100% 缩放；每次从仓库卡片点击到可访问性树同时出现单节点画布控制与节点标题。2.0.24 三次 421/404/415 毫秒，中位数 415；2.0.26 三次 397/408/403 毫秒，中位数 403。每次均见标题，运行前后两份 JSON 摘要仍是 `c90031505436fb7181d0a3169b47e4988ed18e106cee19edc7d903e62d6f0110`。计时包含自动化和轮询，差值不作为交互性能改善证据；这不是安装版或整体性能门槛通过。数据已追加到 `work/performanceComparison226/warmOpenComparison.json`，隔离实例正常退出后原安装版恢复运行。
