# Windows 桌面版安全检查记录

日期：2026-10-09。范围：本机 Express 服务、Vue 文件展示、设置保存、Windows 更新下载及依赖审计。方法：应用 `security-best-practices` 的 Express/Vue 指引，结合源码检查和隔离目录中的真实 HTTP 请求。本记录不是全面渗透测试或安全认证。

2026-10-20 跟进：第三十八批已处理下表 SEC-08 的九组依赖，当前源码锁文件审计为空对象、退出 0，并完成类型/构建、实际 MCP stdio → HTTP 读写和本机 Markdown 预览。完整范围见 [依赖维护记录](dependencyMaintenance.md)；已安装 2.0.10 属于此前候选，新依赖的安装验收另行记录。SEC-09 插件隔离仍未实现，[执行边界核对](pluginExecutionBoundary.md)明确了后续必须保留的契约。

后续第三十九至四十一批补齐依赖及配置校验的本机安装；第四十二批接入执行隔离源码、编译接口与仓库外冷运行。第四十三批进一步加固宿主反射与能力访问边界，实际安装为 2.0.13，并完成安装目录 MCP、隔离工具、真实画布回调、取消清理与原生重开，见 [安装版联合验收](windowsToolBoundaryIntegration.md)。自定义同步钩子兼容、真实模型多轮联合交互和其他执行边界仍待完成，项目字节变化例外单独记录，不扩大为整体安全认证。

第三十九批补齐新依赖的本机实装：实际升级为 2.0.11，使用安装目录自带 Bun/stdio 连接原生宿主，公式与图表在原生重启后保持，363 份既有项目文件摘要不变。范围见 [原生整合记录](windowsDependencyIntegration.md)；其他设备和 SEC-09/SEC-10 仍保留原要求。

## 已处理项

| 编号 | 风险级别 | 问题与处理 | 证据 |
| --- | --- | --- | --- |
| SEC-01 | 高 | 桌面文件接口不能作为公网后台。独立服务绑定 `127.0.0.1`；路由前校验真实套接字、Host、Origin/Referer、Fetch Metadata；移除全局宽松 CORS。 | `apps/server/src/index.ts:21`、`apps/server/src/lib/localRequest.ts`；跨源、跨端口、伪造 Host、代理非本机标记均返回 403。 |
| SEC-02 | 高 | 工作区 HTML/SVG 直接打开可能取得应用源权限。原始文件响应增加 CSP `sandbox` 和 `nosniff`；沿用预览令牌和工作区路径授权。 | `apps/server/src/routes/workspaces/files/read.ts:14`；目录链接越界 403、危险路径 400、篡改预览令牌 403、合法读取 200。 |
| SEC-03 | 中 | 解析错误可能把请求正文写入日志；设置请求不应使用媒体上传的体积额度。日志改为方法、路径、错误类型与状态；畸形 JSON 返回通用消息；普通 JSON 限 8 MB，指定媒体接口单独限额。 | `apps/server/src/app.ts`；携带验收用敏感标记的畸形 JSON 返回 400 且响应不回显，9 MB 设置请求返回 413。未宣称所有第三方错误文本已脱敏。 |
| SEC-04 | 高 | 更新源及重定向可能降级为明文。新更新地址只接受 HTTPS，本机开发允许 HTTP；逐跳验证、最多 5 次重定向、禁止 HTTPS 降为 HTTP。 | `apps/desktop/src/update/fetchUpdateArtifact.ts`；本机重定向成功、远程 HTTP 被拒、循环有界、HTTPS 降级在发送前被拒。 |
| SEC-05 | 中 | 没有自有更新源时显示“最新版本”或检查状态无法恢复，会误导用户；旧不安全地址还可能阻断无关设置保存。新增来源状态，先验证来源再进入检查状态，仅在修改来源时校验新值。 | `apps/server/src/utils/desktop/index.ts`、`routes/settings/save.ts:54`、关于面板；重复未配置检查可恢复；旧地址未变时主题保存成功，新不安全地址返回 400。 |
| SEC-06 | 高 | 继承上游标识可能覆盖现有 Toonflow 的安装登记与启动协议。改为 `local.zeromu.desktop` 和 `zeromu://`，同步更新器和原生辅助程序身份检查。 | `electrobun.config.ts`、安装器、协议启动器、更新辅助程序；最终包清单标识为 `local.zeromu.desktop`。未操作既有 Toonflow 安装。 |
| SEC-07 | 严重（依赖告警） | `proxy-addr` 告警通过工作区 override 升级至 2.0.8，锁文件中不再保留 Express 的旧副本。 | `package.json`、`bun.lock`；升级后 `bun audit --json` 不再报告该包。告警利用条件要求特定 `trust proxy` 配置，本应用未设置该配置；不能据此声称此前已经发生入侵。 |

