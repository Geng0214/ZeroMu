> 2026-10-23 归档：这是文档整理前的历史快照。当前目标见 [总计划](../plan.md)，当前状态见 [进度](../progress.md)，其他记录见 [归档目录](readme.md)。旧文中的“当前”、版本和待办仅适用于原记录日期。

# 工具同步钩子兼容进度

日期：2026-10-23，第五十七批。承接 [工具执行隔离](pluginExecutionIsolation.md)。自定义 prepareArguments、renderCall、renderResult 已接通独立进程路径；本页下方保留第五十六批的历史范围。

## 当前实现与范围

自定义显示钩子继续在原插件进程中同步运行，返回 SDK Component 契约。组件身份、同一工具行共享状态、lastComponent 复用、主题方法、焦点读写、键盘/鼠标方法与刷新通知得以保留，实例释放后不再使用组件。共享状态和必要的显示引用随插件实例释放；常规 execute 仍使用各自调用生命周期。

仅显式允许的状态和焦点可写，主题保持只读。反射、引用所属实例、宿主能力表和工作区文件授权保持；显示调用结束后的文件或媒体能力仍不可使用。宿主同步等待总上限约两秒，异常不自动重试；本轮两项持续占用情况分别约 1.817 秒、1.833 秒被终止，另一实例继续可用。普通子进程保留当前用户权限，不是操作系统沙箱。

这里兼容的是 SDK 的组件接口及 HTML 导出链路。现有 Vue 工具卡片仍沿用 [独立页面契约](toolViewIsolation.md)，没有把本轮 SDK 运行结果计为新版原生卡片或节点界面验收。

## 已完成核对

- 实际 SDK 0.85.1 defineTool、Text、Theme 和 HTML 导出通过；renderCall、renderResult 同步返回，共享状态与组件复用保持，主题返回的函数可用。
- 实际 SDK Input 的焦点、键盘输入及组件复用通过；异步状态与主题更新、刷新后再次 invalidate 通过；释放后拒绝使用通过。
- 非同步或无效显示返回明确拒绝，超时、权限边界及结束后的能力限制通过。没有新增测试文件、测试框架或自动检查入口。
- 生产 Agent 工具装配为 35 项，实际 SDK write/edit/read/ls 通过；使用受控画布与提问上下文，不计为真实模型 Agent 任务。实际 HTTP MCP 目录为 46 项，文件工具、未认证拒绝与关闭后拒绝通过，临时凭据已移除。
- 现有生产控制器和四份工具工作进程编译后，在仓库外无祖先 node_modules 的目录，由安装版 Bun 1.4.0 使用 --no-install 运行通过。受控回调下，准备、显示、组件/状态复用、焦点输入、刷新、执行及释放通过；不扩大为真实 SDK/Agent 或安装版联合验收。
- 全工作区类型检查退出 0。现有 bun test ./apps/server/src/utils/plugins 扫描 11 份文件，退出 1，无匹配测试文件，没有记为单元测试通过。先前类型检查及手动输入修正的记录保留。

## 构建、保存与后续

完整 package:desktop 退出 0，候选 **2.0.26 / 2vtjab8zslcnu**，四份产物冻结于 work/toolRenderHooks1792686909441/candidate226/artifacts。[安装器](../../work/toolRenderHooks1792686909441/candidate226/artifacts/zeromu-2.0.26-Setup.exe) 为 69762161 字节，SHA-256：e1672779a8d45a15c9a13bd4fae8b798bb3c42acf779c2d09456040a6ac12803。468 份程序/页面资源、12 份构建输入摘要已核对，原生核心未改动。构建开始后没有修改产品源码。

实际安装仍为 **2.0.24 / 158414d162n4e**，2.0.25 和 2.0.26 都未安装；没有新增原生界面观察。639 份原项目文件的内容及元数据保持，主配置、锁文件、桌面入口和原同步客户端/传输工作线程保持。本批新增模型/媒体请求与外部支出均为 0，三笔未知视频没有重发；未签名、未公开发布。

候选安装版联合验收、节点界面、页面权限直接核对、表单标签问题、真实 Agent/团队/A2A、真实媒体与账单、三部完整作品、设备与系统 DPI、干净 Windows、创作者试用及可信发行仍未完成。完整目标尚未达到。

证据根目录 work/toolRenderHooks1792686909441，指针 work/currentToolRenderHooksFixture.json。主要记录为 renderFirstContract.json、renderAsyncContract.json、sdkHtmlRendererContract.json、sdkInputComponentContract.json、renderCapabilityContracts.json、renderFailureContracts.json、channelBoundaryContracts.json、builtinAgentContracts.json、mcpSourceContracts.json、coldRuntime.json、workspaceTypecheck.log、existingPluginUnitTests.log、desktopPackage226.log、candidate226/manifest.json、preservation.json 和 toolRenderHooksSummary.json。

