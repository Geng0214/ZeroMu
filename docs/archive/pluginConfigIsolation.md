> 2026-10-23 归档：这是文档整理前的历史快照。当前目标见 [总计划](../plan.md)，当前状态见 [进度](../progress.md)，其他记录见 [归档目录](readme.md)。旧文中的“当前”、版本和待办仅适用于原记录日期。

# 工具配置校验的进程隔离

2026-10-20，执行记录第四十批，对应 F12/SEC-09 的部分实现。保存配置与启用工具时的模块加载和 validateConfig 已移到独立 Bun 进程；Agent、团队的 createTools/execute 仍在宿主执行，完整插件隔离尚未完成。

第四十一批已实际升级为 2.0.12，原生配置保存、安装版非法参数拒绝与重复确认启用、正常重启保留及恢复原值通过；全部 363 份旧项目文件摘要保持。见 [2.0.12 原生安装](windowsToolProcessIntegration.md)。下文保留第四十批的源码与候选验收范围。

第四十二批进一步接入源码的 Agent/MCP/团队执行与回调，见 [工具执行隔离](pluginExecutionIsolation.md)。该批通过编译 HTTP 和仓库外 Bun 1.4.0 冷调用，尚未生成或安装新桌面包；以下“仍在宿主”的描述限定第四十批及已安装 2.0.12，不作为当前源码位置结论。

## 已实现的范围

保存配置和启用工具继续使用原本的本机来源检查、插件文件锁、元数据和默认配置。宿主读取已校验的自包含工具源码快照，只把该源码和本次配置发给工作进程；工具模块不再通过这两条路由进入宿主 import 缓存。工作进程单独注册原有 toonflow:tool-zod 虚拟模块，用内存 Blob 加载收到的快照，核对导出后执行配置解析。

初始化和配置校验共用 5 秒截止时间。成功、拒绝、超时、断开或退出都结束本次子进程并等待其退出，不自动重试。返回配置须为 JSON 对象且不超过 8 MiB；错误正文最多 4000 字符。校验成功后才按原有规则保存配置或删除禁用标记，失败保留原状态。没有改变插件安装格式或长期媒体任务的执行时限。

进程环境只传运行所需的 PATH、Windows 系统目录、临时目录及语言变量，不继承应用数据目录或其他环境变量。子进程仍有当前用户的操作系统权限，不能据此声称磁盘、网络、凭据或任意第三方代码已被沙箱限制。

主要实现为 server 的 toolProcess.ts、toolConfigWorker.ts 与 tools.ts，两个工具管理路由复用同一入口。独立服务和桌面构建均生成自包含工作进程；Windows/ARM Mac 及 Intel Mac 的复制清单均包含该文件。桌面端通过 SDK 的资源目录明确传入 toolConfigWorkerPath；独立服务保留同级工作进程定位。

## 实际验证

| 项目 | 本机结果 |
| --- | --- |
| 八个内置工具的默认配置 | 全部通过独立进程；没有执行工具或媒体生成 |
| 模块顶层死循环、配置死循环、未结束的模块初始化 | 5 秒截止后拒绝，状态 504 / TOOL_WORKER_TIMEOUT |
| 插件主动退出 | 状态 502 / TOOL_WORKER_EXIT，宿主继续可用 |
| 非法进程消息、断开、无效导出及模块语法 | 按协议或配置错误拒绝；发送时结构化克隆失败也完成清理，无未处理的 Promise 拒绝 |
| 配置抛错、非 JSON 结果、超过 8 MiB 的结果 | 拒绝，没有按成功配置返回 |
| 异常期间的真实 HTTP 读取 | 同一宿主的 63 次设置读取均为 200，单次观测最大 10 ms；不作为完整性能结论 |
| 编译后应用的保存与启用接口 | 错误配置均 400，旧配置摘要和禁用标记保持；合法保存和启用均 200 |
| 进程及环境 | 子 PID 与宿主不同；环境哨兵及 TOONFLOW_DATA_DIR 未传入；子进程退出、宿主全局标记未改变 |
| 仓库外冷运行 | 临时目录及其父目录无 node_modules，关闭自动安装，实际安装目录 Bun 1.4.0 执行编译产物，八工具及超时/退出检查通过 |
| 桌面资源布局 | 实际归档入口为 Resources/app/bun/index.js，工作进程为 Resources/app/toolConfigWorker.js；明确传入路径后，改变 cwd 仍可校验八工具，编译应用的实际 HTTP 保存返回 200 |

