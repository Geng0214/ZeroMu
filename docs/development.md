# 开发指南

[文档目录](readme.md) · [开发规范](../AGENTS.md) · [贡献指南](../CONTRIBUTING.md)

本项目是 Bun Workspaces 仓库。技术栈为 Vue 3、Vite、Pinia、Vue Flow、Bun、Express、Electrobun、Three.js 与 FFmpeg；版本以 `package.json`、锁文件及构建配置为准。

## 源码启动

```powershell
git clone https://github.com/Geng0214/ZeroMu.git
cd ZeroMu
bun install
bun run dev:plugins
bun run dev
```

Web 默认 `http://localhost:5173`；开发服务代理本机业务 Server。`dev` 不自动构建节点/工具，首次启动或修改插件后单独运行 `dev:plugins`。实际已有目录名称不必改名。

不监听源码的日常运行：

```powershell
bun run --filter '@toonflow/web' build
bun run start:local
```

使用期间保留终端；更新源码后停止、重新构建并启动。两种前端模式不能同时占用 5173 端口。

## 常用命令

在仓库根目录执行；检查、构建和环境准备分别运行。

| 命令 | 用途 |
| --- | --- |
| `bun run typecheck` | 全工作区类型检查 |
| `bun run dev:web` / `dev:server` | 单独启动对应开发服务 |
| `bun run dev:plugins` | 构建插件并同步开发数据目录 |
| `bun run build:nodes` / `build:tools` | 重建对应 `build/` 产物，不同步开发数据 |
| `bun run build` | 构建工具、Web 和 Server 等常规产物 |
| `bun run build:server` | 构建含节点、工具、Web、Server 等的独立服务部署资源 |
| `bun run start:server` | 运行已构建独立服务 |
| `bun run prepare:desktop` | 准备桌面 SDK |
| `bun run dev:desktop` | 启动桌面开发环境 |
| `bun run build:desktop` / `package:desktop` | 构建当前平台桌面资源 / 安装包 |
| `bun run --cwd packages/i18n extract` | 手动抽取中文文案与索引，不自动翻译 |

新增、移动、删除接口文件后，在 `apps/server` 执行 `bun run routes`；不手工维护 `src/router.ts`。路由约定、错误处理、统一文件入口及禁止新增测试文件的要求以 [AGENTS.md](../AGENTS.md) 为准。

## Windows 打包

```powershell
bun install
bun run prepare:desktop
bun run typecheck
bun run package:desktop
```

需要 NSIS 3；非默认位置通过环境变量 `NSIS_PATH` 指向 `makensis.exe`。版本由 `appVersion` 环境变量或 `appVersion.ts` 默认值确定，开发默认值不代表最新验收候选。

产物在 `build/desktop/artifacts/`，安装器为 `zeromu-<版本>-Setup.exe`，并有完整更新包和清单。固定候选时另保留安装器、清单、归档资源及源码摘要；不要混用同版本不同构建。

桌面普通打包不等于发布。最新候选及实际安装版本只在 [progress](progress.md) 维护。Mac ARM/Intel 构建和签名说明保留在 [历史扩展指南](archive/previousDevelopment.md)，使用前核对当前脚本；本机 Windows 结果不证明 Mac 实机可用。

## 目录与数据

| 位置 | 职责 |
| --- | --- |
| `apps/web`、`server`、`desktop` | 用户界面、本机业务、桌面宿主 |
| `apps/updateServer` | 独立更新服务 |
| `packages/nodes`、`tools`、`teams`、`skills` | 节点、工具、团队及运行资料 |
| `packages/file`、`providers`、`nodeScaffold` | 文件原语、供应商与节点共享能力 |
| `docs` | 当前计划、进度、规范、使用说明与历史归档 |
| `data`、`work`、`build` | 本地设置/插件、隔离验收、构建产物；不提交 Git |

开发设置在根 `data/`；Windows 安装数据在安装根 `data/`，与可更新的 `app/` 同级。不得把用户数据写入可被更新替换的资源目录。配置与项目验收使用隔离目录，操作前备份。

## 扩展入口

| 类型 | 说明 |
| --- | --- |
| 节点 | [脚手架](../packages/nodeScaffold/readme.md)、[内置节点](../packages/nodes/) |
| 工具 | [脚手架](../packages/toolScaffold/readme.md)、[内置工具](../packages/tools/)；执行及同步钩子范围见 [架构](architecture.md) |
| 技能/团队 | [技能](../packages/skills/)、[团队脚手架](../packages/teamScaffold/readme.md)、[分镜团队](../packages/teams/storyboardTeam/readme.md) |
| 供应商 | [提供方实现](../packages/providers/src/)；区分协议适配和真实验收 |
| MCP | [本机接入与配置](../packages/mcp/README.md)；界面操作需要相应窗口/页面在线 |
| 多语言 | [维护说明](../packages/i18n/readme.md)、[回归记录](../packages/i18n/regression.md) |

市场服务、协议安装与各子包格式属于各自接口；原完整说明保留在 [历史扩展指南](archive/previousDevelopment.md)。外部市场不作为零幕自有服务，可信安装不等于已建立操作系统沙箱。

当前应用内**没有**插件安装入口：设置里的插件市场面板与本地文件安装入口已移除，安装只保留 `zeromu://install` 协议一条路径——由外部页面发起，桌面端确认类型、文件名与下载地址后调用 `/api/desktop/plugins/install` 写入 `data/` 对应目录。协议链路与 `utils/plugins/install.ts` 的实现、体积限制和同版本覆盖规则不变，见上方历史扩展指南。另有两处已知残留暂不清理：桌面与 Web 之间的安装事件名仍为 `toonflow:install-plugin` 与 `toonflow:plugin-installed`（纯品牌改名，需两端同批修改），`pluginMarketApiKey` 的加解密与脱敏分支保留（历史配置里该字段可能仍是密文信封，移除白名单会让它失去脱敏）。

## GitHub 与发布

日常提交推送到自己的 `origin`；上游 `upstream` 仅用于同步开源基础。提交前查看差异，排除 `data/`、`work/`、`build/`、凭据、私有素材及证书。当前远程为 `Geng0214/ZeroMu`，本次文档整理不自动提交或推送。

普通分支推送不创建 Release。现有 [发布工作流](../.github/workflows/release.yml) 由手动运行或 `v*` 标签触发；[构建工作流](../.github/workflows/debug.yml) 用于产物验证。不要为了保存代码随意推送版本标签。

桌面身份为 `local.zeromu.desktop`，协议为 `zeromu://`，内置更新归档名沿用 `zeromu`。构建基线地址由 `electrobun.config.ts` 的仓库配置决定，客户端更新源另按已保存设置处理；不把上游服务当作定制版发行源。

正式发布前先完成 [验收门槛](acceptance.md)，再使用已核对的版本、签名和自有托管资源。独立服务的配置与上传方式见 [更新服务说明](../apps/updateServer/readme.md)；完整旧命令与 Mac 凭据准备只作 [历史参考](archive/previousDevelopment.md)，其中旧品牌、路径和源地址不能直接当作当前默认值。