## 第五十六批历史记录

日期：2026-10-23，第五十六批。承接 [工具执行隔离](pluginExecutionIsolation.md)。本批接通自定义 **prepareArguments**；自定义 renderCall、renderResult 仍未支持，完整同步钩子兼容继续推进。

### 当前实现

参数预处理在原工具独立进程中同步执行，返回参数快照；宿主 SDK 的内置参数兼容钩子保持。仅在需要自定义预处理时创建受信任的传输线程，插件代码不进入该线程或宿主。现有反射、引用范围、宿主能力表、工作区文件授权与事务保持。

每次预处理有独立调用范围；结束后释放临时引用并取消其余等待，不自动重试。同步接口调用期间宿主线程会进行有界等待，总等待上限约两秒，持续回调不会重新开始计时。这不是完全无阻塞的接口；普通异步工具执行保留原生命周期。异步参数准备实现会明确报错，不会静默转为异步返回。

客户端更新说明已区分参数预处理与仍未支持的显示钩子。新增传输资源已加入常规工作进程构建、Windows/ARM Mac 资源清单及 Intel Mac 清单；没有据此声称 Mac 实机已验收。

### 已完成的本地核对

源码入口使用实际宿主 SDK 与独立工作区上下文，参数同步返回、宿主回调、嵌套数据与接收对象、重复调用、明确错误、超时、结束后的回调范围、释放后拒绝及 SDK 内置兼容通过；另补齐实际 SDK defineTool 定义后的自定义准备。最终截止处理修订后，持续回调仍在约 1.82 秒结束等待。

受控传输核对与边界保持核对通过。最终生产控制器和四份工具工作进程编译后，在仓库外、所有祖先均无 node_modules 的目录，以安装版 Bun 1.4.0 和 --no-install 完成同步准备、受控宿主回调及执行。冷运行使用手动准备的回调上下文，不计为真实 Agent、模型或安装版联合验收。

全工作区类型检查通过；最后截止处理修订后的服务端类型检查再次通过。现有 `bun test ./apps/server/src/utils/plugins` 扫描 11 份文件，退出 1，无匹配测试文件，未记为单元测试通过。没有新增测试文件、框架或自动检查入口。手动插件源码只在内存传入，磁盘中的编译文件均来自现有生产入口。

### 构建与安装范围

最终 `package:desktop` 退出 0，候选为 **2.0.25 / 1uuno8563ryfp**。四份产物冻结于 `work/toolSyncHooks1792684671297/candidate225/artifacts`；[安装器](../../work/toolSyncHooks1792684671297/candidate225/artifacts/zeromu-2.0.25-Setup.exe) 为 69755667 字节，SHA-256：38035ca465c222c6277ee138a136370d9479356594f22645e02f30ac6c6b9e00。归档中的 468 份控制器、工作进程及页面资源有摘要，包含新增传输资源，源码摘要与最终构建保持一致。

较早的同版本构建 2hpx3ohpdurn0 已标为中间产物；截止处理修订后重新完整构建，最终以 desktopPackage225Final.log 和 candidate225/manifest.json 为准。首次类型错误和冷运行驱动命名冲突的记录保留；后者发生在启动冷运行进程之前，修正驱动后复用当时已成功编译的生产文件通过，没有因此修改产品源码。

本机实际安装仍为 **2.0.24 / 158414d162n4e**，其原生记录见 [启动与重开](nativeStartupDiagnostics.md)。本批没有安装 2.0.25、发起模型或媒体请求、增加外部支出，也没有重发三笔未知视频；未签名、未公开发布。

### 后续与证据

自定义显示钩子的组件、共享状态、主题和刷新回调仍需保持同步语义及生命周期，当前继续明确拒绝，不在宿主回退执行插件。2.0.25 的安装版联合验收、节点界面、页面权限直接核对、表单标签问题、真实 Agent/团队/A2A、真实媒体与账单、三部完整作品、设备与系统 DPI、干净 Windows、试用、签名及发行仍待完成。普通子进程不等于操作系统权限沙箱，完整计划保持活动。

证据根目录 `work/toolSyncHooks1792684671297`，指针 `work/currentToolSyncHooksFixture.json`。主要记录为 sourceSnapshots.json、finalSourceDigests.json、prepareContracts.json、sdkDefinedPrepare.json、callbackDeadline.json、relayContracts.json、boundaryPreservation.json、coldRuntimeFinal.json、workspaceTypecheck.log、serverTypecheckDeadlineFinal.log、existingPluginUnitTests.log、desktopPackage225Final.log、candidate225/manifest.json、preservation.json 和 toolSyncHooksSummary.json。各轮手动核对保留原范围，最终候选构建不扩大为上述全部原生验收。
