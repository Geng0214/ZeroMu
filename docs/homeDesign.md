---
name: 零幕首页
description: 从创作描述进入画布与 AI 助手的首页视觉实现
colors:
  primary: "#b6dec9"
  background: "#101111"
  surface: "#202120"
  raised: "#292b29"
  text: "#f1f1ec"
  muted: "#aaada6"
  line: "#373a36"
  dot: "#343732"
typography:
  headline:
    fontSize: "clamp(24px,2.3vw,34px)"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-.025em"
  title:
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-.02em"
  body:
    fontSize: "14px"
    lineHeight: 1.8
rounded:
  control: "8px"
  project: "12px"
  panel: "16px"
spacing:
  compact: "8px"
  panel: "18px"
  section: "58px"
components:
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "18px"
    width: "min(800px, 100%)"
  projectCard:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.project}"
    padding: "18px"
  sendButton:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    width: "36px"
    height: "36px"
---

# Design System: 零幕首页

## Overview

**Creative North Star: "深炭灰中的创作起点"**

本文件仅记录 `apps/web/src/pages/home/index.vue` 的参考图驱动首页替换，不代表整个工作区的设计系统。此次方向为 Operate 创作入口：深炭灰点阵、薄荷绿强调色、顶部导航、中央突出的三卡电影轮播、居中输入器，以及下方提示词和项目列表。

**Key Characteristics:**

- 电影画面提供创作入口，输入器承接实际任务。
- 薄荷绿标记操作与选中状态，灰阶承担页面层次。
- 小屏保留单张轮播，并让输入器操作换行。

## Colors

前置 token 对应首页深色 CSS 变量。primary 用于模式选中、操作文字、发送按钮和焦点；background、surface、raised 分别承载页面、输入器与项目卡片、悬停表面。text 与 muted 区分正文和辅助信息，line 与 dot 分别用于分隔和背景点阵。

首页另有浅色覆盖：背景 `#f4f5f0`、表面 `#fff`、抬升表面 `#e7eae3`、正文 `#202820`、辅助文字 `#54604f`、边线 `#ccd2c7`、强调色 `#23644d`、点阵 `#d2d7cc`。切换成功保存 `homeTheme` 后更新页面；失败显示错误提示。

## Typography

首页没有单独声明字体家族，沿用宿主字体。轮播标题使用 headline；区块标题使用 title；输入文字使用 body。导航（13px）、模式按钮（12px）、辅助提示（11px）形成紧凑层次。小屏轮播标题调整为 25px，提示词区标题为 20px。

## Layout

顶部容器最大宽度 1420px，横向内边距 32px，最小高度 68px；内容容器最大宽度 1400px，横向内边距 40px。背景点阵周期 16px，点半径 .75px。

轮播舞台高度 `clamp(250px,24vw,340px)`；卡片宽 53%，左偏移 23.5%。中央卡片原比例，两侧卡片缩放 .88 并横移自身宽度的 ±50%。输入器最大宽度 800px，距轮播下方 34px。提示词与项目默认三列，间距分别为 30px、18px；列表模式为单列。

在 ≤1150px 时，导航换到第二行并横向滚动，项目改为两列，项目区标题与工具栏上下排列。在 ≤640px 时，内容横向内边距为 18px，轮播高 260px 且只显示当前卡；输入器内边距降为 14px，操作换行；提示词和项目均为单列，项目搜索占满一行。

## Elevation & Depth

页面主要依靠灰阶表面、细边线和轮播叠放区分层次。两侧轮播亮度为 .5，中央为 1；图片底部用 `linear-gradient(transparent 20%,rgba(4,12,8,.84))` 保护白色标题。首页自定义样式未设置卡片阴影，输入框覆盖移除了默认阴影。

## Shapes

轮播和输入器为大圆角面板，项目卡片为中圆角，图标按钮为小圆角；发送按钮为圆形。提示词条目使用顶部细线与文字排列，摘要最多展示两行；长项目名和路径使用单行省略。

## Components

