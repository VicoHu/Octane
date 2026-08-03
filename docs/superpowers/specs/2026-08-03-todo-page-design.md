# 待办事项页面设计

**日期：** 2026-08-03  
**状态：** 已确认  
**来源：** [GitHub Issue #72](https://github.com/VicoHu/Octane/issues/72)  
**研究：** [待办事项页成熟产品模式研究](../../research/issue-72-todo-product-patterns.md)  
**确认方式：** 2026-08-03 产品 grilling 会话逐项确认

## 1. 目标

在 App Rail 的主页入口下增加“待办事项”主页面。待办页复用当前 Workspace 作为所有权边界，同时允许用户切换到所有工作区汇总视图。

页面采用左侧导航、中部任务列表、右侧任务详情的三栏结构。首版提供个人、本地优先的任务管理能力，不扩展为协作、实时同步或通用项目管理系统。

## 2. 设计原则

- Task、Task List 和 Task Tag 始终归属于一个 Workspace。
- 所有工作区视图只扩大查询范围，不产生无 Workspace 归属的数据。
- Inbox、今天、未来 7 天、Trash 都是查询视图，不是 Task List。
- 归档、完成、删除是不同状态，不互相替代。
- 详情栏承担完整编辑，中栏保持高密度和可扫描。
- 首版优先保证清晰的数据边界、可恢复操作和离线可靠性，不预埋协作与同步复杂度。

领域术语以仓库根目录 `CONTEXT.md` 为准。

## 3. 产品范围

### 3.1 首版包含

- App Rail 中与主页平级的待办事项入口。
- 当前 Workspace 与所有工作区两种范围模式。
- 今天、未来 7 天、Inbox、Task List、Task Tag、已归档清单和 Trash。
- Task List 创建、重命名、着色、排序、归档、恢复和受约束的永久删除。
- Task Tag 创建、重命名、着色、排序、删除和单标签过滤。
- Task 创建、查看、编辑、完成、取消完成、移动、软删除、恢复和永久删除。
- 轻量 Checklist Item。
- 四状态 Priority、单一 Due Date、文本搜索、筛选、排序和受约束的手动拖拽。
- 桌面三栏、窄桌面双栏和移动端单面板响应式布局。
- IndexedDB 本地持久化、手动全量备份和云备份。

### 3.2 首版不包含

- 多设备实时同步、离线操作队列、冲突合并、协作、负责人或权限。
- Task 数据加密或端到端加密承诺。
- 待办数据的分享包导入导出。
- 计划日期、具体时间、提醒、重复规则。
- 完整 Subtask、多层任务树、嵌套 Task List、Section 或依赖关系。
- 富文本、Markdown、附件、评论、操作日志或自定义字段。
- 多 Task Tag AND/OR、自定义过滤表达式或保存的智能清单。
- Bookmark 与 Task 的直接关联，或 Bookmark Tag 与 Task Tag 的共享词汇表。
- URL 路由、深链接、浏览器前进后退历史或通用 App Rail 搜索。
- Trash 自动过期、Completed 自动清理或 Canceled 状态。

## 4. 领域模型

### 4.1 Workspace 所有权

- 每个 Task 必须且只能属于一个 Workspace。
- 每个 Task List 和 Task Tag 必须且只能属于一个 Workspace。
- 所有工作区视图不会改变实体所有权。
- 所有工作区模式新增 Task 时，Workspace 字段必须可见，默认预选 App Rail 当前 Workspace，并允许修改。
- 所有工作区模式新增 Task List 或 Task Tag 时同样必须显示 Workspace 字段，默认预选 App Rail 当前 Workspace，并在提交前按目标 Workspace 校验名称唯一性。
- 跨 Workspace 移动必须是显式操作。

### 4.2 Task 与 Task List

- Task 最多属于一个 Task List。
- `listId = null` 表示 Task 位于 Inbox。
- Inbox 是未归入 Task List 的 Task 查询视图，不创建系统 Task List 实体。
- Task List 是单层容器，不支持嵌套和 Section。

Task List 具有：

- 必填名称。
- Workspace 归属。
- 固定调色板颜色。
- 手动顺序。
- active / archived 状态。
- 创建、更新和归档时间。

同一 Workspace 内，Task List 名称去除首尾空白后必须大小写不敏感唯一。不同 Workspace 可以存在同名 Task List。

### 4.3 Task Tag

Task Tag 与现有 Bookmark Tag 是不同领域对象：

- 两者同名、同色也不共享身份。
- Task Tag 是 Workspace 级独立实体，不是 Task 内嵌字符串。
- 一个 Task 可关联多个 Task Tag，一个 Task Tag 可关联多个 Task。
- 同一 Workspace 内名称去除首尾空白后必须大小写不敏感唯一。
- 不同 Workspace 可以存在同名 Task Tag。

Task Tag 具有名称、规范化名称、颜色、顺序和时间字段。颜色可重复，不作为身份。

限制：

- Task Tag 名称最多 32 个字符。
- 每个 Task 最多关联 20 个 Task Tag。
- 空 Task Tag 可保留并继续显示。

### 4.4 Checklist Item

Checklist Item 是 Task 内部的轻量、有序步骤：

- 只具有文本、完成状态、顺序和时间字段。
- 不能脱离父 Task 存在。
- 不拥有 Workspace、Task List、Task Tag、Due Date、Priority、描述或提醒。
- 不独立进入任何中栏列表或聚合视图。
- 不支持多层嵌套。

Checklist Item 与父 Task 的完成状态独立：

- 勾选最后一个 Checklist Item 不会自动完成父 Task。
- 完成父 Task不会改写 Checklist Item。
- 父 Task 仍有未完成 Checklist Item 时，完成前提示数量并要求确认。
- 取消完成父 Task 后，Checklist Item 保持原状态。

### 4.5 Priority

Priority 是四个可选择状态：

- 高优先级。
- 中优先级。
- 低优先级。
- 无优先级。

默认是无优先级。用户可以从其他等级改回无优先级。默认排序顺序为高、中、低、无。无优先级不显示彩色等级信号，但仍可被筛选。

首版不提供 P1-P4 文案、紧急/重要矩阵或自动优先级计算。

### 4.6 Due Date

- Task 只有一个可选 Due Date。
- Due Date 是日历日期，不包含具体时间。
- 它表示应在何日前完成，不是计划开始日期或提醒时间。
- 持久化格式为本地日历字符串 `YYYY-MM-DD`，不使用 UTC 午夜时间戳。

日期视图：

- 今天：Due Date 为今天或已逾期的 active Task。
- 未来 7 天：从今天到未来第六天到期的 active Task，不包含逾期项。
- completed Task、Deleted Task 和归档清单中的 Task 不进入活跃日期视图。

### 4.7 Task 状态

首版 Task 只有 active 与 completed 两种业务状态：

- 完成时记录完成时间。
- 取消完成后恢复 active 并清除当前完成时间。
- 完成不改变 Workspace、Task List、Task Tag、Checklist Item、Priority 或 Due Date。
- 不提供 Canceled 状态。

Deleted Task 是单独的可恢复删除状态：

- 删除后进入 Trash 并记录删除时间。
- Deleted Task 退出所有普通视图、默认搜索和活跃计数。
- Trash 中可恢复或永久删除。
- 首版不自动过期。

Task 不拥有独立归档状态；它是否归档完全由所属 Task List 的 archived 状态决定。

## 5. 信息架构与导航

### 5.1 App Rail

- 在主页按钮下增加 Lucide 待办图标按钮。
- 文案、Tooltip 和可访问名称统一为“待办事项”。
- 主页与待办事项互斥激活，沿用绿竖条、字重和中性底色。
- 切换页面保留当前 Workspace。
- 同一页面会话内返回待办页时，保留范围、左栏视图和选中 Task。
- 刷新或新开 New Tab 时默认进入主页。
- 首版不引入 URL 路由和深链接。

`<=760px` 时 App Rail 继续隐藏，移动导航 Sheet 同时提供主页与待办事项入口。

### 5.2 范围模式

左栏使用清晰的单选分段控件：

- 当前工作区。
- 所有工作区。

行为：

- 首次进入或刷新待办页时默认当前工作区。
- 页面存续期间记住选择，不跨浏览器重启持久化。
- 所有工作区模式下，每个 Task 必须显示 Workspace 归属。
- 点击 App Rail 的 Workspace 图标时，留在待办页，但退出所有工作区模式并进入所选 Workspace。
- 从当前工作区切到所有工作区时，系统聚合视图保持同类视图并扩大范围。
- 当前选中具体 Task List 或 Task Tag 时切到所有工作区，回到今天视图。
- 所有工作区模式的 Task List 与 Task Tag 按 Workspace 分组，不合并同名项。

### 5.3 左栏入口

固定入口：

- 今天。
- 未来 7 天。
- Inbox。
- Task List。
- 已归档的清单。
- Task Tag。
- Trash。

不提供多标签布尔组合、自定义过滤语言或保存的智能清单。

## 6. 创建与编辑

### 6.1 快速添加

输入标题并按 Enter 创建；空标题不能提交。

上下文继承：

- Task List 视图：继承该 Task List 和 Workspace。
- Inbox：`listId = null`；单 Workspace 模式使用当前 Workspace。
- Task Tag 视图：附加该 Task Tag，并使用标签所属 Workspace。
- 今天：Due Date 默认今天。
- 未来 7 天：Due Date 默认今天，创建前必须显示并允许修改。
- Priority 筛选开启时：继承当前 Priority。
- 所有工作区的系统聚合视图：Workspace 字段可见，默认 App Rail 当前 Workspace。
- 具体 Task List 或 Task Tag 唯一确定其 Workspace。

搜索词非空、Archived Task List、完成状态筛选为 completed 或 Trash 时不提供快速添加。

首版不根据标题文本自动解析日期、标签或 Priority。

### 6.2 字段级自动保存

右侧详情不提供整页保存按钮：

- Workspace、Task List、Task Tag、Priority、Due Date、完成状态和 Checklist 操作立即持久化。
- 标题和描述先维护草稿，在失焦、`Ctrl/Cmd + Enter`、切换 Task 或关闭详情时提交。
- 标题为必填单行；描述为可选纯文本。
- 标题清空时不提交，保留焦点并显示字段错误。
- 结构化字段失败时回滚并显示 Toast。
- 标题或描述失败时保留草稿并允许重试。
- 文本提交失败时阻止切换 Task，直到重试或明确放弃修改。
- 不持续显示“已保存”，只在慢写入时显示 Spinner，在失败时提示。

### 6.3 Task 字段

首版详情字段：

- 标题。
- 纯文本描述。
- Workspace。
- nullable Task List。
- 多 Task Tag。
- Priority。
- Due Date。
- active / completed。
- Checklist Item。
- Task List 或 Inbox 容器内的手动顺序。
- 创建、更新、完成和删除时间等系统字段。

Workspace 归属不使用普通字段选择器静默切换。跨 Workspace 修改必须进入显式移动流程。

## 7. 移动、归档与删除

### 7.1 同 Workspace 移动

- 可移动到同 Workspace 的 active Task List。
- 未选择目标 Task List 时进入 Inbox。
- Archived Task List 不作为普通移动目标。

### 7.2 跨 Workspace 移动

移动时必须明确选择：

- 目标 Workspace。
- 可选目标 Task List；不选则进入目标 Inbox。
- 目标 Workspace 内的 Task Tag。

原 Task Tag 只读展示供参考，不按名称自动匹配或创建。确认后删除源 Assignment，建立用户明确选择的目标 Assignment。

Checklist Item、标题、描述、Due Date、Priority 和完成状态保持不变。取消移动时不修改任何数据。

### 7.3 Task List 归档

- 归档保留 Task List 和其中所有 Task。
- 归档 Task List 与其中 Task 退出今天、未来 7 天、Inbox、Task Tag、所有工作区活跃汇总、默认搜索和活跃计数。
- 归档非空 Task List 前显示未完成 Task 数量并要求确认。
- 恢复后，符合条件的 Task 重新进入活跃视图。
- 恢复尽量回到原顺序；发生冲突时放到 active Task List 末尾。

归档清单中的 Task 默认只读：

- 可查看完整详情。
- 可恢复整个 Task List。
- 可将单个 Task 移动到 active Task List 或 Inbox。
- 可将单个 Task 软删除到 Trash。
- 不直接编辑标题、描述、Due Date、Priority、Task Tag、完成状态或 Checklist。

### 7.4 Task List 永久删除

- 只要仍有 active 或 completed Task，就禁止永久删除，只能归档。
- 没有未删除 Task 的 Task List 可永久删除，并要求确认。
- Trash 中的 Deleted Task 不阻止 Task List 永久删除。
- 如果 Trash 中仍有原属该 Task List 的 Task，确认框必须显示数量，并说明恢复后进入 Inbox。
- 确认删除后清除这些 Deleted Task 的原 Task List 关联，保留 Workspace 与其他数据。

### 7.5 Task Tag 删除

- 删除前显示关联 Task 数量并要求确认。
- 删除 Task Tag 与 Assignment，不删除、完成或移动 Task。
- Task Tag 不提供归档。

### 7.6 Task 删除与恢复

- 软删除后清空右栏，并将中栏焦点移到下一条可见 Task，没有下一条时移到上一条。
- 提供短时撤销删除 Toast；撤销等价于恢复。
- 恢复时原 Task List 仍存在则恢复原归属；不存在则进入 Inbox。
- 仍存在的 Task Tag 重新生效；已永久删除的标签不重建。
- Trash 中 Task 只读，只提供恢复和永久删除。
- 单项永久删除和清空 Trash 都要求确认，不提供 Toast 撤销。

### 7.7 Workspace 删除

删除 Workspace 时，在同一事务中永久级联：

- 全部 Task，包括 active、completed 和 Trash。
- 全部 Checklist Item。
- 全部 active / archived Task List。
- 全部 Task Tag 与 Assignment。

确认框显示各类数量，并说明只能通过全量覆盖恢复回到删除前快照；该恢复会同时回退其他 Workspace。首版不提供删除 Workspace 时迁移 Task 的向导。

## 8. 搜索、筛选、排序与计数

### 8.1 文本搜索

搜索只过滤当前视图，不进入独立全局页面。

匹配：

- Task 标题。
- Task 描述。
- Checklist Item 文本；命中时返回父 Task，并显示摘要。

不通过自由文本匹配 Workspace、Task List 或 Task Tag 名称。使用大小写不敏感包含匹配并支持中文，不做模糊纠错、相关度排序或高级语法。

搜索继承当前范围、视图、Priority 和完成状态筛选。归档和 Trash 只在对应视图内搜索。默认只搜索 active Task。

### 8.2 完成状态筛选

- Task List、Inbox 和 Task Tag 视图提供 active、completed、all 三个状态，默认 active。
- 今天和未来 7 天固定为 active，不显示完成状态筛选。
- 已归档清单可按 active、completed、all 查看，但其中 Task 保持只读。
- Trash 固定展示 Deleted Task，不显示完成状态筛选。
- completed 状态不提供快速添加；all 状态中的快速添加仍创建 active Task。

### 8.3 Task Tag 过滤

- 左栏单次只选择一个 Task Tag。
- 所有工作区模式按 Workspace 分组展示 Task Tag。
- 文本搜索、Task Tag、Priority 和完成状态之间使用 AND。
- 首版不提供多个 Task Tag 的 AND/OR 切换。

### 8.4 排序与拖拽

Task 的手动顺序字段只在一个容器内有意义，容器键为 `workspaceId + listId`；`listId = null` 代表该 Workspace 的 Inbox。

- 新建 Task 放到目标容器末尾。
- 同 Workspace 移动或跨 Workspace 移动后放到目标容器末尾。
- 软删除保留原顺序；恢复时原位置仍可用则回到原位置，否则放到容器末尾。
- 重排后规范化容器内顺序，避免长期产生重复或稀疏值。

Task List 与 Inbox：

- 默认手动排序。
- 修改 Priority 不隐式改变位置。

今天：

- 逾期在前。
- 其后按 Priority 高、中、低、无。
- 同 Priority 使用稳定容器顺序：Workspace 顺序、Inbox 优先、Task List 顺序、Task 手动顺序、创建时间、ID。

未来 7 天：

- Due Date 升序。
- 同一天按 Priority 高、中、低、无。
- 再使用上述稳定容器顺序。

Task Tag 和所有工作区聚合：

- Due Date 升序，无日期在后。
- 同日期按 Priority，再按创建时间和 ID。

排序菜单提供手动、截止日期、优先级和创建时间。手动选项只在单 Workspace 的单个 Task List 或 Inbox 中可用。只有“单 Workspace + 单 Task List/Inbox + 手动排序 + 无搜索筛选”时启用拖拽。

所有工作区、日期聚合、Task Tag 聚合、搜索结果或显式排序模式中禁用拖拽。排序选择是本机 UI 偏好，不进入业务备份。

### 8.5 数量徽标

左栏徽标不随中栏搜索、Priority 或完成状态筛选波动：

- 今天：今日加逾期 active Task 数。
- 未来 7 天：今天至未来第六天 active Task 数，不含逾期。
- Inbox：`listId = null` 的 active Task 数。
- Task List：该清单 active Task 数。
- Task Tag：关联该标签的 active Task 数。
- 已归档的清单：归档 Task List 数。
- Trash：Deleted Task 数。

completed 数量只显示在中栏“已完成”分组标题。0 不显示徽标。所有工作区模式汇总系统入口数量，具体 Task List 和 Task Tag 仍显示各自数量。

## 9. 中栏与右栏

### 9.1 中栏任务行

使用高密度列表，不使用卡片堆叠。

固定信息：

- 完成 Checkbox。
- Task 标题。
- Priority 旗标。
- Due Date。

按需信息：

- Checklist 完成数。
- 最多两个 Task Tag，更多显示 `+N`。
- Task List 名称；Inbox 项显示“收集箱”。
- 所有工作区模式下显示 Workspace 名称和图标。
- 搜索命中描述或 Checklist Item 时显示一行摘要。

逾期必须使用文字或图标与危险色共同表达。selected 使用品牌绿竖条、字重和中性底色，不引发布局位移。completed 降低强调但保持可读，不使用整行删除线。

### 9.2 选择与完成

- 点击任务行主体选中并在右栏显示详情。
- 点击 Checkbox 只切换完成状态，不强制打开详情。
- 当前选中 Task 完成后，右栏继续显示 completed 状态。
- 在 Task List、Inbox 或 Task Tag 视图中，Task 移入默认折叠的“已完成”分组。
- 在 active-only 视图中，Task 退出中栏，但右栏暂时保留，直到选择其他 Task 或关闭详情。
- 完成提供短时撤销 Toast。
- 取消完成后按当前视图规则重新出现。
- 首版不为双击定义特殊行为。

### 9.3 空详情

未选择 Task 时，右栏显示轻量空状态“选择一条待办”。不自动选中或打开第一条 Task。

## 10. 三栏布局与响应式

### 10.1 桌面 `>=1200px`

- App Rail 保持 68px，不计入待办三栏。
- 左栏基准宽度 240px，不允许拖动。
- 中栏和右栏占剩余空间，默认 50:50。
- 中栏最小约 340px，右栏最小约 380px。
- 只有中右分隔线可调整。
- 分隔线支持鼠标和触控拖动。
- 方向键调整不作为产品能力或验收项；若底层组件原生提供，不专门禁用。
- 双击分隔线恢复 50:50。
- 分栏比例按百分比存入本机 UI 偏好，刷新恢复；视口不足时自动夹紧。
- 左、中、右栏各自独立纵向滚动，栏头固定，页面不产生横向滚动。

### 10.2 窄桌面 `761-1199px`

- 保留 App Rail。
- 左侧待办导航通过左侧 Sheet 打开。
- 中栏与右栏并排，并可鼠标/触控调整。
- 此区间使用独立最小宽度：中栏约 280px、右栏约 360px；保存的比例必须按该区间重新夹紧。
- 分隔线视觉宽度与命中区不得使两栏总最小宽度超过 App Rail 后的可用空间。
- 不产生横向滚动。

### 10.3 移动端 `<=760px`

- 沿用现有规则隐藏 App Rail。
- 默认显示 Task 列表。
- 待办导航通过左侧 Sheet 打开。
- 点击 Task 后详情全宽替换列表。
- 详情顶部提供明确返回按钮。
- 不显示可拖动分隔线。

窄屏切换不清除筛选、范围模式或选中 Task。从窄屏恢复到桌面后恢复三栏和保存的中右比例。

### 10.4 视觉与组件边界

- `DESIGN.md` 是视觉 token 单一真源。
- 使用工具型、扁平、高密度布局，不引入营销式卡片或新配色体系。
- 品牌绿只用于焦点、选中和必要状态，不大面积铺底。
- 列表与详情通过边框、留白和背景层级区分，不使用重阴影。
- 图标统一使用 Lucide。
- 建议使用 shadcn `Resizable`、`ScrollArea`、`ToggleGroup`、`Sheet`、`AlertDialog`、`Empty` 和现有表单组件。
- `Resizable` 与 `ToggleGroup` 当前未安装；实现时必须通过项目的 shadcn CLI 查询、安装并检查源码。

## 11. 数据持久化

### 11.1 IndexedDB 表

新增五张表：

1. `taskLists`
2. `tasks`
3. `checklistItems`
4. `taskTags`
5. `taskTagAssignments`

关系：

- Task、Task List、Task Tag 直接保存 `workspaceId`。
- Checklist Item 通过 `taskId` 归属 Task。
- Task Tag Assignment 以 `taskId + tagId` 表示唯一多对多关系。
- Task 保存容器内手动顺序；其作用域由 `workspaceId + listId` 决定。
- 服务层禁止 Task 引用其他 Workspace 的 Task List 或 Task Tag。
- Trash 使用 Task 的删除时间，不复制实体。
- completed 使用状态和完成时间，不复制历史实体。
- Task 是否位于归档清单通过 Task List 状态判断，不在 Task 上冗余归档状态。

所有工作区视图移除查询的 Workspace 限制，但仍必须应用归档、删除和关联一致性规则。

### 11.2 事务

以下操作必须使用事务，失败整体回滚：

- 创建或删除带 Checklist / Tag Assignment 的 Task。
- 跨 Workspace 移动 Task。
- 删除 Task Tag。
- 永久删除 Task List 并处理 Trash 关联。
- 删除 Workspace。
- 全量备份恢复。

写入后复用现有跨上下文变更广播机制，使其他扩展上下文重新读取数据。

### 11.3 数据库迁移

- 使用下一个数据库版本新增空表。
- 不改写现有 Workspace、Category、Bookmark、Context、Pinned Tab 或 Bookmark Tag 数据。
- 迁移失败时保留旧数据，不允许部分建表后继续运行。

## 12. 备份、同步与隐私

### 12.1 全量备份

手动全量备份与云备份必须包含：

- active / archived Task List。
- active / completed / Deleted Task。
- Checklist Item。
- Task Tag 与 Assignment。
- 所有归属、排序、日期和时间字段。

备份格式升级。所有恢复都是全库覆盖，不支持选择性恢复：

- 新版备份在同一事务中覆盖全部业务表。
- 旧备份缺少待办集合时按空数组解析，因此恢复旧备份会清空设备当前全部待办数据。
- 恢复预览与确认必须显示备份时间、格式版本，并明确现有书签与待办都会被快照替换。
- 使用全量备份恢复已删除 Workspace 时，其他 Workspace 也会回退到该快照，不是单 Workspace 恢复。
- 用户取消确认或恢复失败时，本地现有数据保持不变。

### 12.2 分享包

首版分享包不包含任何待办数据。现有 Workspace / Category / Bookmark 分享选择与合并导入语义保持不变。

### 12.3 UI 偏好

以下属于本机 UI 偏好，不进入业务备份：

- 中右分栏比例。
- 当前排序方式。
- 页面存续期间的范围模式。
- 当前视图、搜索、筛选和选中 Task。

### 12.4 同步承诺

- 待办完整离线可读写。
- 云能力只提供快照备份与覆盖恢复。
- 不宣称多设备实时同步。
- 两台设备分别修改后不会自动合并。

### 12.5 明文边界

Task 标题、描述、Checklist Item、Due Date、Priority、Task List 和 Task Tag 均以明文保存到 IndexedDB 和备份 JSON。

现有主密码只保护 Bookmark Context，不保护 Task。锁定和解锁不影响待办页使用，UI 不得暗示待办数据已加密。

## 13. 错误、加载与一致性

- 初始化加载使用稳定 Skeleton，不改变三栏尺寸。
- 空视图使用 shadcn Empty，不把使用说明写成常驻大段文案。
- 本地写入失败使用明确 Toast 或字段错误。
- 异步操作期间禁用重复提交。
- 跨表失败必须回滚，UI 恢复到持久化前状态或保留可重试草稿。
- 日期视图在本地日期跨午夜后刷新。
- Workspace 切换、导入恢复和其他上下文写入后，当前视图重新读取并清理无效选择。

## 14. 可访问性

- 所有图标按钮提供可访问名称和 Tooltip。
- Checkbox、范围分段控件、表单字段、菜单和确认对话框使用语义组件。
- 焦点顺序与左栏、中栏、右栏视觉顺序一致。
- selected、Priority、逾期、归档和错误状态不能只依赖颜色。
- 鼠标与触控拖动具有可见 hover、active 和 focus 状态。
- 已知首版风险：若底层组件没有原生键盘调整能力，键盘用户无法调整分栏；按已确认范围不额外实现方向键交互。
- 移动端操作目标满足至少 44px 触控尺寸。
- 所有 viewport 不得出现横向滚动、文本遮挡或不可达操作。

## 15. 验收标准

### 15.1 功能

- 可从 App Rail 和移动导航进入待办页并返回主页。
- 当前 Workspace 与所有工作区查询、创建、计数和移动不串数据。
- Task List、Task Tag、Task、Checklist Item 的全部首版操作符合本规格。
- 归档清单中的 Task、Deleted Task 不进入活跃聚合、默认搜索和活跃计数。
- Completed Task 与 Checklist Item 的独立状态可观察且可恢复。
- 快速添加继承正确上下文，不产生创建后立即消失的 Task。
- 搜索、筛选、排序和拖拽启用条件正确。
- 字段级自动保存成功、失败、重试和放弃路径完整。

### 15.2 数据

- Workspace、Task List、Task Tag 归属约束不能被绕过。
- Due Date 在时区变化下不偏移。
- 跨 Workspace 移动不保留源 Tag ID，也不按名称隐式映射。
- Task List、Task Tag、Task 和 Workspace 删除规则保持事务一致。
- 新版全量备份可完整恢复全部关系和状态。
- 恢复旧版备份前明确警告其待办集合为空；确认后清空现有待办并恢复旧快照，取消时不修改数据。
- 全量恢复明确警告其他 Workspace 也会回退，不暗示可选择性恢复。
- 断网时创建、编辑、完成 Task 并重新加载页面，数据仍从本地 IndexedDB 恢复。
- 云快照上传或下载失败时不修改本地数据，并提供可观察的错误反馈。
- 云快照成功往返：上传包含全部待办关系与状态的快照，修改本地数据，下载并确认覆盖后，全部关系与状态恢复为快照内容。
- 分享包格式和现有书签合并导入行为不受影响。

### 15.3 布局

验证 1440、1200、1024、761、760 和 375px：

- 正确进入三栏、双栏或单面板模式。
- 无横向滚动、文本重叠、控件溢出或布局位移。
- 中右拖动边界、双击重置和本地恢复正确。
- 移动端导航、详情返回和焦点行为可用。
- App Rail、Logo、Workspace 列表和 Avatar 原有位置不回归。

### 15.4 自动化验证

实现前遵循 `docs/standards/testing.md`：

- 真实渲染项目 UI 组件，不整体 mock shadcn 或 Semi。
- 组件交互使用 `userEvent` 与语义 query。
- IndexedDB 使用 `fake-indexeddb` 验证真实事务和迁移。
- 只 mock Chrome API、网络、Toast 等副作用边界。

必须通过：

- `pnpm run typecheck`
- `pnpm run test`

视觉验收还需覆盖上述 viewport 的实际截图或真机观察；只有自动化测试通过不能宣称三栏视觉验收完成。
