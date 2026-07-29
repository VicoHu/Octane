---
version: alpha
name: Octane
description: Octane 浏览器扩展设计系统。品牌 DNA：克制双色 · 几何粗线 · 速度母题。基座为 shadcn/ui（Base UI），本文件是项目语义 token 的单一真源；shadcn CSS 变量（--background/--primary 等）与残留 Semi 的 --semi-* 均派生自此。
colors:
  # 品牌绿族（accent，不是底色）
  primary: "#00B894" # Logo 速度线/书签飘带原色；accent：图标/描边/选中/状态
  primary-hover: "#00A383" # hover
  primary-active: "#008F72" # press
  primary-on: "#2D3436" # 绿底之上的前景（文字/图标，炭灰，on 绿 ≈4.9:1 达 AA）
  primary-text: "#007D63" # 浅底上的绿字/链接（on 白 ≈5.6:1）
  primary-dark: "#00755C" # 退路：需白字的深绿实色（白字 ≈4.7:1）
  primary-light: "rgba(0,184,148,.1)" # 浅底强调
  primary-focus: "rgba(0,184,148,.35)" # focus ring
  # 主操作（A 方案：炭灰实色，品牌绿仅作图标与焦点信号）
  action-primary: "#202829"
  action-primary-hover: "#2B3634"
  action-primary-active: "#17201E"
  action-primary-foreground: "#F6F8F7"
  action-primary-icon: "#55EFC4"
  # 中性 / 反馈
  neutral: "#2D3436" # Logo 闭合圆环炭灰，深色锚定色
  text-primary: "#0F172A" # 主文本
  text-secondary: "#475569" # 次文本
  muted: "#64748B" # 仅元信息/占位，贴 AA 下限，不得用于长正文
  border-color: "#E2E8F0" # 边框/分隔
  content-bg: "#F8FAFC" # 内容区底
  card-bg: "#FFFFFF" # 卡片底
  danger: "#EF4444" # 危险/删除，保持红
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
  sm: 8px # 按钮/输入/标签
  md: 12px # 卡片/浮层/图标按钮容器
  lg: 16px # Modal
  full: 9999px # 圆形图标按钮
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  "2xl": 32px
# 控件高度阶（shadcn default 档；声明性参考，尺寸硬编码于 src/components/ui/* cva，未做成 CSS 变量）
control-height:
  sm: 36px # h-9：button sm / select sm
  md: 40px # h-10：button default / input / select trigger / tabs list（标准控件高）
  lg: 44px # h-11：button lg
  switch: "24x44px" # h-6 w-11 default
components:
  button-primary:
    backgroundColor: "{colors.action-primary}"
    textColor: "{colors.action-primary-foreground}"
    iconColor: "{colors.action-primary-icon}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
  button-primary-hover:
    backgroundColor: "{colors.action-primary-hover}"
  button-primary-active:
    backgroundColor: "{colors.action-primary-active}"
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
  # 拖拽浮层阴影(T10):扁平优先基座上,Semi 浮层统一 elevated;navy alpha 而非 black,呼应绿族冷调
  shadow-soft: "0 4px 12px rgba(15,23,42,.08)"
  shadow-elevated: "0 8px 24px rgba(15,23,42,.12)"
---

# Design System — Octane

