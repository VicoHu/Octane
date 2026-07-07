---
version: alpha
name: Octane
description: Octane 浏览器扩展设计系统。品牌 DNA：克制双色 · 几何粗线 · 速度母题。基座为 Semi Design，本文件是项目语义 token 的单一真源；Semi --semi-* 应派生自此。
colors:
  # 品牌绿族（accent，不是底色）
  primary: "#00B894"            # Logo 速度线/书签飘带原色；accent：图标/描边/选中/按钮底
  primary-hover: "#00A383"      # hover
  primary-active: "#008F72"     # press
  primary-on: "#2D3436"         # 绿底之上的前景（文字/图标，炭灰，on 绿 ≈4.9:1 达 AA）
  primary-text: "#007D63"       # 浅底上的绿字/链接（on 白 ≈5.6:1）
  primary-dark: "#00755C"       # 退路：需白字的深绿实色（白字 ≈4.7:1）
  primary-light: "rgba(0,184,148,.1)"   # 浅底强调
  primary-focus: "rgba(0,184,148,.35)"  # focus ring
  # 中性 / 反馈
  neutral: "#2D3436"            # Logo 闭合圆环炭灰，深色锚定色
  text-primary: "#0F172A"       # 主文本
  text-secondary: "#475569"     # 次文本
  muted: "#64748B"              # 仅元信息/占位，贴 AA 下限，不得用于长正文
  border-color: "#E2E8F0"       # 边框/分隔
  content-bg: "#F8FAFC"         # 内容区底
  card-bg: "#FFFFFF"            # 卡片底
  danger: "#EF4444"             # 危险/删除，保持红
  # 深色侧栏（属 Logo 炭灰族，禁用 Semi 冷黑 #232429）
  sidebar-bg: "#202829"
  sidebar-surface: "#2D3436"
  sidebar-border: "rgba(255,255,255,.08)"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
  title-sm:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
  body-lg:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.7
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif'
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.5
rounded:
  sm: 8px      # 按钮/输入/标签
  md: 12px     # 卡片/浮层/图标按钮容器
  lg: 16px     # Modal
  full: 9999px # 圆形图标按钮
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  "2xl": 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-on}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
  button-secondary:
    textColor: "{colors.text-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
  card:
    backgroundColor: "{colors.card-bg}"
    rounded: "{rounded.md}"
  input-field:
    backgroundColor: "{colors.card-bg}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
  modal:
    backgroundColor: "{colors.card-bg}"
    rounded: "{rounded.lg}"
---

# Design System — Octane