- **导航与图标按钮：** 选中导航用底部 2px 强调线；悬停提高文字亮度，图标按钮增加 raised 背景。按钮和链接键盘焦点为 2px 强调色轮廓，偏移 5px。页面提供跳至输入器的焦点入口。
- **轮播：** 箭头和圆点手动切换，未设置自动播放；非当前卡片 `aria-hidden` 且其操作退出 Tab 顺序。变换和亮度过渡为 .45s ease-out；减少动态效果偏好下取消过渡，页面滚动改为即时。
- **创作输入器：** 聚焦时边线变为强调色；自由、生图、视频、音乐模式改变描述提示与助手消息方向。它们通过已有 AI 助手进入工作区，不能据此宣称存在独立生成引擎。创建或打开期间禁用相关输入与操作；无目录时发送按钮先选择目录，有描述或附件但无模型时引导配置文本模型。
- **提示词：** 默认三条，可展开至六条；应用模板将填充描述并聚焦对应模式，覆盖不同的已有草稿前确认。
- **项目：** 支持名称或路径搜索、最近打开时间排序、网格与列表切换，以及新建、导入、重命名、从列表移除。移除列表项不删除文件；空列表和无搜索结果有不同文案。
- **设置入口：** 首页提供模型渠道、外观与关于入口；GitHub 项目、上游教程和上游仓库链接位于关于面板。素材沿用现有资源库弹窗。

验证记录：本次文档核对了首页源码、关于面板链接及三份截图文件存在性。已有独立 reviewer 对 `build/homeReview/desktop.jpg`、`mobile.jpg`、`userWindow.jpg` 的三种宽度主要入口给出 `ship`；完整下方列表及弹窗不在其截图审查范围内。本次文档工作未另行执行浏览器、交互或构建验证。

## Do's and Don'ts

- **Do** 延续参考图确认的深炭灰、薄荷绿、突出中央轮播与居中输入器。
- **Do** 保留小屏单卡、操作换行、明确焦点及减少动态效果支持。
- **Don't** 将生图、视频或音乐模式描述成已经实现的独立生成引擎。
- **Don't** 将三张入口截图的审查结论扩大为完整页面和弹窗均已通过验证。

## 完成记录： 首页外观切换动效（2026-10-07）

所有共用顶部导航的页面通过 `appHeader.vue` 调用 `themeTransition.ts`：圆形揭示持续 640ms，使用 `cubic-bezier(0.4, 0, 0.2, 1)`。鼠标从点击位置扩散，键盘触发从按钮中心扩散；`homeTheme` 保存成功后页面和设置窗口同步换色，切换期间禁用按钮并防止连点。浏览器不支持 View Transition API 或快照失败时使用 280ms 淡入，偏好减少动态效果时使用 200ms 短淡入。原页面配色与布局保持。

本次验证：`vue-tsc` 与 `vite build` 通过；1280×720 鼠标点击圆心为 (1230, 32)，Enter 触发圆心为 (1230, 31.5)；390×844 圆心为 (354, 26)，无横向溢出。减少动态模拟验证了直接切换与 `animation: none`，验证后已清除模拟并恢复原视口及首页深色。完成态截图为 `.impeccable/review/homeMotionDesktop.png` 与 `.impeccable/review/homeMotionMobile.png`。

## 2026-10-08 浏览器视口适配

- 公共导航在 901px 以上保持单行，900px 及以下分两行；中间宽度收紧导航间距，手机横向滚动保留全部入口。
- 首页轮播宽度随内容区变化，760px 及以下展示单张；卡片文字参与高度计算，避免短屏或文字换行时被裁切。
- 移除轮播描述的固定字符宽度，手机端箭头移到卡片下方，保留 44px 点击区域。
- 轮播和输入区保持连续排布，页脚在剩余空间底部；空间不足时正文滚动，不隐藏生成入口或强行压缩文案。
- 已在浏览器中检查 1920×1080、1280×720、1024×576、768×600、390×844、320×568、640×360，未见页面横向溢出；验证了轮播切换、创作跳转、短屏输入和模型面板。使用 Chromium 内置浏览器验证，未覆盖其他浏览器引擎实机。
