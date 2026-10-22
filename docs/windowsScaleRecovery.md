# 2.0.10 原生大项目恢复验收

日期：2026-10-20；对应产品计划 F11、F12、P2 规模性能与执行记录第三十七批。范围是同一开发机的实际安装升级、Windows 文件选择、独立目录恢复、视频操作及正常重启。完整 M0–M5 与 P2 目标继续执行。

后续第三十九批已实际升级为 2.0.11，正常重启后保持本批最终的 300 节点、25 条连接和 20% 缩放；升级前后的全部 363 份既有项目文件字节一致，包含本批最终工作画布。见 [2.0.11 原生整合](windowsDependencyIntegration.md)。本页仍保留 2.0.10 当次恢复与初始化的历史证据。

## 安装与资源同步

第三十六批的视频音量浮层及截帧菜单按需创建优化已整合进完整桌面候选。`bun run package:desktop` 和 NSIS 打包退出 0，已有大分块提示保留。本批没有重复将上一批的节点类型检查计为新检查。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| zeromu-2.0.10-Setup.exe | 68848818 | bfe69896801e295fa9685e58bd3e4b05b6df9906dc32df9cc7f2001a913f9c36 |
| stable-win-x64-update.json | 198 | 9c331ee505927ca467a2a842ad162860526c3c8f0eae7d0434d7705b07b19499 |
| stable-win-x64-zeromu.tar.zst | 71897294 | b59bf86502c53b0952f72f239217f51df2d78c966ba81ce39211602763ba55c5 |

版本为 2.0.10，构建 39c19dswblmrv，Windows x64，未签名、未公开发布。冻结副本在 `work/windowsPerformanceIntegration1792459664638/candidate210/artifacts/`。

关闭原生 2.0.9 后，在原隔离安装目录实际执行 2.0.9 → 2.0.10，NSIS 退出 0。同一交互用户上下文中的版本登记由 2.0.9 变为 2.0.10，安装位置不变。原生版本提示与资源版本、构建号吻合；数据目录的两个视频节点包自动同步到本次优化包，摘要分别为：

- videoNode：2c7a9d7de44a5e09abd617994d55a80aeb868e86254fd202cf4581fcf4d44006。
- videoGenerationNode：f5643459eaa63251e1597ebe225a989111cbe24ebc1fcff008379949836f917c。

进入生图工作站，第三十三批 contextDraftProject 的未生成正文、目录与「草稿已保存」仍在，结果为 0，没有提交生成。升级前记录的 56 份项目文件在安装后和本批全部交互结束后逐个摘要一致。

## 真实原生大包上传与恢复

复用第十八批的可解码媒体规模项目包。本次读取的实际归档为 1292011669 字节，SHA-256 f6e8869fd30435a9674db4a4ab41b48297c90be2b724485adaa2e635986aab43。这个当前文件的大小不同于第十八批历史记录值，本次以重新计算的大小和摘要为准，不宣称该归档从第十八批起字节未变。

先通过原生文件夹选择器打开独立 performanceIncoming37，再从应用「项目包」点击「选择项目包」，在 Windows 打开文件对话框填入上述归档路径并确认。确认按钮的一次鼠标操作被工具跨进程目标检查拒绝，尚未开始上传；重新观察后，通过该对话框正常的 Alt+O 确认成功。没有用命令行上传替代原生选择操作。

应用上传完成后显示 303 份文件、1.20 GB；落盘的 `projectImports/44ec0785-78a3-4213-83af-4aa36a233185.zip` 与所选归档大小和 SHA-256 完全一致，无残留 partial 文件。再经原生文件夹选择器选择目标父目录，以 performanceNativeProject37 为新目录名，点击「校验并恢复到新目录」。

实际界面创建的导入任务 eb3efca4-526d-4cb9-bcfc-ec683e83f7aa 完成，处理字节 1291903166，警告为空。首次打开恢复项目之前，全部 303 份清单文件的大小与摘要均匹配，其中 200 份媒体共 1291271760 字节；画布为 300 个节点、25 条连接。原件是 FFmpeg 生成的容量样本，不是实际模型作品。