> 本文件是 Octane 设计系统的**单一真源**（机器可读 token + 理由），遵循 [Google DESIGN.md alpha spec](https://github.com/google-labs-code/design.md)。
> 完整理由、现状审视、设计债务清单、交付检查清单见 `docs/design-guidelines.md`；Semi DSM token 机制见 `docs/semi-design-spec.md`。
> 做任何视觉/UI 决策前必读本文件。样式一律引用 token，禁止裸写；改主题只动 token 不动组件。

## Brand & Style

品牌 DNA：**克制双色 · 几何粗线 · 速度母题**。标尺是 Logo（`public/icons/icon-128.png`）：

- 闭合圆环 = 炭灰 `neutral #2D3436`，语义「安全 / 收纳」，作深色锚定色（侧栏底属此族）。
- 速度线 / 书签飘带 = 品牌绿 `primary #00B894`，语义「速度 / 高效 / 核心=书签」，作 accent 与关键反馈。
- 高光 = 浅绿，仅点缀。

整体气质是**工具型、扁平、几何**，反对装饰性拟真与多层阴影。骨架范式：深色侧栏（锚炭灰）+ 浅色内容区。**红线**：违背「克制双色 / 几何 / 扁平」即为不统一。

## Colors

品牌绿是 accent，**不是底色**。核心纪律是「绿色预算」——每个功能区最多一个绿色焦点（一个主操作 / 一个选中指示），避免层级坍塌。

- **primary `#00B894`**：accent，用于图标/描边/选中指示/主按钮底。
- **primary-on `#2D3436`**：绿底之上的前景（文字/图标，炭灰），on 绿 ≈4.9:1 达 AA，是绿底配色的首选。
- **primary-text `#007D63`**：浅底上的绿字/链接，on 白 ≈5.6:1。
- **primary-dark `#00755C`**：唯一退路，仅用于需白字的深绿实色场景（白字 ≈4.7:1）。
- **neutral `#2D3436`**：Logo 炭灰锚定色，侧栏抬升面。
- **text-primary / text-secondary**：正文 / 次文本，浅底对比 ≥4.5:1。
- **muted `#64748B`**：**仅**元信息/占位，贴 AA 下限，**不得用于长正文**。
- **danger `#EF4444`**：危险/删除，保持红，勿与品牌绿混。
- **sidebar-bg / sidebar-surface**：深色侧栏属 Logo 炭灰族，**禁用** Semi 通用冷黑 `#232429`（偏蓝、与绿相冲）。

## Typography

字号阶已清理脏半档（移除 13px），拉开可辨层级。整页 NewTab 的 base 14px 偏小，**主阅读文本用 16px**，14px 仅留给工具型/侧栏密集区。

- **display 32px**：品牌/营销大标题。
- **title 24px**：页面 H1。
- **title-sm 20px**：区块标题。
- **body-lg 16px**：内容区主阅读文本（书签名等），lineHeight 1.7。
- **body 14px**：正文基准。
- **caption 12px**：徽章/元信息。

字体栈含显式 CJK 回退（PingFang SC / Microsoft YaHei / Noto Sans SC），保证 Windows 中文渲染可控。品牌瞬间（"Octane" 文字 / H1）可选几何无衬线（Lexend/Sora），仅限拉丁文。

## Layout

深色侧栏（`--sidebar-width 260px`）+ 浅色内容区（`max-width 1400px` 居中）。8 基准节奏（xs4 / sm8 / md12 / lg16 / xl24 / 2xl32），微调 4/12。面向桌面宽屏，保证 1024/1440 无横滚。品牌色的 Semi token 覆盖须同时覆盖 `html body` 与 `html body .semi-always-dark`，否则弹层拼色。

## Elevation & Depth

**扁平优先**（呼应 Logo DNA）。卡片默认极轻影、hover 略升，**不得加重**；Semi 浮层统一 `shadow-elevated`。不引入多层拟真阴影。层级靠边框、色对比、留白传达，不靠重阴影。

## Shapes

圆角拉开可辨层级（旧 6/8 两档差 2px 难辨，改为 8/12/16）：

- **sm 8px**：按钮/输入/标签。
- **md 12px**：卡片/浮层/图标按钮容器。
- **lg 16px**：Modal。
- **full**：圆形图标按钮。

## Components

- **主按钮**：`primary` 底 + `primary-on` 炭灰字（保真 + 达 AA），每区唯一；hover/active 走 `primary-hover` / `primary-active`。
- **次按钮**：透明 ghost，`text-secondary`，hover 才显品牌色。
- **卡片**：`card-bg` 白底，`rounded md`；favicon 回退用 `primary-dark` → 浅绿渐变（白字可读，唯一非扁平例外）。
- **输入**：`rounded sm`，focus 用 `primary-focus` ring（白底可见）。
- **导航/列表选中**：左 3px `primary` 竖条 + 文字提亮 + 极轻中性底；hover 用中性 fill（**不用绿**）。（DESIGN.md schema 无 border-left 属性，落地时按此规则实现。）
- **Modal**：`rounded lg`，主按钮同主按钮规范。
- **图标**：功能图标统一 `@douyinfe/semi-icons`（几何、24×24）；品牌区用单色线性图标，不用彩色 emoji。

## Do's and Don'ts

- ✅ 绿按钮用 `primary` 底 + `primary-on` 炭灰字（保真 + 达 AA）。
- ❌ 为达标把绿压暗成 `primary-dark` 当默认（按钮发暗、背离 Logo）。
- ❌ `primary #00B894` 配白字（≈2.58:1 不及格）。
- ✅ 浅底绿字用 `primary-text`。
- ❌ 用 `primary` 做浅底文字。
- ✅ 每区一个绿色焦点。
- ❌ 侧栏按钮全刷绿（层级坍塌）。
- ✅ 选中态用 3px 绿竖条 + 字重（颜色非唯一信息）。
- ❌ 只靠 20% 绿底 tint 表示选中。
- ✅ 侧栏底锚 Logo 炭灰族。
- ❌ 沿用 Semi 冷黑 `#232429`。
- ✅ 圆角 8/12/16 拉开层级、字号 12/14/16/20/24/32。
- ❌ 保留 13px 脏半档、6/8 难辨圆角。
- ✅ 样式一律引用 token、改主题只动 token。
- ❌ 双套 token 各自为政、裸写色值/尺寸。
