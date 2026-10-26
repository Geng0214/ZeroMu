> 2026-10-23 归档：这是文档整理前的历史快照。当前目标见 [总计划](../plan.md)，当前状态见 [进度](../progress.md)，其他记录见 [归档目录](readme.md)。旧文中的“当前”、版本和待办仅适用于原记录日期。

# 本机背景移除

2026-10-20，第三十一批，对应 F09、统一媒体任务和 F11 项目迁移。已用实际模型完成生图工作台提交、镜头编辑器提交、排队取消、保存失败后的重启恢复，以及完整项目包的独立目录恢复。蒙版局部重绘与扩图仍未实现，F09 整体验收未结束。

后续第三十二批已实际完成 2.0.7 → 2.0.8 安装更新、安装版背景移除和图片另存为覆盖/拒绝/取消，见 [安装版后续验收](windowsBackgroundFiles.md)。下文的第三十一批副本范围和摘要保留为当时记录。

## 使用

1. 在「扩展管理」配置 FFmpeg 与 ffprobe。
2. 在「模型配置 → 本机背景移除」下载固定模型，完成后启用。下载可以取消和重新开始，关闭设置面板不会终止下载。
3. 生图创作选择「BiRefNet 背景移除 · 本机」，添加一张 PNG、JPEG 或 WebP；或在镜头候选的「编辑图片」中点击「移除原图背景并创建新候选」。
4. 在任务中心查看结果。镜头编辑入口以固定原图执行，忽略裁剪、旋转与输出尺寸参数；结果自动加入原镜头的新候选，保留父候选、来源版本和任务记录。采用需明确选择。

输出为与解码原图同尺寸的静态透明 PNG，多帧输入取首帧。输入上限 32 MiB，边长不超过 8192、总像素不超过 16777216。每次处理一张图，CPU 任务按渠道串行排队；支持取消尚未开始的排队任务。运行中的推理暂未提供任务中心取消入口。复杂边缘、半透明物体和其他画风需逐张预览后采用。

## 模型、运行环境与文件

固定使用作者发布的 [BiRefNet Tiny ONNX](https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx)，224005088 字节，SHA-256 为 `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333`。授权依据为[作者仓库的 MIT 许可证](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE)；完整声明随模型清单保留。作者 README 中 BRIA RMBG-2.0 的授权说明不用于此模型。

模型位于应用数据目录的 `localModels/biRefNetTiny/model.onnx`。先写入独占下载文件，核对长度和 SHA-256 后发布；取消或失败清理本次临时文件，显式重新下载会保留已有损坏的普通缓存文件。下载地址和重定向域名固定，不接受用户传入下载 URL。安装包和项目包不附带这份 224 MB 权重。

