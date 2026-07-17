# 全局主按钮炭灰化设计

## 目标

将当前所有绿底黑字的主操作按钮统一改为 A 方案：炭灰实色底、浅色文字，带图标时以品牌绿点亮图标。降低大面积高饱和绿色造成的视觉重量，同时维持清晰的主次操作层级。

本次只调整视觉语义，不改变任何按钮文案、尺寸、点击行为、加载状态或业务流程。

## 设计范围

### 纳入

- shadcn `Button` 的 `default` variant，包括未显式声明 variant 的按钮。
- 由 `Button default` 组合出的确认操作，例如 `AlertDialogAction`。
- Home、Popup、Sidepanel、设置和备份流程中的“添加、确定、保存、解锁、导出”等主操作。

### 保留现状

- App Rail 当前工作区和当前页面的绿色选中态。
- Checkbox、Switch、Badge、AvatarBadge 等状态控件。
- Tabs/导航选中指示线、书签打开状态、品牌装饰和成功反馈。
- `outline`、`secondary`、`ghost`、`destructive`、`link` 等非默认 Button variant。

这些元素表达当前位置、状态或品牌，而不是主操作，不应随按钮底色一起改为炭灰。

## 视觉规范

### 默认状态

- 背景：Logo 炭灰族 `#202829`。
- 文字：浅色 `#F6F8F7`。
- 图标：品牌浅绿 `#55EFC4`；无图标按钮保持纯文字。
- 圆角、字号、高度和内边距沿用现有 `Button` 尺寸体系。
- 保持扁平风格，仅使用现有轻量边界与交互反馈，不增加装饰性渐变或重阴影。

### 交互状态

- Hover：背景提亮为 `#2B3634`，不缩放、不改变尺寸。
- Active：背景压深，并保留现有 1px 下压反馈。
- Focus-visible：继续使用品牌绿 focus ring，确保键盘焦点清晰。
- Disabled：沿用现有 `opacity-50` 与不可点击行为。
- 动效：沿用 150–200ms 颜色过渡，并尊重 `prefers-reduced-motion`。

## Token 与组件策略

品牌绿 `--primary` 继续作为全局 accent，不重定义为炭灰。新增主操作语义 token，并映射到 Tailwind theme：

- `--action-primary`
- `--action-primary-hover`
- `--action-primary-active`
- `--action-primary-foreground`
- `--action-primary-icon`

`src/components/ui/button.tsx` 的 `default` variant 使用这些 token；图标通过现有 Button 内部 SVG 选择器统一着色。组件调用方不逐处追加颜色 class，也不新增页面级 Button 样式。

`DESIGN.md` 与设计补充文档同步更新：品牌绿从“主按钮底色”调整为“主按钮图标与 focus 信号”，炭灰主操作 token 成为按钮底色真源。

## 验收标准

- Home 顶部“添加书签”呈现 A 方案：炭灰底、浅色文字、绿色 Plus 图标。
- 所有 `Button default` 主操作同步呈现相同风格；文字按钮和图标按钮层级一致。
- Rail、Checkbox、Switch、Badge、Tabs 指示等品牌/状态绿色保持不变。
- Hover、Active、Focus-visible、Disabled 状态清晰且无布局位移。
- 浅色背景上的按钮文字和图标满足 WCAG 对比要求。
- 相关组件测试、`pnpm run typecheck` 与 `pnpm run test` 通过，并以 Home 页面截图复核实际效果。
