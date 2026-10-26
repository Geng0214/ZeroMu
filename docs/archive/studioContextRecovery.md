> 2026-10-23 归档：这是文档整理前的历史快照。当前目标见 [总计划](../plan.md)，当前状态见 [进度](../progress.md)，其他记录见 [归档目录](readme.md)。旧文中的“当前”、版本和待办仅适用于原记录日期。

# 工作站草稿目录恢复与 2.0.9 原生验收

日期：2026-10-20。对应产品计划 F04 的项目上下文、F12 的重开与升级，以及执行记录第三十三批。范围是未提交生成的工作站草稿恢复和历史任务辨认；完整 M0–M5 与 P2 目标继续执行。

后续：第三十七批已在同一隔离目录实际升级为 2.0.10，并再次从原生生图工作站确认本文未生成草稿的目录、正文与已保存状态保持。本文的 2.0.9 版本、端口及 55 文件统计为第三十三批历史证据；当前安装与 56 文件核对见 [2.0.10 大项目验收](windowsScaleRecovery.md)。

## 修复与实际复现

画布保留甲项目，在图片工作站选择乙目录，写好正文但不生成，然后重载页面。旧实现优先使用画布项目路径，因而回到甲目录；乙目录的草稿文件仍存在且摘要不变。这是恢复入口选择错误，没有发现该场景下的正文丢失。

工作站现在优先使用已保存的工作站目录；只有尚无该目录时才回退到当前画布项目。显式成功打开项目时同步工作站目录，单纯恢复持久化的画布状态不覆盖它。未完成任务记录补充状态、创建时间和原错误，提供「查看此任务」定位原任务；没有自动重试、清除失败记录或新增生成。

修复前已被旧逻辑覆盖的上次目录无法凭空推断。本次先通过界面重新选择乙目录，再核对后续离开、进入和重载。没有把重新选择过程算作自动迁移旧选择。

## 源码界面验证

隔离服务来源为 `http://127.0.0.1:53163`，数据在 `work/localBackgroundAcceptance1792450278332/data`。

- 甲项目为 `workspaces/backgroundProject`，乙目录为 `workspaces/contextDraftProject`。乙目录正文是「乙目录的未生成草稿，返回后应恢复到此目录」，没有添加模型必需的参考图，也没有提交生成。
- 修复前重载后显示甲目录，乙草稿 SHA-256 仍为 `19e9dfc22d94982e2bd3502f32f83aa52a0424d817c6e9f3d7ba58b93c50ea72`。修复后经首页重新进入及页面重载，目录和正文均为乙；原草稿文件摘要仍相同。
- 随后从画布仓库明确打开甲项目，再进入生图工作站，目录、原提示词、参考图及三条结果均切回甲项目。
- 点击历史取消记录的「查看此任务」，任务中心打开并高亮任务 `c3ca8ea0-3c39-4596-a8f8-ca062dd0978e`，仍为排队取消，没有向渠道提交。
- 桌面与实际 390×844 浏览器视口检查通过：历史记录可换行，入口按钮高 44 像素，无页面横向溢出。早期缩放错误截图不作为窄屏布局证据；有效截图为 `taskRecordMobileVerified.png`。

另一次首页跳转曾遇到旧页面引用已替换的构建分块而失败，草稿仍已保存。此处发生在开发验收服务更换静态构建后，重载获取当前页面即可；不把它计为目录恢复修复的通过或失败。

## 安装、原生目录框与换端口重启

使用本批实际构建的 NSIS 安装器，在同一隔离位置 `work/windowsSpeechIntegration1792430288397/installedApp` 完成 2.0.8 → 2.0.9。安装器退出 0，同一交互用户上下文中的卸载登记、安装目录与资源版本均一致。

升级前记录的 55 份项目文件，在安装后和本批原生界面操作后逐文件核对摘要，变化为 0。该口径包含旧配音、图片及制作数据；本批另外新建草稿，不声称操作后的项目总文件数始终是 55。

