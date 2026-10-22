# 依赖维护与 Markdown 兼容验收

日期：2026-10-20；执行记录第三十八批，对应 F12/M5 的依赖兼容和发行前维护。原生安装版仍为第三十七批 2.0.10，本批源码改动及新候选的安装验收须分别记录。

后续：第三十九批已完成同一隔离安装的 2.0.10 → 2.0.11，实际安装目录 MCP、原生公式/图表、换端口重开及 363 文件保持通过。下文「尚未安装」均指第三十八批结束时，当前结果见 [2.0.11 原生整合](windowsDependencyIntegration.md)。

## 当前依赖调整

实际 `bun audit --json` 在调整前返回 9 组告警、退出 1；调整后返回空对象、退出 0。范围是本次锁文件与查询时可用的告警数据库，不能据此宣称全部安全风险清零。

| 依赖组 | 原锁定状态 | 本次结果 |
| --- | --- | --- |
| MCP client | 2.0.0 | client/core/server 对齐固定 2.2.0；node 适配包沿用现有兼容版本 |
| brace-expansion | 5.0.9；旧可选分支 1.1.18 | 当前图中只保留 5.0.12；旧分支随未使用的 Stylus 链移除 |
| braces | 3.0.3 | 移除唯一引入它的 fast-glob；使用现有统一文件接口枚举路由 |
| decode-uri-component | 0.2.2 | 随未使用的 Stylus/css/source-map-resolve 链从锁文件移除；没有强制用 ESM 0.5.0 替换旧 CommonJS 调用 |
| DOMPurify | 3.4.15 | 固定 3.4.17 |
| fast-uri | 3.1.7 | 固定兼容的 3.1.8，未升级到 4 系列 |
| KaTeX | 0.16.47 | 固定 0.18.2，前端明确声明依赖并加载对应样式与本机字体 |
| source-map-js | 1.2.1 | 固定 1.2.2 |
| undici | 8.9.0 | 固定 8.10.2，覆盖上游 Agent SDK 的精确旧依赖 |

除三个 MCP 直接依赖外，必要传递依赖固定在根 overrides。没有添加未使用的根 brace-expansion 直接依赖。当前 Bun 1.3.14 实际未应用尝试的版本选择覆盖规则，已撤回该规则；最终使用普通覆盖并逐项检查实际锁定结果。中间审计仍告警的记录保留，没有将未生效的声明计作修复。

锁文件包记录 974 → 943，移除 31 项、新增 0 项，10 项已有记录版本变化。其中 source-map 的根记录从 0.7.6 变成 0.6.1，是旧 Stylus 分支消失后既有 escodegen 依赖的去重，不是把该消费者从新 API 降为旧 API。完整差异留在 lockDependencyDifference.json；没有手改第三方实现或新增补丁。

路由生成现在用 `@toonflow/file` 的 readdir 递归枚举普通 `.ts` 文件，继续排除隐藏路径并按原规则排序。改动前比较两种枚举结果均为 163 项、顺序一致；实际运行生成器退出 0，router.ts 字节保持，SHA-256 ddebb1b42f3cbb442acf41159e063d22a99ad6259e665cbef339a20a516c2224。没有手工维护生成的路由。