> 本文件是 Octane 设计系统的**单一真源**（机器可读 token + 理由），遵循 [Google DESIGN.md alpha spec](https://github.com/google-labs-code/design.md)。
> 完整理由、现状审视、设计债务清单、交付检查清单见 `docs/design-guidelines.md`；Semi DSM token 机制（仅残留 Semi Form/Tree）见 `docs/semi-design-spec.md`；Semi→shadcn 迁移见 `docs/superpowers/specs/2026-07-15-semi-to-shadcn-design.md`。
> 做任何视觉/UI 决策前必读本文件。样式一律引用 token，禁止裸写；改主题只动 token 不动组件。

## Brand & Style

品牌 DNA：**克制双色 · 几何粗线 · 速度母题**。标尺是 Logo（`public/icons/icon-128.png`）：

- 闭合圆环 = 炭灰 `neutral #2D3436`，语义「安全 / 收纳」，作深色锚定色（侧栏底属此族）。
- 速度线 / 书签飘带 = 品牌绿 `primary #00B894`，语义「速度 / 高效 / 核心=书签」，作 accent 与关键反馈。
- 高光 = 浅绿，仅点缀。

整体气质是**工具型、扁平、几何**，反对装饰性拟真与多层阴影。骨架范式：深色侧栏（锚炭灰）+ 浅色内容区。**红线**：违背「克制双色 / 几何 / 扁平」即为不统一。

## Colors

品牌绿是 accent，**不是大面积底色**。核心纪律是「绿色预算」——每个功能区最多一个绿色焦点（主操作图标 / 一个选中指示），避免层级坍塌。

- **primary `#00B894`**：accent，用于图标/描边/选中指示/状态控件。
- **primary-on `#2D3436`**：绿底之上的前景（文字/图标，炭灰），on 绿 ≈4.9:1 达 AA，是绿底配色的首选。
- **primary-text `#007D63`**：浅底上的绿字/链接，on 白 ≈5.6:1。
- **primary-dark `#00755C`**：唯一退路，仅用于需白字的深绿实色场景（白字 ≈4.7:1）。
- **action-primary `#202829`**：默认主操作底色；hover/active 走 `action-primary-hover` / `action-primary-active`。
- **action-primary-foreground `#F6F8F7`**：主操作文字；图标使用 `action-primary-icon #55EFC4`。
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

68px 深色品牌 Rail + 240px 浅色导航侧栏 + 浅色内容区（`max-width 1720px` 居中）。书签网格按视口断点使用 1/1/2/3/4/5 列：xs `<576px`、sm `≥576px`、md `≥768px`、lg `≥992px`、xl `≥1200px`、xxl `≥1600px`。8 基准节奏（xs4 / sm8 / md12 / lg16 / xl24 / 2xl32），微调 4/12。面向桌面宽屏，保证 1024/1440 无横滚。品牌色经 tailwind `@theme` + shadcn 变量派生（`src/styles/tailwind-theme.css` 的 `:root`/`.dark`）；残留 Semi 组件的品牌色仍由 `semi-theme-override.css` 同时覆盖 `html body` 与 `html body .semi-always-dark`，否则弹层拼色。

## Elevation & Depth

**扁平优先**（呼应 Logo DNA）。卡片默认极轻影、hover 略升，**不得加重**；Semi 浮层统一 `shadow-elevated`。不引入多层拟真阴影。层级靠边框、色对比、留白传达，不靠重阴影。

## Shapes

圆角拉开可辨层级（旧 6/8 两档差 2px 难辨，改为 8/12/16）：

- **sm 8px**：按钮/输入/标签。
- **md 12px**：卡片/浮层/图标按钮容器。
- **lg 16px**：Modal。
- **full**：圆形图标按钮。

## Components

- **主按钮**：`action-primary` 炭灰底 + `action-primary-foreground` 浅色字；有图标时用 `action-primary-icon` 点亮，每区唯一。
- **次按钮**：透明 ghost，`text-secondary`，hover 才显品牌色。
- **卡片**：`card-bg` 白底，`rounded md`；favicon 回退用 `primary-dark` → 浅绿渐变（白字可读，唯一非扁平例外）。
- **输入**：`rounded sm`，focus 用 `primary-focus` ring（白底可见）。
- **导航/列表选中**：左 3px `primary` 竖条 + 文字提亮 + 极轻中性底；hover 用中性 fill（**不用绿**）。（DESIGN.md schema 无 border-left 属性，落地时按此规则实现。）
- **Modal**：`rounded lg`，主按钮同主按钮规范。
- **图标**：功能图标统一 `lucide-react`（几何、24×24）；品牌区用单色线性图标，不用彩色 emoji。残留 Semi Form/Tree 内的 `@douyinfe/semi-icons` 待其迁移时再换。
- **控件尺寸（shadcn default 档）**：标准控件高 `40px`(h-10) —— Button default / Input / Select trigger / Tabs list；小档 `36px`(h-9，Button sm / Select sm)；大档 `44px`(h-11，Button lg)；Switch default `24×44px`(h-6 w-11)。控件字号仍 `body 14px`（xs/sm 档 `12px`），与正文基准一致。2026-07-16 由 base-nova 紧凑档(32px) 上调而来，缓解迁移后拥挤小气；尺寸写在 `src/components/ui/*` 的 cva 里、未做成 CSS 变量，改档位只动封装层即全局生效。Checkbox/Tooltip/Avatar/Overlay 维持各自标准尺寸。

## Do's and Don'ts

- ✅ 主按钮用 `action-primary` 炭灰底 + 浅色字，图标用 `action-primary-icon`。
- ❌ 逐页覆写主按钮颜色，或把 `primary` 恢复为默认主按钮大面积底色。
- ❌ `primary #00B894` 配白字（≈2.58:1 不及格）。
- ✅ 浅底绿字用 `primary-text`。
- ❌ 用 `primary` 做浅底文字。
- ✅ 每区一个主操作，绿色仅作图标、focus 或选中信号。
- ❌ 侧栏按钮全刷绿（层级坍塌）。
- ✅ 选中态用 3px 绿竖条 + 字重（颜色非唯一信息）。
- ❌ 只靠 20% 绿底 tint 表示选中。
- ✅ 侧栏底锚 Logo 炭灰族。
- ❌ 沿用 Semi 冷黑 `#232429`。
- ✅ 圆角 8/12/16 拉开层级、字号 12/14/16/20/24/32。
- ❌ 保留 13px 脏半档、6/8 难辨圆角。
- ✅ 样式一律引用 token、改主题只动 token。
- ❌ 双套 token 各自为政、裸写色值/尺寸。
