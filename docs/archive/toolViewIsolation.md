> 2026-10-23 归档：这是文档整理前的历史快照。当前目标见 [总计划](../plan.md)，当前状态见 [进度](../progress.md)，其他记录见 [归档目录](readme.md)。旧文中的“当前”、版本和待办仅适用于原记录日期。

# 工具界面的独立页面

日期：2026-10-21，第五十一批。对应 [产品计划](productDevelopmentPlan.md) 的插件执行边界、桌面可靠性和界面使用要求。

## 本批完成范围

工具客户端源码由独立页面加载，主页面保留当前工具记录和受限的业务能力。现有提问表单、选项、自由补充、跳过与画布节点定位继续可用；错误、关闭及状态变化各自处理。应用字号、深浅主题和控件语言随当前应用配置传入，既有工具对象在相同状态下保持，减少表单重新初始化。

最终浏览器实际观察到工具页面与主页面分开，主页面没有直接加载工具客户端脚本。边界依据采用 [浏览器内嵌页面机制](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) 与 [MessageChannel](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel)。本记录只覆盖普通浏览器中的工具界面，Windows 原生桥仍需独立核对。

## 实际操作结果

| 范围 | 结果 |
| --- | --- |
| 窗口、字号与主题 | 深浅主题 × 100%、125%、150% × 1280×720、900×650、640×700，共 18 组最终记录；正文分别为 14、17.5、21 px，无表单横向溢出，Tab 可进入画幅控件 |
| 提问 | 选项与补充、四字段制作表单、跳过各完成两轮；最终三项回执保留。制作表单实际收到镜头名称、16:9、MP4 与字幕、4 秒 |
| 草稿 | 初轮切换对话保留选项、补充和表单值；最终代码的画布定位交互后，未提交表单的值仍在 |
| 键盘 | 选项与表单可用键盘提交；初轮观察到从工具表单进入父页面按钮及反向返回；最终代码复核复选框、时长与提交 |
| 画布定位 | 两个既有文本节点均可定位并选中；最后修订在空画布打开记录后切回原画布，节点名称、定位与选中恢复，已答表单保持可读 |
| 错误提示 | 空画布定位不存在的记录节点时显示完整提示，工具页面高度覆盖提示内容 |
| 应用语言 | 最终运行时的“请选择”“减少数值”“增加数值”与应用中文配置一致 |
| 服务与记录 | 独立服务停止后重开，旧三项已答记录可读取；最终构建重载后仍可看到已回答的制作表单 |

这些是手动准备的界面会话及真实本地提问、画布接口操作，没有调用语言模型，不计作真实 Agent、团队或 A2A 联合验收。初轮记录与最终语言修订后的 18 份 finalLayout 记录分别保留，最终矩阵从磁盘独立记录归集。18 组矩阵完成于语言修订后；随后画布范围和提示高度修订另有 finalScopeBrowser.json 的实际页面记录，未将矩阵描述为在最后一次打包后全部重跑。系统 DPI、其他物理设备及全部无障碍条件没有据此扩大为完成。

## 构建与候选

全工作区类型检查通过，后续前端专项类型检查及最后提示高度修订的前端类型检查与构建再次通过，最终完整 Windows 打包退出 0。现有命令 bun test ./apps/web/src ./apps/server/src ./packages/toolScaffold/src ./packages/tools/canvas/src 扫描 537 个文件，退出 1，无匹配测试文件，未记为单元测试通过。未增加依赖、测试文件或自动检查入口。

最终候选为 2.0.20 / 1n5ckjgp6fgym。安装器 69756735 字节，SHA-256：b9c94a50ccf8c2a1387bd88e2cc7982e62df2fcf4c24a4082d2f75ede473246c。四份产物冻结在 work/toolViewIsolation1792511892494/candidate220/artifacts；桌面入口、四份工作进程/客户端及页面 HTML、JavaScript、CSS 共 466 份资源保留摘要，包含独立工具页面资源。其中 461 份页面资源与最后实际核对的浏览器页面快照逐份一致。首次候选日志保留早期范围，最终以 desktopPackage220NoticeFinal.log 与 candidate220/manifest.json 为准。