上游依据：MCP 的 [2.2.0 发行说明](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.2.0)与[凭据来源告警](https://github.com/advisories/GHSA-6qxp-vccf-f47h)；brace-expansion 的[递归边界告警](https://github.com/advisories/GHSA-qhr7-859c-m2p7)；braces 的[维护者问题记录](https://github.com/micromatch/braces/issues/70)；KaTeX 的[修复发行版](https://github.com/KaTeX/KaTeX/releases/tag/v0.18.2)与[样式兼容说明](https://github.com/KaTeX/KaTeX/releases/tag/v0.18.0)。本次没有为尚无修复的 braces 虚构上游版本。

## 实际运行与界面

server、web、MCP 和桌面类型检查通过；server、MCP、web 实际构建通过，Web 仍有既有大分块提示。隔离运行数据位于本批 work 目录，编译的 createApp 实际监听 127.0.0.1:53539，没有复用真实项目或渠道密钥。

通过实际构建的 MCP stdio.js 转发到该应用的 HTTP MCP，用 2.2.0 客户端完成连接、列出 46 项工具和 12 项资源、读取资源正文，以及工作区列表、SDK 文字写入和读取。缺少必要参数被拒绝，未带凭据的 HTTP 初始化返回 401。没有借这些调用发起生成。服务端工具仍在宿主运行，这不证明插件进程隔离已实现。

在真实「设置 → 创作偏好 → 查看本地记忆」预览隔离说明文档，最初发现公式有 HTML 但缺少样式，上下标显示异常。现明确加载 KaTeX 样式，并关闭 Markdown 的 KaTeX/Mermaid 公共 CDN 加载，让脚本、样式和字体跟随应用内依赖。原有单美元符号解析规则未改；本次分数与上下标使用明确的双美元块公式。

临时拦截本标签页的 jsDelivr、unpkg、esm.sh 后，完整重载并从实际入口重新打开文档：两个公式、分数元素、KaTeX_Main 字体及 Mermaid 图均存在，浏览器截图可见；两份本机 woff2 字体响应为 HTTP 200，文档 clientWidth/scrollWidth 均为 722。网络事件缓冲有截断，不给出完整请求数、完整流量或全部远端连接结论。拦截规则已清空，网络观察已关闭。没有把这次局部预览当成全面可访问性、所有数学语法或所有图表类型验收。

临时 MCP 仅对本批隔离数据启用，验证后已通过既有 conf 入口关闭；携带此前有效凭据的请求返回 401。一次完整设置保存请求返回 400，未据此声称 HTTP 设置保存成功，关闭结果以实际配置和 401 为准。

第三十九批核对接口定义后更正：上述内联保存请求缺少必填的 base 快照，不是已确认的应用保存缺陷。实际 2.0.11 安装版使用当前 settings 与 base 一并提交，临时启用及恢复关闭均返回 200，后续鉴权返回 401；没有改变设置接口或绕过冲突保护。

新增公式字体随应用分发，保留已安装 KaTeX 0.18.2 的 MIT 版权文本及上游字体的 MIT 版权文本于 `apps/web/public/licenses/katex.txt`，Vite 公共资源进入 Web 与桌面包。初次候选在补充许可前已保留独立副本，不能与最终候选摘要混用。

## 证据与边界

证据根目录 `work/dependencyMaintenance1792461918207`，指针 `work/currentDependencyMaintenanceFixture.json`。原清单/锁文件、调整前及各阶段审计、逐包依赖路径、registryLatest.json、lockDependencyDifference.json、类型和构建日志均保留。运行证据包括 mcpStdioHttpResult.json、mcpCompatibilityGuards.json、markdownBeforeStyle.png、markdownLocalResources.png/.json。

完整桌面和 NSIS 最终打包退出 0，候选 2.0.11 / 2gju0obkclvk5；安装器 69590314 字节，SHA-256 344e12c8ec29debdcf8daf95585808ba88885d1edca1055d216cb7adba8ce0e4。最终副本在 `candidate211/artifacts`，更新包 72595691 字节；归档清单包含 `zeromu/Resources/app/views/mainview/licenses/katex.txt`。初次候选 2.0.11 / ui1fem4f4csg 只作为补许可证前的历史证据保留，不用于当前交付。

最终冻结安装检查退出 0，锁文件摘要在检查前后均为 474e04643071c40f553d92ae4e71566fdd1a21f1235e29195bdc77e6f518bb0b；随后审计仍为空对象、退出 0。主 data/settings.json 摘要保持 65bb7d1f460553d78bba7de21ff633dace367b001a74c339d0e5c4901205a84a。实际安装仍为 2.0.10，本批不将其结果计为 2.0.11 已实装；新候选未签名、未公开发布。

未新增依赖种类、测试文件、框架或临时检查脚本。真实生成请求仍累计六次、估计占用 0.445 美元，人民币 10 元总上限保持，实际账单未知。插件的[执行边界和待实现契约](pluginExecutionBoundary.md)、真实视频与完整作品、干净机器、跨设备/系统 DPI、创作者试用及发行资源继续保留原要求。
