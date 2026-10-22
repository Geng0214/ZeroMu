# 安装版配音与原生文件对话框验收

日期：2026-10-20；执行记录第三十批，对应 F08、F11、F12。本机 Windows x64 的实际安装版已完成系统配音、音频另存为、项目包原生选择上传及独立目录恢复。此记录不覆盖干净机器、其他系统缩放、跨设备或正式发行。

本页保留第三十批当时的 2.0.7 记录；第三十二批已在同一隔离安装更新为 2.0.8，并验证背景移除和图片覆盖/取消，见 [后续安装版验收](windowsBackgroundFiles.md)。

第三十三批同一安装已更新为 2.0.9，既有文件摘要保持；另验证工作站未生成草稿目录与原生重开，见 [最新安装记录](studioContextRecovery.md)。

## 当前候选

隔离根目录为 `work/windowsSpeechIntegration1792430288397`，指针为 `work/currentNativeSpeechFixture.json`。应用仍安装于其 `installedApp/`，用户数据位于同级 `data/`；当前版本 2.0.7，构建 `180nkjypnfvgr`，未签名、未公开发布。

最终文件位于 `saveDialogCandidate/`：

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| zeromu-2.0.7-Setup.exe | 46411197 | db6706b246f75dbaf3035612d4b7e7329a40cde9bf5dca1d31b786b3de3f5a18 |
| stable-win-x64-update.json | 197 | 0994cb7aadef18adba5d2322dea7c06f11eefad0175824a1a9208dd2992428bc |
| stable-win-x64-zeromu.tar.zst | 48455845 | b799de5b13a0bd4444aaa91ad820c1dc1f7fc4654d0dd3199fddf5c36adf3418 |

`candidate/` 保留本批较早的 2.0.6，`saveDialogCandidate/zeromuBeforeInstallerCleanup.exe` 保留尚未清理旧辅助程序的首次 2.0.7 安装器，均不能与最终安装器摘要混用。完整桌面打包及最后一次 NSIS 重打包退出 0。

## 安装版实际配音

先在真实 2.0.6 原生窗口启用本机配音，实际音色目录列出 Huihui（zh-CN）和 Zira（en-US）。隔离项目以 CNY 0 估算策略提交两条正常语速的 Huihui MP3：

| 提交路径 | 任务 | 结果 |
| --- | --- | --- |
| 安装版实际 HTTP 服务；不计作界面提交 | e97e6146-d924-478c-80c8-b6cfa25804f2 | 22 字，97802 字节，6.112625 秒，SHA-256 a82312354f7e77555b3da8cfb18bf0bc4705efb898fc0e88de797b23ef689095 |
| 原生音频工作台输入并点击生成 | ba451daa-d5a1-4579-8ae1-5b6772bb2e77 | 30 字，142106 字节，8.881625 秒，SHA-256 c60acc36508c27da2b8230348c6289c7c335b34d2e429dc7634b70871b75121d |

两条均为 22050 Hz 单声道；FFmpeg 完整解码退出 0，峰值分别 -1.0 和 -2.5 dB。每项只有一份字符用量回执。原生页面出现五条结果，包含此前独立项目包中的三条归档音频。2.0.7 原生播放器实际将新生成的 30 字音频播放至 8.881620407104492 秒，界面显示 0:08 / 0:08；不据此评定声音自然度或商业成片质量。

## 另存为的修正与落盘

旧实现另启 WinForms 辅助进程，并使用不可见顶层窗口作为所有者。实际操作时可见保存框，但它与零幕主窗口的进程及所有者关系使原生控制和窗口定位不稳定。本批移除该辅助程序，改为同一 Bun 进程的工作线程调用 Windows `GetSaveFileNameW`，明确绑定零幕实际主窗口 HWND，并核对其属于当前进程。原生调用在工作线程运行；宿主仍负责一次性保存令牌、过期校验和原子写入。

从真实结果卡点击下载，在原生保存框选择 `nativeExports/nativeUiNarration.mp3` 并确认保存，最终文件为 142106 字节，SHA-256 与源音频完全相同。打开保存框期间，宿主首页 HTTP 返回 200。随后另一结果再次打开保存框，取消后未生成对应文件，首次导出文件保持原摘要。证据为 `nativeUiSaveFile.json`、`nativeSaveDialogHostResponsive.json`、`beforeGracefulRestart.json`、`nativeSaveDialog.jpg` 及文本记录。

