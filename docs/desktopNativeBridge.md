# 桌面页面的原生桥边界

后续：第五十四批实际安装 2.0.23，补齐正常重开后的工具卡片与节点定位，主页面启动控制台无消息；工具子页面仍有两条框架错误，页面权限直接核对仍未完成。详见 [启动与重开记录](nativeStartupDiagnostics.md)。以下保留第五十三批当时的结果。

日期：2026-10-22，第五十三批。沿用 [工具界面独立页面](toolViewIsolation.md)，处理桌面主窗口的直接原生 RPC 入口。

## 修改与构建

[桌面入口](../apps/desktop/src/index.ts) 明确启用 SDK 的受限页面模式。现有页面不直接依赖 SDK RPC；文件窗口、剪贴板、保存等能力继续通过既有本机接口与宿主授权处理，没有修改这些接口的权限规则。依据为当前固定 SDK 的窗口、页面与受限预载实现，以及 [官方 BrowserView 文档](https://github.com/blackboardsh/electrobun/blob/main/docs/src/content/docs/electrobun/apis/browser-view.mdx)。Intel Mac 固定 SDK 1.18.1 的已发布归档校验及契约读取通过；没有据此声称 macOS 实机已验收。

桌面类型检查、完整 Windows 打包均退出 0。执行现有命令 bun test ./apps/desktop/src，扫描 7 份文件，退出 1，无匹配测试文件，未记为单元测试通过。未新增依赖、测试文件或自动检查入口。

候选 2.0.21 / 2zrk9nrq2bytz，安装器 69762035 字节，SHA-256：1f5e147ce5b83c533c5fd3ffe207f799642409538563c2f051f793569e91d4d0。四份产物冻结于本批 candidate221；程序与页面资源共 467 份（含 MCP stdio，比第五十一批资源范围多一份）。2.0.20 继续保留为上一批浏览器界面候选，没有安装。

## 原生安装与操作

安装器退出 0，实际安装目录沿用 work/windowsSpeechIntegration1792430288397/installedApp。首次启动前，467 份资源与候选匹配，649 份项目文件的大小、摘要、修改时间与文件标识保持，设置字节保持。

实际宿主 65656 / 58698，原生首页和导航可用。通过原生文件夹窗口打开专用 toolViewNative52 项目，读取的是明确标注未调用语言模型的历史会话。卡片在空画布载入后切换到同项目另一画布，节点名称更新，节点定位并选中通过，原已答表单仍可读；没有把历史回执计为本轮新提问或真实 Agent 验收。截图为 [原生工具卡片](../work/desktopBridge1792678198957/nativeToolView53.png)。

正常 Alt+F4 后旧宿主及端口结束，启动器重开为 63380 / 59498，实际原生首页可见，本机版本为 2.0.21 / 2zrk9nrq2bytz。两次启动器等待窗口均未及时捕获目标，随后定位到各自原实例，没有重复启动。还原、遮挡与坐标问题按实际观察恢复；重开后的工具卡片界面复核仍受输入保护与窗口位置影响，未记为通过。

## 数据与明确限制

结束时原有 639 份项目文件内容与元数据保持；649 份安装前文件中 648 份保持，只有专用验收项目的 toolViewDemo.json 在定位操作后改变，未将全部 649 份操作后字节一致记为通过。重开前独立记录的 11 份验收文件（含新增截图）在重开后内容和元数据全部保持。设置仅有项目导航、项目列表及已读构建记录变化，外观、MCP、凭据及其余设置保持。

额外页面权限检查被浏览器自动粘贴保护拦截，没有关闭保护或执行该表达式，因此未取得该项直接运行态结论。控制台有 5 条尚未归因的未处理 Promise 对象消息，另有未配置更新源的检查请求返回 400；这些记录保留，不能声称无运行异常或完整原生桥验收完成。

SDK 受限页面模式不等于操作系统权限沙箱。节点界面仍与应用页面共享环境；真实模型、设备与发行门槛也没有扩大为完成。未签名、未公开发布，本批新增外部生成请求与支出为 0。

## 证据与后续

根目录 work/desktopBridge1792678198957，指针 work/currentDesktopBridgeFixture.json。主要记录为 sourceSnapshot.json、desktopTypecheck.log、desktopPackage221.log、macIntelSdkContract.json、existingDesktopUnitTests.log、installIntegrity.json、nativeStartup.json、nativeToolUi.json、nativeDiagnostics.json、nativeRestart.json、finalProjectIntegrity.json、settingsAudit.json 和 desktopBridgeSummary.json。第五十二批原生升级曾由用户停止，没有据此宣称安装完成。

下一步优先排查上述控制台消息并补齐页面权限与重开界面核对，再推进节点界面、自定义同步钩子、真实 Agent/团队/A2A、真实媒体与账单、完整作品、设备和系统 DPI、创作者试用、签名及正式发行。完整 M0–M5/P2 目标保持活动。
