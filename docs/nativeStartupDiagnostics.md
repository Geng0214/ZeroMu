# 原生启动与工具卡片重开记录

日期：2026-10-22，第五十四批。承接 [桌面原生桥记录](desktopNativeBridge.md)。本批实际安装版本为 **2.0.23 / 1rsn8e5axrea9**。

## 修改及构建

未配置更新源时，启动检查保持只读，避免自动提交无效检查；用户主动检查仍保留明确错误。Windows 主页面清理已禁用通道的残留异步引用，继续保留非预期错误报告。桌面受限页面模式保持开启，固定原生 SDK 及依赖未替换。此前 toolChannel.ts、isolatedTool.ts 的边界加固、工具独立页面与锁文件均保持。

前端和桌面类型检查退出 0，完整 Windows 打包退出 0。两组各五项内存手动核对通过，范围分别为更新状态与主页面预载；这些结果不替代原生运行观察。现有命令 `bun test ./apps/web/src ./apps/desktop/src` 扫描 193 份文件，退出 1，无匹配测试文件，未记为单元测试通过；没有新增测试文件、框架或检查入口。

冻结安装器为 [zeromu-2.0.23-Setup.exe](../work/nativeDiagnostics1792680107091/candidate223/artifacts/zeromu-2.0.23-Setup.exe)，69758765 字节，SHA-256：c04360598ec75276d372e8ca6d6e632a5c1b3da4966da712c8ae080dc94574db。四份产物均有摘要，467 份安装资源匹配。2.0.22 仅为中间构建，未安装。

## 原生结果

2.0.21 正常退出后完成升级，安装器退出 0；首次启动前 650 份项目文件内容与元数据及设置字节保持。2.0.23 启动时，默认日志级别、空筛选器下控制台为 0 条消息，未再观察到上一批主页面启动错误及无更新源的启动请求错误。问题面板仍有表单标签提示。

实际原生窗口打开专用 toolViewNative52 画布，工具卡片、已答制作表单及节点定位可用。随后正常退出，旧宿主 50828 及端口 56741 结束，单次重开为宿主 66100 / 端口 50636。重开后再次通过原生界面进入该项目，已答表单和节点入口恢复，定位另一节点并选中通过。画面见 [重开后的原生工具卡片](../work/nativeDiagnostics1792680107091/nativeReopenToolView54.png)。这些会话明确标注为手动界面历史，没有调用语言模型，不计为新提问或真实 Agent 验收。

加载两张工具卡片后仍观察到 **2 条来自工具子页面的未处理 Promise 错误**，展开信息为原生对象缺失。主页面修复未解决该框架兼容问题；未屏蔽全局错误，未将完整控制台或原生桥验收记为通过。浏览器粘贴保护保持，上一批受阻的页面权限直接检查仍未取得运行态结论。

## 数据与范围

原有 639 份项目文件内容、修改时间和文件标识保持。650 份安装前文件中 649 份保持，只有专用验收项目的 toolViewDemo.json 在节点定位后变化；新增五份本批截图与记录，当前共 655 份。重开前独立记录的 14 份验收文件在重新进入画布、尚未进行卡片定位时内容与元数据全部保持。设置仅变化项目最近打开记录、项目列表及已读构建记录；外观、MCP 和其余设置保持。

本批无外部生成及新增支出，三笔未知视频继续保留。普通用户进程及 SDK 页面模式不等于操作系统权限沙箱。节点界面、自定义同步钩子、真实 Agent/团队/A2A、真实媒体和账单、三部完整作品、跨设备与系统 DPI、干净 Windows、创作者试用、签名和正式发行仍待完成。

## 证据

根目录 `work/nativeDiagnostics1792680107091`，指针 `work/currentNativeDiagnosticsFixture.json`。保留类型与构建日志、existingUnitTests.log、sourceSnapshots.json、updateStartupContract.json、nativePreloadContract.json、runtimeDiagnostic.json、installIntegrity.json、nativeUiEvidence54.json、nativeToolConsole54.json、nativeReopenUi54.json、restartFixtureIntegrity.json、finalProjectIntegrity.json、settingsAudit.json、finalSourceAndArtifactAudit.json 和 nativeDiagnosticsSummary.json。未新增测试文件；未签名、未公开发布。完整计划继续执行。
