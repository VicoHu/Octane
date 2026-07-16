# 工作区切换迁移至 App Rail 设计

**日期：** 2026-07-17

## 目标

将桌面端工作区的显示、切换与新建入口从 Sidebar 迁移到 68px app-rail，同时保持 Logo 与 Avatar 的现有位置不变。工作区区块与 Home、Search、打开标签页等导航入口通过横向分隔线分组。

## 范围

### 本次包含

- 桌面端在 app-rail 直接列出全部工作区图标。
- 单击工作区图标后调用现有 `selectWorkspace` 完成切换。
- 当前工作区使用左侧 3px 品牌绿竖条与中性抬升底色共同标识。
- 工作区名称通过 Tooltip 与可访问名称提供。
- 新建工作区 `+` 入口迁移到工作区列表末尾、分隔线上方。
- 工作区过多时，仅工作区列表区域纵向滚动；Logo、新建入口、分隔线下导航和 Avatar 固定。
- 桌面 Sidebar 不再显示工作区 Select 与新建入口。
- `<=760px` 时 app-rail 继续隐藏，Sidebar 暂时保留原工作区 Select 与新建入口。
- 在 `TODOS.md` 增加 app-rail 移动端展示方案待办。

### 本次不包含

- Search、打开标签页等预留导航的功能实现。
- 工作区常用排序、折叠或“更多”菜单。
- app-rail 移动端布局设计与实现。
- 工作区 store、持久化逻辑或错误语义调整。
- 主题、字体或全局 token 调整。

## 方案选择

采用“工作区直接列表”。每个工作区在 rail 中拥有独立图标按钮，减少切换步骤，也与用户在视觉对比稿中的选择一致。

未采用方案：

- 当前工作区单入口：节省高度，但每次切换需要先打开菜单。
- 常用工作区加更多：兼顾高度，但需要新增常用项判定与排序规则，超出本次范围。

## 布局与交互

app-rail 从上到下保持以下结构：

1. 现有 Logo，尺寸与顶部位置不变。
2. 可独立滚动的工作区图标列表。
3. 固定的新建工作区图标按钮。
4. shadcn `Separator` 横向分隔线。
5. 现有 Home、Search、打开标签页导航组。
6. 弹性占位区。
7. 现有 Avatar，尺寸与底部位置不变。

工作区按钮沿用 rail 现有 42px 图标按钮尺寸。当前工作区同时使用绿竖条与中性底色，避免只依赖颜色表达状态。每个按钮具备：

- `aria-label="切换到工作区 <名称>"`。
- 当前项 `aria-pressed="true"`。
- 基于现有 shadcn Tooltip 的名称提示。
- 可见键盘焦点环。
- 不引发布局位移的 hover 与 active 反馈。

工作区图标是用户数据，继续显示现有 emoji；Home、Search、打开标签页与新建操作继续使用 Lucide 图标。

## 组件边界

### `AppRail`

新增 `AppRail` 组件，接管当前 `App.tsx` 中的 rail 标记，并负责：

- 渲染 Logo、工作区列表、新建入口、分隔线、导航组与 Avatar。
- 订阅 `useWorkspace` 的 `workspaces` 与 `currentWorkspaceId`。
- 调用现有 `selectWorkspace`。

`App.tsx` 仅挂载 `AppRail`，不复制工作区状态。

### 新建工作区控件

提取轻量的共享新建工作区控件，封装现有触发按钮、名称输入、图标选择和 `createWorkspace` 调用。桌面 `AppRail` 与移动端 Sidebar 分别复用该控件，避免维护两套表单逻辑。

### `Sidebar`

Sidebar 继续负责常驻标签、分类、管理和设置。原工作区 Select 仅作为移动端回退，通过响应式样式在桌面隐藏、在 `<=760px` 显示。`PinnedArea` 保持原位置，并继续订阅 `currentWorkspaceId`，因此工作区切换后的常驻标签和分类数据流不变。

## 数据流与错误处理

工作区按钮点击后直接调用 `useWorkspace.selectWorkspace(workspaceId)`。现有 store 继续负责持久化当前工作区、恢复该工作区上次分类并更新订阅组件。

本次不新增 Toast、重试、乐观状态或错误配置。新建与切换保持当前错误语义，避免扩大行为范围。

## 响应式行为

- `>760px`：显示 app-rail 工作区直接列表；隐藏 Sidebar 工作区 Select 区块。
- `<=760px`：隐藏 app-rail；显示 Sidebar 原工作区 Select 与新建入口。

移动端 app-rail 的最终展示方式留待 `TODOS.md` 中的后续任务处理。

## 测试与验收

实现前先阅读 `docs/standards/testing.md`，按 TDD 编写并运行失败测试，再写最小实现。

自动化测试覆盖：

- app-rail 渲染全部工作区及当前状态。
- 单击非当前工作区调用 `selectWorkspace`。
- 工作区按钮具有可访问名称、Tooltip 与当前状态。
- 新建入口打开表单并调用现有 `createWorkspace`。
- Sidebar 的移动端回退 Select 仍存在。
- 工作区滚动容器、分隔线、Logo 和 Avatar 锚点样式未被破坏。

自动化验证命令：

- `pnpm run typecheck`
- `pnpm run test`

不使用 Playwright。自动化验证完成后，由用户进行真机验证并提供截图；截图确认前只报告自动化结果，不宣称视觉验收完成。

## 成功标准

- 桌面端可直接从 app-rail 查看并切换工作区。
- 新建工作区入口位于工作区列表末尾、分隔线上方。
- 工作区过多时不推动 Logo、导航或 Avatar，列表可独立滚动。
- Logo 与 Avatar 保持现有尺寸和位置。
- 桌面 Sidebar 不重复显示工作区入口。
- 移动端仍能通过 Sidebar Select 切换和新建工作区。
- `TODOS.md` 包含 app-rail 移动端展示待办。
- `pnpm run typecheck` 与 `pnpm run test` 均通过。