首次同目录升级虽然返回安装成功，但旧的 `saveFileDialog.exe` 仍存在。已在 NSIS 安装过程定点清理这一个已废弃文件，随后同目录重装最终安装器：退出 0，登记版本 2.0.7，所有者路径保持，新工作线程存在，旧辅助程序不存在。原始失败检查保留在 `nativeSaveDialogUpgrade.json`，修正后的结果在 `nativeSaveDialogInstallerRevision.json`。

实际采用的是 Windows Common Dialog API，不是 Common Item Dialog。接口和所有者字段依据 [GetSaveFileNameW](https://learn.microsoft.com/en-us/windows/win32/api/commdlg/nf-commdlg-getsavefilenamew)、[OPENFILENAMEW](https://learn.microsoft.com/en-us/windows/win32/api/commdlg/ns-commdlg-openfilenamew)；Windows x64 结构布局同时核对 Microsoft 的实际 SDK 头文件。本次未验证已有文件覆盖确认、超长路径、网络盘、其他系统缩放及 macOS 路径。

## 正常关闭与跨端口重开

先核对并保存项目 12 个文件摘要，通过原生 Alt+F4 正常退出；实际确认本安装进程和旧监听端口均退出。重新启动后端口从 59399 改为 58580，12 个项目文件摘要全部一致，页面恢复原 30 字正文、Huihui、MP3、语速 1、项目目录及五条结果。没有重新合成。见 `nativeGracefulClose.json`、`nativeGracefulRestartFiles.json`、`nativeGracefulRestart.jpg`。

之后通过「打开项目」进入制作视图时，应用正常建立一张空白画布；随后上传的 ZIP 和恢复任务也写入相应记录。因此“12 个文件完全一致”仅指上述正常重启检查点，不代表后续全部操作后文件数量仍为 12。

## 原生上传与选择恢复目录

在实际安装版项目包面板，调用 WebView2 的原生文件选择窗口，选中第二十九批已核验的完整配音项目包，通过键盘确认选择后完成本地上传和清单读取。上传副本为 `speechProject/projectImports/db4cf9e2-e181-4b1f-83ab-abe276fd63e8.zip`：762811 字节，SHA-256 `f6148680cc47088eb51d516989959d2427e171effda70f806e77d258255a6109`，与原包一致。

再通过原生目录选择器指定本安装的数据工作区，输入尚不存在的 `speechNativeRestored`，在页面实际点击「校验并恢复到新目录」。任务 `a20ab278-308c-4892-8876-b5416ee1974d` 完成，warnings 为 `[]`。新目录三条音频逐文件摘要与原包一致，三份来源任务仍为只读归档。实际点击打开恢复项目后，原生音频工作台显示三条记录和原保存正文。

这里恢复的是第二十九批的三条配音，不包含第三十批新增的两条。原 `speechProject` 五条音频均保持原摘要。旧目录显示的“需重新配置”来自其此前保存的 `projectImportState.json` 历史说明；本轮新包校验和新恢复结果没有该警告。见 `nativePackageUploadRestore.json` 及 `nativePackageFileSelection`、`nativePackageUploadInspected`、`nativePackageRestoreDirectory`、`nativePackageRestoreCompleted`、`nativeRestoredAudioHistory` 图片与文本。

## 费用与边界

本批成功本机合成 2 次，累计本机成功 5 次；新增 Agnes 和其他付费模型生成均为 0。Agnes 累计仍为 4 次，两笔视频 HTTP 503 的不确定状态和估算占用保持，人民币 10 元上限保持。未填写未知供应商实付账单。

原项目任务总数 5，全部完成，运行和待处理数均为 0，其中三份为归档回执。主 `data/settings.json` 摘要保持 `65bb7d1f460553d78bba7de21ff633dace367b001a74c339d0e5c4901205a84a`。两项本轮临时 Windows 验收任务收集最终退出 0 后已清理。最终摘要为 `nativeSpeechFinalSummary.json`。

没有新增依赖、路由、测试框架、测试文件或临时脚本文件。原生另存为和项目包文件选择的本机路径已有实际证据；干净 Windows、WebView2 安装边界、跨设备、系统 DPI、发布签名、自有 HTTPS 源、真实视频、完整作品和创作者试用继续验收。完整 M0–M5 与 P2 目标仍在推进。
