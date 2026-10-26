> 2026-10-23 归档：这是文档整理前的历史快照。当前目标见 [总计划](../plan.md)，当前状态见 [进度](../progress.md)，其他记录见 [归档目录](readme.md)。旧文中的“当前”、版本和待办仅适用于原记录日期。

# 2.0.12 配置校验隔离的原生安装验收

2026-10-20，执行记录第四十一批，对应 F12/SEC-09 的本机安装跟进。复用第四十批最终候选，没有重新构建；完整产品目标继续执行。

## 安装与项目文件

实际升级为 2.0.12 / 3i5r8gby4ou2k，安装器 69655494 字节，SHA-256 c433c78778edfa002bce71dd085fd31717f65ebe4b0f4a203da794d79b1164dd。使用前重新核对冻结的安装器、更新清单和更新包，未使用初次或中间候选。

升级前已记录 data/workspaces 下全部 363 份文件，共 2610221937 字节。原生旧画布显示 300 节点、20% 和已保存，经 Alt+F4 正常退出，确认旧 PID 35740 结束。NSIS 实际安装退出 0，同一交互用户 LOCALHOST\LOCALUSER 的登记由 2.0.11 变为 2.0.12，目录保持；安装后首次启动前，全部旧文件大小和摘要一致。

实际安装的 SDK 启动器启动后，原生更新说明显示 2.0.12 / 3i5r8gby4ou2k，并包含配置校验的异常保护说明。捆绑 Bun 为 1.4.0。安装资源与冻结归档逐项匹配：

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| app/Resources/app/toolConfigWorker.js | 463847 | 9eda722921b7098aeeb2f9764ec0b6a7875d0c8275ed1cdb2653649f44ea2372 |
| app/Resources/app/bun/index.js | 14809690 | d7aeaa4117bbce8dfa6c28fe36e75f516bb516bc7873500df8ff7ccbcf8255f6 |

## 原生配置、安装版接口与重启

在实际「设置 → 扩展管理」筛选「读取网页」，打开配置框，使用数值增加按钮把超时从 20000 改为 21000 毫秒并保存；正文最大字符数保持 40000。原生配置框正常关闭，磁盘配置保存为相同数值。本批只校验配置，没有调用网页读取或任何生成工具。

随后向同一原生宿主 53719 端口发送 timeoutMs=999 的非法配置，返回 400，安装数据的 settings.json 摘要保持。工具原本已启用，重复确认 enabled=true 返回 200，配置摘要和无禁用标记的状态保持。内置工具作者为 Toonflow，原生界面按既有规则不显示禁用开关；这次验证的是安装版启用校验接口，**不是本批完成原生禁用到启用的切换**。

经 Alt+F4 正常退出并确认 PID 51868 结束，用实际 SDK 启动器重开，PID 45212、端口 60894。再次从原生设置打开配置框，仍显示 21000 / 40000。随后通过原生减少按钮恢复 20000 并保存，最终有效配置与升级前相同，工具仍启用。原先没有显式配置项，本次留下相同默认值的显式记录；不宣称整个安装 settings.json 字节保持。

从画布库打开原 mediaScaleCanvas，显示 300 节点、25 条连接、20% 缩放和已保存。最终再次核对全部 363 份旧项目文件，大小与摘要一致，没有新增项目文件；画布 SHA-256 仍为 77a9ee6fa20afa36050f9f3794390b0d55d22f6c9039c9bd3a81b4d64a13b606。比较起点为升级前的 2.0.11，不回溯否认第三十七批归档初始化时的历史差异。

## 证据和范围

根目录 work/windowsToolProcessIntegration1792467208938，指针 work/currentWindowsToolProcessFixture.json。主要证据：

- candidateArtifacts.json、installerResult.json、installedResources.json、installedBunVersion.json。
- beforeUpgradeProjects.json、afterInstallProjects.json、finalProjectIntegrity.json。
- native212Release.jpg/.txt、nativeConfig21000.jpg/.txt、nativeConfigSaved.jpg/.txt。
- installedConfigHttp.json、restartResult.json、restartConfigOnDisk.json。
- nativeConfigRestarted21000.jpg/.txt、nativeConfigRestore20000.jpg/.txt、nativeConfigRestored.json。
- native212ScaleRestarted.jpg/.txt、ownedTaskResults.json、ownedTasksAfter.json、windowsToolProcessFinalSummary.json。

三个本批安装、启动、重启计划任务均退出 0 后移除，轮询观察已结束。一次 CIM 进程事件订阅返回「调用已取消」，后续采样未捕获短期校验进程，采样记录另有两次共享读取冲突提示；这些观察不作为子进程生命周期通过证据，也未修改产品文件。完成操作后的原生宿主子进程快照仅含 conhost 和 WebView2，没有 Bun 校验子进程；该快照也不代表捕获了每次进程的开始和结束。第四十批的源码、异常输入及归档冷运行保留各自证据范围。

本批没有运行时代码、依赖、测试文件、临时检查脚本或构建变更，不重复计为新类型检查或新构建。主仓库 data/settings.json 摘要保持 65bb7d1f460553d78bba7de21ff633dace367b001a74c339d0e5c4901205a84a。没有新增模型请求、本机配音或背景推理；Agnes 累计六次请求、估计占用 0.445 美元及人民币 10 元总上限保持，实际账单未知。

当前实际安装版为 2.0.12，未签名、未公开发布。配置校验仅覆盖本机原生保存、非法参数拒绝、重复确认启用及重启保留；不扩大为所有插件、传输故障、其他设备或系统 DPI 的验证。Agent/团队创建执行与 SDK 回调、供应商及浏览器代码边界仍待完成，完整约束见 [插件执行边界](pluginExecutionBoundary.md)。真实视频成功与账单、三类完整作品、创作者试用、干净机器和正式发行资源继续执行。