正常 SDK 启动器打开后，更新说明实际显示版本 2.0.9、构建 `1yrjgwd5wbbyz` 及本机配音、背景移除、目录恢复说明。图片工作站原有四条结果保留，历史 FFmpeg 缺失失败显示为创建于 08:18:42 的失败任务，进入任务中心后高亮该旧失败；已完成的 08:20:38 结果仍在，没有重新生成。

通过原生「选择文件夹」对话框选择独立的 `data/workspaces/contextDraftProject`，在图片工作站填写「原生乙目录的未生成草稿：重开后继续编辑，不提交生成。」，未提交生成。首页返回后重新进入仍显示该目录与正文。然后 Alt+F4 正常退出，确认本安装进程停止，再用 SDK 启动器重开：服务端口从 51693 变为 53101，仍恢复乙目录、正文及「草稿已保存」，结果数为 0。

原生草稿重启前后 SHA-256 均为 `49573b5dfbe15c82e5e31ecfdf7bc802c91b87780fe2c2a8e3a38f562ebced4a`。原生目录框、正文输入、首页返回及进程重开通过真实 Windows 窗口操作完成；显式画布项目切换的专项证据来自上面的源码界面，未重复声称在本批原生版完成了全部切换组合。

安装、启动和重启使用的三个本批临时计划任务均退出 0 后移除。没有改动系统缩放，也没有覆盖干净 Windows、另一设备、超长路径或所有原生文件边界。

## 构建与产物

Web `vue-tsc`、Web 构建和完整桌面/NSIS 打包均通过；完整打包退出 0。存在已有的大分块构建提示。界面检测退出 0、输出日志为空，不等于完整可访问性认证。本批没有增加依赖、测试文件或临时脚本文件。

| 产物 | 字节 | SHA-256 |
| --- | ---: | --- |
| `zeromu-2.0.9-Setup.exe` | 68846479 | `6eea113f4af8748dbd4373e0e34b7c2453da2a77a0428dbc2e84717141dcf123` |
| `stable-win-x64-update.json` | 197 | `36ff7fcf084526bf93c70474aa67617e9ee97b08219fa1f10a48ecef16198368` |
| `stable-win-x64-zeromu.tar.zst` | 71896918 | `be5374b320ef2f019fdbc55211199da3f9a265fcc3730fd72582da2720733f4e` |

不可混用的本批副本在 `work/studioContextAcceptance1792456453037/candidate209/artifacts`；公共构建输出在 `build/desktop/artifacts`。这是未签名、未公开发布的本机验收版本。

机器记录指针为 `work/currentStudioContextFixture.json`。同一批根目录包含 `draftOnlyReproduction.json`、`sourceContextVerified.json`、`installerResult.json`、`beforeUpgradeProjects.json`、`afterUpgradeProjects.json`、`oldProjectsAfterNativeUi.json`、`nativeDraftBeforeRestart.json`、`nativeDraftAfterRestart.json` 和 `studioContextFinalSummary.json`。

界面证据包括 `draftOnlyWrongDirectoryAfterReload.png`、`draftOnlyFixedReload.png`、`taskRecordFocused.png`、`taskRecordMobileVerified.png`、`native209ReleaseNotes.jpg`、`native209FocusedFailure.jpg`、`nativeDraftReentry.jpg`、`nativeDraftRestart.jpg` 及对应文本。

主 `data/settings.json` 的 SHA-256 保持 `65bb7d1f460553d78bba7de21ff633dace367b001a74c339d0e5c4901205a84a`。本批新增本机推理、配音和付费生成均为 0；Agnes 累计仍为四次生成请求，人民币 10 元上限及此前两笔不确定视频占用不变，未知供应商实付未补填。

真实视频成功与账单、三类完整范例成片、Agent/导演台真实模型遵循、性能归因、跨设备及系统缩放、创作者试用、插件隔离、签名和自有 HTTPS 发布源等仍按原计划推进。本批通过不代表整个计划已经完成。