第五十一批结束时，本机实际安装仍为 2.0.19 / m1cu5aex0c9i。原有 639 份项目文件内容、修改时间和文件标识保持；主设置、锁文件以及 toolChannel.ts、isolatedTool.ts 的既有加固源码保持。本批临时界面配置恢复，三个临时服务均已结束，浏览器页面和视口覆盖已清理。外部生成请求及新增外部支出为 0，原三笔未知视频继续保留。

## 变更与证据

变更为 [客户端契约](../../packages/toolScaffold/src/client.ts)、[节点定位卡片](../../packages/tools/canvas/src/nodeFocusCard.vue)、[工具消息](../../apps/web/src/components/agent/toolMessage.vue)、[独立界面组件](../../apps/web/src/components/agent/isolatedToolView.vue)、[页面运行时](../../apps/web/src/lib/toolFrame.ts)、[状态类型](../../apps/web/src/lib/toolFrameProtocol.ts)、[构建配置](../../apps/web/vite.config.ts)及[类型声明](../../apps/web/src/types/toolFrame.d.ts)。既有客户端组件的构建格式继续沿用。

根目录为 work/toolViewIsolation1792511892494，指针为 work/currentToolViewIsolationFixture.json，摘要为 toolViewIsolationFinalSummary.json。保留 sourceSnapshots.json、finalSourceDigests.json、layoutMatrix.json、两轮提问回执、finalBrowserIntegrity.json、preservation.json、cleanup.json、构建与类型日志；浏览器截图 finalLight640Answered.jpg 与最后的 finalScopeCanvas.jpg 可独立查看；最后画布范围记录为 canvasScope.json 和 finalScopeBrowser.json，打包页面比对为 packagedBrowserMatch.json。初次未通过的类型、构建、主题设置和自动化操作记录按各自范围保留。

## 后续验收

第五十五批在 2.0.24 实装补齐子页面原生通道引用清理，首次加载及正常重开后的卡片、表单、节点定位通过，控制台均为 0 条消息；三项表单标签提示与页面权限直接核对继续保留，见 [原生记录](nativeStartupDiagnostics.md)。该结果不扩大为节点界面或操作系统权限沙箱完成。

第五十四批已在 2.0.23 实装补齐正常重开后的原生卡片、已答表单与节点定位，详见 [启动与重开记录](nativeStartupDiagnostics.md)。主页面启动控制台无消息，工具子页面仍有两条框架错误；完整原生桥与权限直接核对保持未完成。此前主题/字号/窗口矩阵及真实提问回执不重复计数，原生历史会话也不计为新模型请求。

该候选的 Windows 实装、原生桥边界、节点界面、自定义同步钩子、其他自定义工具兼容及规模性能继续处理。真实模型与账单、三部完整作品、系统 DPI、干净机器、跨设备、创作者试用、签名与正式发行仍按完整计划推进。普通浏览器边界不等于操作系统权限沙箱。本批没有签名或公开发布，完整 M0–M5/P2 目标保持活动。


## 第五十三批原生后续

第五十三批明确启用桌面页面的受限原生桥模式，完整 Windows 候选构建及 2.0.19 → 2.0.21 / 2zrk9nrq2bytz 实际安装通过。首次启动前 467 份程序与页面资源匹配，649 份项目文件及设置保持；原生首页、文件夹选择、手动历史工具卡片与节点定位通过。正常重开首页已观察，639 份原项目文件及重开前 11 份验收项目文件保持。页面权限的额外检查、重开后的工具卡片界面复核及控制台异常仍未全部验收，见 [桌面原生桥记录](desktopNativeBridge.md)。 上述 18 组矩阵仍归属第五十一批，本轮没有重复计数；原生读取的提问记录也是历史手动会话，没有计为新模型请求。


## 第五十七批候选说明

第五十七批已接通自定义参数预处理及显示钩子的独立进程同步路径，实际 SDK 组件、共享状态、主题、输入、刷新和 HTML 导出核对通过；同步调用保留约两秒上限，2.0.26 / 2vtjab8zslcnu 候选构建通过。实际安装仍为 2.0.24，候选安装版、真实 Agent/团队/A2A 及持久媒体故障联合验收继续推进，见 [同步钩子进度](toolSyncHooks.md)。普通用户子进程不等于操作系统权限沙箱。 本轮没有新的原生界面观察；SDK 显示组件与 HTML 导出的本地结果不替代现有 Vue 工具页面、节点界面或原生权限验收。