源码异常检查的整轮观测包含 HTTP 轮询和收尾，三个超时场景为约 5.05–5.31 秒；5 秒指截止定时器，不是承诺整个请求严格在 5000 ms 内结束。

首次长 data URL 在 Bun 1.3.14 / Windows 触发 NameTooLong，改为 Blob 后通过全部内置工具。首次内联 HTTP 请求遗漏应用所需请求头而返回 403，补齐请求后验证业务状态；没有放宽来源保护。初次资源定位把启动器当作业务入口，旧冷布局证据保留，由 configuredDesktopLayout.json 的真实业务布局验证取代；相关初次和中间候选未安装、未发布。

## 构建、证据与后续

server 和桌面类型检查、server/MCP 构建通过。最终桌面 SDK 构建与 NSIS 安装器阶段分别退出 0，2.0.12 / 3i5r8gby4ou2k 候选包含工作进程及明确资源路径。最初完整打包命令在默认 NSIS 路径缺失处退出，随后复用仓库已有 NSIS；不把失败命令改记为退出 0。既有前端大分块提示保留。第四十批结束时实际安装仍为 2.0.11，后续第四十一批已补齐上述本机原生安装跟进。

| 最终冻结产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| zeromu-2.0.12-Setup.exe | 69655494 | c433c78778edfa002bce71dd085fd31717f65ebe4b0f4a203da794d79b1164dd |
| stable-win-x64-update.json | 198 | cba2466c77cd2ebf55e051257b11e52cbe08ae47e90b24b43fb1e458432696fb |
| stable-win-x64-zeromu.tar.zst | 72768404 | 8f65b253c589e92ba9778f1998c3aeb1af89c32569dcfe48564eac9876ef41c6 |

冻结目录为本批 candidate212/artifacts。更新归档内 Resources/app/bun/index.js 包含明确工作进程参数及 SDK 相对路径；Resources/app/toolConfigWorker.js 为 463847 字节，SHA-256 9eda722921b7098aeeb2f9764ec0b6a7875d0c8275ed1cdb2653649f44ea2372，与本批构建一致。重新从最终归档提取该工作进程和八个工具，在仓库外用 Bun 1.4.0、关闭自动安装后复验八工具、顶层死循环和主动退出，均通过；这属于产物冷运行，不替代原生应用安装验收。

证据根目录 work/toolProcessAcceptance1792465604356，指针 work/currentToolProcessFixture.json。builtInConfigResults.json、sourceAbnormalResults.json、compiledHttpResults.json、environmentAndCleanup.json、protocolAndCleanupResults.json、coldRuntimeResults.json、configuredDesktopLayout.json、configuredCompiledHttp.json 保存各自范围；candidate212Artifacts.json、candidate212SourceInputs.json、candidateWorkerColdResults.json 对照最终产物，toolProcessFinalSummary.json 保存汇总。早期失败记录和被替代的布局记录保留，不混用为最终通过证据。初次 8yuo0dnkwus3 和中间 ldls2kscu5j 候选独立保留，未用于安装。

Agent 与团队私有工具仍通过 loadTool 在宿主加载，SDK 闭包、Buffer/Stats、同步技能目录、画布、提问、媒体任务、FFmpeg、进度和取消的桥接仍需继续实现及验收。供应商 VM 和浏览器节点属于另外的执行边界，完整约束见 [插件执行边界](pluginExecutionBoundary.md)。

本批没有新增依赖、测试文件、框架或临时检查脚本。异常插件输入只用于内联进程调用，没有写成测试插件文件。主配置未改动，没有新增模型请求、本机配音或背景推理；Agnes 六次请求、估计占用 0.445 美元和人民币 10 元上限保持，实际账单未知。完整 M0–M5 与 P2 目标保持活动。