## 仍需完成的发行前工作

| 编号 | 级别 / 性质 | 待办与边界 |
| --- | --- | --- |
| SEC-08 | 依赖维护，源码及本机实装已验证 | 2026-10-09 的 9 组历史告警已在第三十八批通过固定兼容版本、移除 fast-glob 和清理未使用的可选依赖链处理。当前锁文件审计为 0 组；MCP、路由和公式/图表实际回归通过，第三十九批补齐 2.0.11 本机安装、安装目录自带 MCP、原生预览及重启。其他设备兼容与后续持续审计保留。不是整体安全认证。 |
| SEC-09 | 信任边界，工具执行已隔离，其他边界继续推进 | 第四十至四十一批完成配置路径及 [2.0.12 原生跟进](windowsToolProcessIntegration.md)。第四十二至四十三批接入 Agent/MCP/团队加载、创建与执行并加固宿主能力边界；实际 2.0.13 的 SDK、技能、FFprobe、真实画布回调、工作区拒绝、取消清理及重开通过，见 [安装版联合验收](windowsToolBoundaryIntegration.md)。自定义同步钩子兼容、真实模型多轮交互、供应商和界面边界继续处理。普通用户进程不是操作系统沙箱；凭据另见 [API 凭据安全报告](apiCredentialSecurity.md)。 |
| SEC-10 | 发行门槛 | 当前安装包未做 Authenticode 签名；自有 HTTPS 更新托管与干净机器安装仍待完成。本机跨版本更新、中断、超时和启动失败回滚已有后续实际记录，见 windowsDesktopChecklist.md；这些结果不覆盖其他设备。不能把 HTTPS 下载校验等同于独立的软件签名认证。 |

MCP 告警涉及 OAuth 重定向。当前 `packages/mcp/src/stdio.ts` 使用本机 Bearer 传输，未配置 OAuth/authProvider；因此当前检查未发现该触发路径，但升级仍列入依赖维护。对其余依赖不作“不可利用”的推断。

桌面 API 不支持作为公网服务开放，也不应通过公网反向代理或 SSH 转发直接暴露。未来商业 API 服务需单独实现账户鉴权、额度、账本、限流及服务端密钥管理。

## 复核资料

- `build/desktopReview/securityWorkflowResults.json`：26 项实际 HTTP 检查，最后在依赖升级后重跑通过。
- `build/desktopReview/updateResults.json`：更新状态与地址策略；使用替代桌面运行时，不代表原生安装成功。
- `build/desktopReview/updateTransportResults.json`：下载重定向策略。
- `build/desktopReview/dependencyAuditAfter.json`：剩余依赖告警原始记录。
- `build/desktopReview/typecheck.log`、`desktopPackage.log`：类型检查与完整 Windows 打包记录。

证据位于被 Git 忽略的构建目录，仅供当前本机复核；没有提交测试文件、用户密钥、真实配置或项目内容。

依赖依据：[proxy-addr 官方安全告警](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)、[MCP OAuth 安全告警](https://github.com/advisories/GHSA-6qxp-vccf-f47h)。
