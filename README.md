# 零幕 · ZEROMU

<img src="./packages/assets/zeromuLogo.png" alt="零幕 ZEROMU" width="520" />

**从零开始，创造第一幕。**

用于 AI 影像与漫剧创作的个人工作台：在画布中组织角色、场景、分镜与生成结果，通过模型渠道连接第三方 API。

## 本地运行

项目使用 Bun。安装依赖后，在两个终端分别启动后端与前端：

```powershell
bun install
bun run dev:server
```

```powershell
bun run dev:web
```

前端地址：<http://localhost:5173>。首次准备画布节点时执行 `bun run dev:plugins`。

## 品牌素材

- `packages/assets/zeromuIcon.png`：透明图标。
- `packages/assets/zeromuLogo.png`：中英文组合徽标。
- `packages/assets/logo.ico` 与 `logo.iconset/`：桌面平台图标导出。
- 名称：零幕 / ZEROMU。品牌色：墨青 `#12343B`、薄荷绿 `#29D7B0`。

桌面窗口、启动画面与安装器使用零幕品牌。定制版更新需要自己的发布源，避免被上游安装包覆盖。

## 开源基础与许可

本项目基于 [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) 二次开发。原项目的版权与 MIT 许可见 [LICENSE](./LICENSE)，第三方素材与依赖保留各自许可。

为兼容既有项目、插件和本地配置，`@toonflow/*` 包名、文件格式标记、协议与数据目录标识继续沿用。TF-Router 等第三方服务仍以其真实名称显示。

## 目录与版本管理

- `apps/`：网页、后端和桌面应用。
- `packages/`：共享模块、节点、工具与正式徽标。
- `docs/`：开发资料与 [GitHub 上传步骤](./docs/githubSetup.md)。
- [本次检查记录与后续功能建议](./docs/projectReview.md)。
- [品牌说明](./docs/branding/brand.json) 与当前界面预览：

![零幕首页](./docs/branding/homePreview.jpg)

`data/` 中的本地配置、依赖和构建产物不纳入 Git。