上传动作的观察时间没有覆盖完整传输起止，不报告上传耗时。只在上传已结束后测到一次设置接口 HTTP 200、7 ms，不能据此推断上传期间的宿主响应。重启后 Bun 宿主观测峰值工作集 469667840 字节，不含 WebView 渲染器或 GPU，也不作为完整应用内存或前后性能提升结论。

## 原生视频与重启

点击「打开恢复的项目」，原生工作区显示 300 个节点。归档初始画布缩放为 100%，此时操作规模样本视频 040：

- 从缩略图首次播放，播放进度由 0 到 10 秒，结束画面和时长正确。
- 点击静音后，音量浮层显示 0%，按钮变为「取消静音」。打开截帧菜单时音量浮层移除，静音状态仍保留。
- 点击「首帧」，实际创建 1280×720 PNG 与新图片节点，节点数变为 301。文件 1732594 字节，SHA-256 1191977fd13771f4c418c60bfc254ca86b0ee43d88ca9c7e43144e31ade663ad。
- 撤销一次回到 300 节点，截帧文件继续保留。将应用画布缩放设为 20%，显示已保存。这不是系统 DPI 调整。

Alt+F4 正常退出并确认旧 Bun 进程结束，再用实际安装启动器重开。端口由 63060 变为 58645；从画布仓库打开 mediaScaleCanvas，仍为 300 节点、25 条连接、20% 画布缩放。最终节点身份和连接端点身份与规模基线一致，撤销的截帧节点不在画布中，新增 PNG 仍完整保留。

最终 200 份原媒体及其余清单文件摘要保持，只有工作画布 JSON 与归档不同。已与归档内保持原摘要的基线副本逐项比较，共 323 项叶字段差异：80 个原空模型图片节点选取当前可用的本机 BiRefNet 默认模型，并将原默认 16:9 设为该模型的渠道默认；40 个原空模型音频节点选取 Windows 系统配音及 Huihui 音色，共 240 项模型/参数初始化。另有 80 项连接派生坐标和 3 项视口变化。实际提示词、所有媒体输出、节点身份与连接端点不变。上述初始化来自现有 loadModels/watch 行为，没有据此声称全部生成参数或画布字节未变，也没有用旧快照覆盖应用保存结果。

## 证据与剩余范围

证据根目录为 `work/windowsPerformanceIntegration1792459664638/`，指针 `work/currentWindowsPerformanceFixture.json`。主要记录：

- 安装：desktopPackage210.log、candidateArtifacts.json、installerResult.json、installedNodePackages.json。
- 原生选择与恢复：nativeUploadedPackage.json、nativeImportFirstStatus.json、restoredFilesBeforeOpen.json，以及 nativeLargePackageInspected/Restored.jpg。
- 视频操作：nativeScaleVideoPlayback.jpg/.txt、nativeScaleVolumePopover.jpg、nativeScaleCaptureMenu.jpg、nativeCapturedFrame.json。
- 重启和数据：restartResult.json、nativeScaleRestarted.jpg/.txt、finalProjectIntegrity.json、nativeCanvasDifferenceReview.json。
- 汇总：windowsPerformanceFinalSummary.json；三个本批安装/启动/重启计划任务均退出 0 后移除。

没有新增模型生成、本机配音或背景推理；Agnes 累计六次请求、估计占用 0.445 美元与人民币 10 元总上限保持，实际账单仍未知。主 data/settings.json SHA-256 保持 65bb7d1f460553d78bba7de21ff633dace367b001a74c339d0e5c4901205a84a。没有新增依赖、测试文件、框架或临时脚本。

本机 1.20 GiB 包的原生选择、恢复和重开已补齐；其他布局成本、稳定耗时、低配置与不同设备、系统 DPI、干净 Windows 与缺失运行时仍待验收。真实视频与三种完整作品、供应商账单、创作者试用、插件隔离、签名及自有 HTTPS 发布源继续保留原要求。