运行环境固定为 `onnxruntime-node`、`onnxruntime-common` 1.30.0，Windows 使用 CPU。桌面和独立服务构建复制当前平台的原生库与 CJS 依赖，并附带 [ONNX Runtime MIT 许可](https://github.com/microsoft/onnxruntime/blob/v1.30.0/LICENSE)及对应完整第三方声明。模型仓库代码不参与执行；推理使用固定应用程序，在独立 Bun 子进程内加载权重。图片经标准输入在本机解码、推理和编码，不上传到模型渠道。

## 实际验收

隔离根目录 `work/localBackgroundAcceptance1792450278332`，指针 `work/currentBackgroundRemovalFixture.json`。样本为既有真实生成的 1024 × 1024 双人插画，本轮未增加 Agnes 生成请求。

| 项目 | 实际结果 |
| --- | --- |
| 下载取消 | 界面在接收 179435182 字节后取消；模型未发布，无残留下载文件 |
| 重新下载 | 界面重新完成 224005088 字节，摘要与固定版本一致 |
| 生图界面任务 | `7eef5765-a4aa-43ee-9a31-1077ea9a0e0e` 完成，透明 PNG 1246925 字节 |
| 排队取消 | `c3ca8ea0-3c39-4596-a8f8-ca062dd0978e` 先排队后取消，检查点、用量、输出均为空 |
| 保存失败恢复 | `c485d7b8-40f6-4f27-9538-a24433874b8b` 实际完成推理后遇到 EEXIST；停止并重启服务、保留阻塞文件后继续原任务，输出与原检查点一致，用量仍一条，原推理耗时 10596 ms 未变 |
| 镜头编辑器任务 | `81c05f6e-6a43-4c4e-a8d2-536febb5c7cb` 完成，自动生成父候选关联，原采用不变；推理 10431 ms |
| 登记幂等 | 重复登记同一任务返回原候选，制作修订仍为 7 |
| 不匹配输入 | 同编号改正文返回 409 且任务文件不变；伪造来源候选返回 409，未写入任务 |
| 项目包恢复 | 9942211 字节，SHA-256 `2a3b04f50d134b15a8d877647fad291b309db8679749227b25f327d0bfccbce3`；独立目录恢复无警告，两份固定媒体摘要、候选、父关联和采用状态一致，任务作为只读历史保留 |

镜头结果 SHA-256 为 `248c429a9031d80a716fc4e098b2dd3ddd907db4e29bf5d1361469c816922ec5`。逐像素核对 RGB 改变数为 0，Alpha 增加数为 0；470771 像素全透明、40701 像素不透明、537104 像素部分透明。该证据只覆盖此样本，不代表复杂场景普遍达到同等质量。

本地费用采用有明确来源的 CNY 0 手工估算，报告一张图片与 1048576 像素用量，不伪造渠道实际扣费，不包含硬件、电费或下载流量成本。主 `data/settings.json` 摘要仍为 `65bb7d1f460553d78bba7de21ff633dace367b001a74c339d0e5c4901205a84a`。

桌面 1280 × 720 与窄屏 390 × 844 已检查；窄屏无横向溢出，背景移除按钮高 44 像素。截图 `backgroundUiResult.png`、`backgroundCandidateComparison.png`、`backgroundCandidateMobile.png`、`backgroundEditorMobileActual.png` 位于上述隔离根目录。较早的 `backgroundEditorMobile.png` 是不适用的 CDP 截图试取，不能作为窄屏验收证据。

详细机器记录包括 `candidateCompleted.json`、`candidatePixelProbe.json`、`candidateNegativeInputs.json`、`cancelledNoExecution.json`、`recoveryCompleted.json` 与 `backgroundPackageRecovered.json`。

## 2.0.8 桌面候选

完整桌面构建与 NSIS 打包退出 0，构建 `1d4hz07wcs5yw`。原生运行使用同一更新归档的解压副本，通过其真实 SDK 启动器打开窗口，数据和项目均在隔离根目录的 `nativeCandidate208/`。这是内部原生副本验收，尚未执行 2.0.8 安装或更新，不替代第三十批 2.0.7 安装版记录。

先由打包后的服务完成 HTTP 任务 `c0957732-8283-4c16-9c36-1dbdd833f6e8`，推理 11044 ms；随后实际在原生窗口选择独立项目目录、进入原图候选编辑器、点击背景移除，任务 `2bfdd078-bc2b-4ab2-a0bb-81cdf6355c09` 完成，推理 9553 ms。后者自动登记为候选 3，父候选仍为 1，制作修订为 8，原采用未变。输出仍为 1246925 字节，SHA-256 与前述结果一致，用量一条。该验收覆盖压缩后的工作程序、打包 Bun、外置 ONNX CJS 与原生库路径，以及真实原生界面提交。

原生截图为 `nativeBackgroundCandidateComparison.jpg`，原始编码保留；来源记录为 `nativeUiBackgroundCompleted.json`。用于交互会话启动的临时任务 `zeromuBackgroundPreview1792450278332` 退出 0 后已移除。早先直接启动压缩前占位启动器失败、直接以隐藏方式运行 Bun 的服务未显示窗口，均未计作原生界面通过；上述正式证据来自已解压的 SDK 启动器。旧 2.0.7 验收窗口已正常关闭，旧安装与配音数据保留。

最终产物位于 `nativeCandidate208/artifacts/`：

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| zeromu-2.0.8-Setup.exe | 68848700 | ff03b18ccbf28f0970ae0e90727fbd4725bf371694f06240250cc046b49a7c59 |
| stable-win-x64-update.json | 197 | f3d704a9fd8cf76a455ec50060f47662ca730bcde13b5b8935c70a23bcc319b3 |
| stable-win-x64-zeromu.tar.zst | 71870943 | 5a54e68019c2704759a0925b741ea5c2344632ebc2cecb889d6e77068dc3cf8d |

本批共完成两次直接本机推理验证及五次统一任务实际推理；排队取消未执行推理。Web、服务端、桌面、Provider 和工具类型检查通过；完整桌面构建通过。界面检测工具退出 0、无输出；不视为完整可访问性认证。首次完整打包因未指定本机已有 NSIS 路径失败，后续使用已验证的本机 NSIS 3.13 完成；桌面类型检查发现字节数组与 Blob 的类型差异后已修正并重新构建。当前产物未签名、未公开发布。
