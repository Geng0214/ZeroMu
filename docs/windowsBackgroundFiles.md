# 2.0.8 安装版背景移除与图片另存为

2026-10-20，第三十二批，对应 F09、F11、F12。实际完成原隔离安装 2.0.7 → 2.0.8 更新、旧项目文件保留、安装版背景移除，以及原生图片另存为的覆盖、拒绝覆盖与取消。此记录不覆盖干净机器、其他系统缩放、超长路径或正式发行。

本页保留第三十二批当时的 2.0.8 记录；第三十三批已在同一隔离位置更新为 2.0.9，55 份既有项目文件摘要保持，并验证未生成草稿的目录恢复和换端口重启，见 [后续草稿目录验收](studioContextRecovery.md)。

## 安装与已有文件

使用第三十一批的同一安装器：68848700 字节，SHA-256 `ff03b18ccbf28f0970ae0e90727fbd4725bf371694f06240250cc046b49a7c59`。目标仍为 `work/windowsSpeechIntegration1792430288397/installedApp/`，数据仍在其 `data/`。

在实际交互用户上下文运行 NSIS 静默更新，安装器退出 0；同一上下文的版本登记从 2.0.7 变为 2.0.8，安装目录与卸载器仍指向本安装。安装后资源版本为 2.0.8，构建 `1d4hz07wcs5yw`。经正常 SDK 启动器打开真实原生窗口，显示 2.0.8 更新说明。

安装前固定两个配音项目的 25 份文件摘要，安装后及后续界面验收后均一致。原项目五条配音和恢复目录三条配音保留；后续打开图片入口会新增草稿等文件，不把工作区总数描述为一直只有 25。系统配音仍实际列出两个音色，本批没有重新合成语音。

## 安装版背景移除

导入第三十一批的完整图片项目包到新目录 `data/workspaces/backgroundInstalledProject`，实际恢复三条图片历史、正文、模型与原图参考。导入时尚未启用本机模型，正确留下需配置 biRefNet 的依赖提示；在原生模型配置界面启用后，重新检查原包的依赖警告为空。旧导入记录保留其当时的提示。

固定模型缓存与授权清单从已核验副本准备，224005088 字节及 SHA-256 一致；本批未重复下载模型。首次原生生成任务 `00fa5e19-4367-4f4a-83d9-2d9194e2a061` 因 FFmpeg/ffprobe 尚未配置而明确失败，没有图片、用量或完成的推理检查点。不据此推断安装器删除过这些程序。

随后将已核验的 FFmpeg 6.1.1、ffprobe 6.1.1 准备到本安装的数据缓存，状态接口确认可用。这是复用已有二进制，不计作界面下载验收。原生图片工作台再次点击生成，任务 `a12fab68-5d54-4d31-84ba-cc7a7285aabf` 完成，推理 9863 ms，用量一条。输出为 1024 × 1024 RGBA PNG，1246925 字节，SHA-256 `248c429a9031d80a716fc4e098b2dd3ddd907db4e29bf5d1361469c816922ec5`，与第三十一批一致；界面显示四条结果。

本机任务采用 CNY 0 的明确手工估算，不填入供应商实付；估算不含硬件、电费和流量。本批只新增一次本机图片推理，新增 Agnes 及其他付费生成均为 0。前述依赖失败保留为历史失败任务，任务中心相应待处理数不代表新结果生成失败。

## 原生图片另存为

先在本批 `nativeExports/nativeBackground.png` 放置原图的独立副本，SHA-256 为 `f06df960ec626b85c5b38e786c6d9f3437cfbe18f5487700b98352d02601bec3`，作为覆盖目标，原图仍完整保留在原目录。

在原生结果卡点击下载，实际 Win32「另存为」输入上述路径，出现「nativeBackground.png 已存在，要替换它吗？」；选择「是」后，目标成为生成的透明 PNG，字节数与结果摘要一致，证明实际发生覆盖。

再次打开同一结果的另存为并选相同目标，明确选择「否」，返回文件名输入框；随后将目标改为 `cancelledBackground.png` 并取消。原导出的摘要和修改时间均不变，新名称下没有创建文件。原生对话框打开期间，后台状态请求实际返回 200，耗时 5 ms。

这项能力仍使用应用工作线程内的 Win32 Common Dialog，未改成现代 Common Item Dialog。未覆盖超长路径、所有文件系统或其他系统缩放。

## 证据

根目录 `work/nativeBackgroundInstall1792455077166`，指针 `work/currentBackgroundInstallFixture.json`。主要记录：

- `installerResult.json`：实际安装退出码、同一用户上下文的更新前后登记和资源版本。
- `beforeProjectFiles.json`、`afterInstallProjectFiles.json`、`oldProjectFilesAfterUi.json`：25 份既有文件的保留核对。
- `installedDependencyRejected.json`、`installedFfmpegPrepared.json`、`installedBackgroundImageCompleted.json`：依赖失败、工具准备与实际生成。
- `installedOverwriteAccepted.json`、`installedOverwriteRejectedAndCancelled.json`、`installedSaveHostResponsive.json`：覆盖、拒绝、取消和宿主响应。
- `installedBackgroundResult.jpg`、`installedOverwriteConfirm.jpg`、`installedOverwriteRejected.jpg`、`installedCancelTarget.jpg`：真实原生界面截图，保留原 JPEG 编码。

用于安装和启动的两项临时计划任务均退出 0 后移除。安装版和数据继续保留。M0–M5/P2 的其余条件仍按总计划验收，当前安装器未签名、未公开发布。
