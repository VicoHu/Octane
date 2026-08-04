# Issue #72：待办事项页成熟产品模式研究

> 范围：为 Octane Issue #72 后续一问一答的产品决策提供证据，不替代产品决策。仅采纳 Todoist、TickTick、Things、Microsoft To Do、Apple Reminders、Linear、Asana 的官方帮助/产品/开发文档；没有直接官方依据的结论均明确标注。  
> 检索日期：2026-08-03。

## 0. 与 Issue #72 的直接关系

Issue #72 需要在 AppRail 下增加待办入口，右侧切换为待办工作区；示意图为左侧导航/过滤、中部任务列表、右侧任务详情，约 `1:2:2`，中/右分隔线可调。[Issue #72](https://github.com/VicoHu/Octane/issues/72)

下文的“可迁移启示”是待确认的决策问题或约束，**不是对 Octane 行为的建议或承诺**。

## 1. 项目/清单归档、恢复及聚合视图

### 已证实模式

| 产品            | 官方证据                                                                                                                                                                                                                                                 | 对 Today / Upcoming / 搜索的已证实影响                                                                                                                                                                                                                                                                                        | 可迁移启示（待决策）                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Todoist         | 项目可归档；官方 API 同时暴露 active/archived project 列表和 archive/unarchive 操作。[API](https://developer.todoist.com/api/v1/)                                                                                                                        | Today/Upcoming 仅展示带日期的任务；官方未在该页说明已归档项目任务是否仍进入两视图。[Today](https://www.todoist.com/help/articles/plan-your-day-with-the-today-view-UVUXaiSs) 备份明确排除 archived projects 与 completed tasks。[备份](https://www.todoist.com/help/articles/download-or-restore-backups-in-todoist-ywaJeQbN) | 将“归档”设计成可恢复状态时，需同时定义：归档对象是否从活跃导航、日期聚合、搜索、导出/备份排除；不能只提供一个隐藏按钮。 |
| Linear          | 已关闭 issue 在达到周期后自动归档，且**不能手动归档 issue**；已删除 issue 在团队 archive 中保留 30 天，可恢复。已完成、取消、自动关闭的 issue 都可进入自动归档条件。[删除与归档](https://linear.app/docs/delete-archive-issues)                          | 官方把自动归档描述为保持工作区简洁且易搜索，但页面未精确承诺归档 issue 在默认搜索结果、每种视图中的展示规则。[删除与归档](https://linear.app/docs/delete-archive-issues)                                                                                                                                                      | 可评估“归档是终态之后的保留层”与“用户手动归档容器”两种不同语义；后者不能从 Linear 的 issue 行为直接推导。               |
| Things          | 已完成项目/任务可进入 Logbook；Quick Find 可打开 Logged Projects，且必须点 Continue Search 才把 Logbook、notes、checklists 纳入全文搜索范围。[Quick Find](https://culturedcode.com/things/support/articles/2803584/)                                     | Today 是跨应用过滤：start date、deadline 或 repeating rule 命中今天的待办出现；未来 start date 的项目/待办在 Upcoming 休眠，到日才进入 Today。[Today/Upcoming](https://culturedcode.com/things/support/articles/4001304/)                                                                                                     | 可将“完成记录/历史”独立成显式 Logbook，并把历史搜索设为用户主动扩大范围，而不是默认污染活跃结果。                       |
| Apple Reminders | Apple 官方资料使用“完成/删除/Recently Deleted/恢复”和 iCloud 历史版本恢复；未提供用户级“归档清单”概念的直接证据。删除项目保留 30 天后永久移除。[删除与恢复](https://support.apple.com/guide/iphone/delete-and-recover-reminders-iph51b488c05/ios)        | Smart List 中的 Today 为今日及逾期项；All 为跨列表所有项；Completed 为已勾选项。[Smart Lists](https://support.apple.com/guide/iphone/use-smart-lists-iphe882772ed/ios)                                                                                                                                                        | 不应将“归档”偷换为“删除后可恢复”；两者数据保留、导航和检索语义应分别命名。                                              |
| Asana           | 官方列出 project 的 Archive 与 Delete 为不同动作；删除项进入 Deleted view，任务/项目等可在 30 天内恢复。[项目](https://help.asana.com/s/article/understanding-projects) [恢复](https://help.asana.com/s/article/recover-deleted-tasks-projects-and-more) | 本轮已检索官方页面**没有取得**“归档项目的任务是否进入 My Tasks、搜索或日期视图、如何取消归档”的直接证据。                                                                                                                                                                                                                     | 归档恢复与“聚合视图是否保留任务”必须作为独立验收题，不能仅依据菜单同时有 Archive/Delete 推断。                          |

### 结论边界

- 本轮没有找到 TickTick 官方文档中关于“项目/清单归档及恢复”以及归档任务进入 Today/搜索的可靠直接说明，故不作为事实采用。
- Todoist 官方页明确说明“完成任务可在 Today/Upcoming 显示”仍属于 beta/平台受限能力；不要把这当成所有平台的稳定基线。[查看完成任务](https://www.todoist.com/help/articles/view-completed-tasks-in-todoist-J19h2s)
- “归档项目中的未完成且有日期任务是否仍显示于 Today/Upcoming/默认搜索”对 Todoist、Asana 均未找到足够直接的一手证据。

## 2. Inbox：实体容器、未归类视图，还是通知中心

| 产品            | 事实                                                                                                                                                                                                                                                                                    | 可迁移启示（待决策）                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Todoist         | Inbox 是默认 task list；未显式指定 project 的新任务默认进入 Inbox，可在之后移往项目；Inbox 因此同时是实体归属和“未归类任务”的默认收集点。[Inbox 与项目](https://www.todoist.com/help/articles/whats-the-difference-between-the-inbox-and-a-project-d6dSLqAM)                            | 若采纳此模型，任务数据模型需有稳定的 Inbox/list 归属，而非仅用 `projectId = null` 临时投影；迁移至项目后 Inbox 不再显示。 |
| Things          | Inbox 是内建 list，官方强调先快速捕获、后日常审阅并决定何时开始；其脚本文档将 Inbox 作为独立 built-in list，并提供 `is inbox` 属性。[工作流](https://culturedcode.com/things/support/articles/6378414/) [Shortcuts 数据模型](https://culturedcode.com/things/support/articles/9596775/) | 可将收集箱定义为单一、可导航且可清空的系统容器；其价值在“捕获与处理分离”，不是又一个项目。                                |
| Microsoft To Do | My Day 是每日焦点的临时集合，加入 My Day 的任务仍保留在原 Tasks list，未完成会隔日建议；这证明一种“聚合不改变原归属”的模型。[My Day](https://support.microsoft.com/en-us/todo/plan-and-connect-with-microsoft-to-do)                                                                    | “Today/My Day”宜被当作投影，不应与 Inbox 的默认归属职责混用。                                                             |
| Linear          | Inbox 明确定义为通知中心，放订阅 issue 的更新，可在 Inbox 中更新 issue 属性、删除/稍后通知；它不是未归类任务清单。[Linear Inbox](https://linear.app/docs/inbox)                                                                                                                         | 待办收集箱与通知收件箱应采用不同的对象/词汇，避免用户以为“清空 Inbox”会删除任务。                                         |
| Asana           | Inbox 是导航区中的更新入口；My Tasks 才是自动汇集所有分配给个人的任务的任务视图。[导航](https://help.asana.com/s/article/navigating-asana?language=en_US) [My Tasks](https://help.asana.com/s/article/my-tasks)                                                                         | 可将“我的聚合任务”与“通知”分离；前者不等同于未归类任务。                                                                  |

## 3. Task、Checklist Item/Subtask、Tag/Label 的关系与边界

### 任务层级

- **Checklist item 不是完整 task 的通用同义词。** Things 的官方 Shortcuts 数据模型中，只有 To-Do 拥有 Checklist；Project、Area、Heading 不拥有。官方又建议：小目标用 checklist；较大目标升级为 Project，使每一步成为带 notes/tags/dates 的独立 to-do。[数据模型](https://culturedcode.com/things/support/articles/9596775/) [checklist 与项目](https://culturedcode.com/things/support/articles/8491676/)  
  **启示：** 需先定义 Checklist Item 是否只含文本与勾选状态，还是完整 Task；否则日期、提醒、标签、搜索、聚合与迁移都会产生不一致。

- **Subtask 是可独立携带字段的任务，但继承规则各异。** TickTick 说明每层 subtask 都与普通 task 同功能，可设置时间、内容、标签、优先级、删除恢复，并最多五层；但只能在 Inbox 和普通 list 内创建，Today 等 smart list 不能直接创建。[多层任务](https://help.ticktick.com/articles/7055782219767349248)  
  **启示：** 如果支持任务级子任务，聚合视图里应限制“创建层级”的入口，或在创建时显式让用户选父任务/归属，避免视图语义不明确。

- Todoist 子任务能各自安排日期；若父子都安排在今天，Today 中都会以同一缩进级显示。Today/Upcoming/filter/label 视图不能内联新建子任务，必须先打开父任务详情。[子任务](https://www.todoist.com/help/articles/introduction-to-sub-tasks-kMamDo)  
  **启示：** 聚合列表应将“编辑既有子任务”和“创建新子任务”的交互分开；后者可以跳转或弹出详情，而不强行在不明确的聚合上下文内落库。

- Asana 子任务保有和父 task 相同的字段，但嵌在父 task 内；完成父任务**不会**完成子任务，子任务也不继承父任务的 projects、tags 或 assignee，需自行添加项目/截止日才出现在项目日历。[Subtasks](https://help.asana.com/s/article/subtasks?nocache=https%3A%2F%2Fhelp.asana.com%2Fs%2Farticle%2Fsubtasks%3Flanguage%3Den_US) [tasks 与 subtasks](https://help.asana.com/s/article/tasks-and-subtasks)  
  **启示：** 父子完成级联、属性继承、日期聚合三项必须独立决策，不能因为有树形 UI 就默认任何一种行为。

- Apple Reminders 中完成父任务会一并完成子任务；删除或移动父任务也会删除或移动子任务。[组织列表](https://support.apple.com/guide/iphone/edit-and-organize-a-list-iph82596cb20/ios)  
  **启示：** 这是与 Asana 对照的另一种一致模型，说明级联完成/删除的选择会实质影响撤销与恢复设计。

- Microsoft To Do 的 Steps 用来把大任务拆成小而可执行的步骤，并有完成进度计数；官方没有在该页赋予步骤独立日期、提醒、归属或标签字段的证据。[Steps/Tags](https://support.microsoft.com/en-us/todo/add-steps-importance-notes-tags-and-categories-to-your-tasks)  
  **启示：** 若 Octane 先做轻量 checklist，Steps 是较低复杂度的参照边界；不要声称它等同可独立调度的 subtask。

### Tag / Label

- Todoist 标签是可在 Quick Add、任务详情中附加的 task 属性；项目是任务所在 list，二者分别通过 `@label` 与 `#project` 指定。[Quick Add](https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz)  
  **启示：** 标签适合多对多横切过滤；不应承担唯一归属/层级职责。
- Microsoft To Do 用任务标题的 `#tag` 组织跨 list 的 tasks、notes 与 steps；点击或搜索标签可聚合它们。[官方说明](https://support.microsoft.com/en-us/todo/add-steps-importance-notes-tags-and-categories-to-your-tasks)  
  **启示：** 若标签可出现在自由文本内，要决定解析、重命名、删除及搜索索引的规则。
- Linear labels 可建在 workspace 或 team 层，也能分组；sub-issue 不继承 parent 的 labels。[标签](https://linear.app/docs/labels) [父子 issue](https://linear.app/docs/parent-and-sub-issues)  
  **启示：** 多作用域标签和继承策略属于协作产品复杂度，个人待办首版不应无证据地预设。
- Apple Tags 可建立 Smart List；一个 Smart List 可按 tags、日期、时间、地点、flag、优先级等跨原列表筛选，原 reminder 保持在原 list 中。[Smart Lists](https://support.apple.com/guide/iphone/use-smart-lists-iphe882772ed/ios)  
  **启示：** 可把“标签视图”实现为纯查询投影，不复制或迁移任务实体。

## 4. 全局聚合视图中的创建、编辑与归属提示

### 已证实模式

- Todoist 的 Quick Add 可从任何上下文创建，并可在输入时指定 date/deadline/labels/reminders/project/section；其中项目以 `#`、分区以 `/` 表示。未指定项目则进 Inbox。[Quick Add](https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz)  
  **启示：** 聚合视图创建任务时，至少要有可见的默认落点与低摩擦改归属机制；文本快捷语法只是可选实现，不是必要产品要求。

- Todoist 的任务详情显示 project/section 面包屑，并允许从右侧字段将任务移往不同 project/section；Today 只显示有 date 的跨项目任务。[任务详情](https://www.todoist.com/help/articles/use-the-task-view-to-manage-tasks-in-todoist-eDeRDO0C) [Today](https://www.todoist.com/help/articles/plan-your-day-with-the-today-view-UVUXaiSs)  
  **启示：** Issue #72 的右侧详情栏应能回答“此任务属于哪里”；在聚合页编辑归属不应需要离开当前任务。

- Asana 的 My Tasks 自动聚合用户在所有项目中被分配的任务；在该视图可创建任务，并可创建自己的 section。任务详情 pane 直接提供 project 字段，任务可同时属于最多 20 个 projects，完成状态跨这些项目共享。[My Tasks](https://help.asana.com/s/article/my-tasks) [任务字段](https://help.asana.com/s/article/task-fields)  
  **启示：** 需先选择唯一归属还是多归属；若采用多归属，列表行和详情都需可靠展示全部归属，不能仅存一个 project label。

- Linear 的 project 视图可用 `C` 创建 issue；从其他页面创建时，可手动填 project 属性；issue 只能属于一个 project。[项目](https://linear.app/docs/projects)  
  **启示：** 单归属模型也应在“全局创建”时给出明确的未设置状态或可编辑 project 字段。

### 无直接证据

本轮官方资料没有给出可复用的、精确的“全局视图创建后何时强制选择归属”规则，也没有为个人待办产品证明“必须强制选清单”或“永不强制选清单”。这应作为 Octane 的单独产品问题。

## 5. 完成、取消完成、删除、归档的区别

| 操作     | 一手证据的典型语义                                                                                                                                                                                                                                                                                                                                                                    | 可迁移启示（待决策）                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 完成     | Todoist 完成任务后可在项目的 completed 区查看，取消勾选可恢复；Apple 完成后任务被保存但隐藏，取消完成后回到活跃列表；重复 reminder 完成当期会出现下一个重复实例。[Todoist](https://www.todoist.com/help/articles/view-completed-tasks-in-todoist-J19h2s) [Apple](https://support.apple.com/guide/reminders/mark-reminders-complete-or-incomplete-remndbeda47c/mac)                    | 完成应保留完成时间/历史与可逆入口；重复任务的“完成”应明确影响当期还是模板。                                                            |
| 取消完成 | Linear 的状态机把 Done 与 Canceled 分置在不同固定类别；auto-close 可通过改状态重新打开。[工作流](https://linear.app/docs/configuring-workflows) [归档](https://linear.app/docs/delete-archive-issues)                                                                                                                                                                                 | “取消完成”（reopen）与“取消任务”（canceled）不应同名：前者是把已完成工作重新打开，后者是终止但不表示已交付。是否需要取消状态仍待定义。 |
| 删除     | Apple 进入 Recently Deleted，30 天内可恢复、可永久删除；Asana 删除任务/项目 30 天可恢复；Things Mac 进入 Trash，iOS 删除通常永久。[Apple](https://support.apple.com/guide/iphone/delete-and-recover-reminders-iph51b488c05/ios) [Asana](https://help.asana.com/s/article/recover-deleted-tasks-projects-and-more) [Things](https://culturedcode.com/things/support/articles/2967034/) | 删除须定义软删保留期、恢复位置、永久删除与本地/多端一致性；移动端和桌面不宜悄然使用不同不可逆规则。                                    |
| 归档     | Linear 的 archive 是关闭后自动发生的保留层；Todoist 有项目 archive/unarchive API；两者都与 delete 不同。[Linear](https://linear.app/docs/delete-archive-issues) [Todoist API](https://developer.todoist.com/api/v1/)                                                                                                                                                                  | “归档”应是可恢复且不等价于“完成单个任务”的容器/历史状态；必须写清聚合与搜索可见性。                                                    |

## 6. 日期语义：截止、计划、提醒、重复

### 可区分的四个概念

1. **计划/开始日期（何时开始处理）**：Things 明确把 start date 定义为开始处理的日子；未来开始日期任务在 Upcoming 休眠，到日自动进入 Today。其项目也可有 start date。[日期安排](https://culturedcode.com/things/support/articles/2803579/)  
   **启示：** 若采用计划日期，不要显示成承诺完成日；Today/Upcoming 的入选规则应由这一语义单独驱动。

2. **截止日期（必须在何日前完成）**：Things 明确区分 deadline（by when）和 start date（when start）；Todoist 也区分 Date 与 Deadline，重复 date 改变时 deadline 仍可固定。[Things](https://culturedcode.com/things/support/articles/2803579/) [Todoist](https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO)  
   **启示：** 若仅有一个日期字段，应避免同时称作“计划”和“截止”；若做两字段，需定义 Today、Upcoming、逾期和排序分别用哪一个。

3. **提醒（通知触发时刻/地点）**：Microsoft To Do 的 reminder 与 due date 分开设置；Todoist 有相对时间、自定义、重复及地点提醒；Apple 可按日期时间或到/离地点提醒，且可设提前提醒。[Microsoft](https://support.microsoft.com/en-us/todo/add-due-dates-and-reminders-in-microsoft-to-do) [Todoist](https://www.todoist.com/help/articles/introduction-to-reminders-9PezfU) [Apple](https://support.apple.com/guide/reminders/add-dates-or-locations-to-reminders-remnd4b206fb/mac)  
   **启示：** reminder 是通知计划，不是任务状态或日期归属；离线/权限失败时的提示和重试语义须另行定义。

4. **重复（规则或下一次实例）**：Todoist 完成 recurring task 后自动移到下一个日期；Microsoft To Do 可按日/工作日/周/月/年或自定义重复；Apple 支持自定义频率。[Todoist](https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV) [Microsoft](https://support.microsoft.com/en-us/todo/add-due-dates-and-reminders-in-microsoft-to-do) [Apple](https://support.apple.com/guide/reminders/add-dates-or-locations-to-reminders-remnd4b206fb/mac)  
   **启示：** 需先定重复的存储模型（单一任务推进下一期，或生成独立实例）以及“取消完成/删除某期”对未来的影响；本轮来源不能证明任一模型对 Octane 更合适。

### 日期视图的事实边界

- Todoist：Today/Upcoming 只含带日期任务；无日期任务应在项目或 filter 中寻找。[Today](https://www.todoist.com/help/articles/plan-your-day-with-the-today-view-UVUXaiSs)
- Microsoft To Do：带 due date 的 scheduled tasks 自动出现在 Planned smart list。[due/reminder](https://support.microsoft.com/en-us/todo/add-due-dates-and-reminders-in-microsoft-to-do)
- Apple Reminders：Today 含今日和逾期项，Scheduled 依 date/time 聚合。[Smart Lists](https://support.apple.com/guide/iphone/use-smart-lists-iphe882772ed/ios)
- 本轮没有官方依据说明 Octane 应让“截止日”还是“计划日”驱动 Today/Upcoming；这是需要后续确认的核心语义。

## 7. 三栏 master-detail、分栏调整与窄屏降级

### 已证实、可借鉴的结构

- Asana 官方把桌面界面拆成 Sidebar、Header、Top bar、Main pane、Task details pane；点击任务打开 details pane。这与 Issue #72 的“左导航 + 中列表 + 右详情”结构高度相邻。[导航结构](https://help.asana.com/s/article/navigating-asana?language=en_US) [任务详情](https://help.asana.com/s/article/task-fields?nocache=https%3A%2F%2Fhelp.asana.com%2Fs%2Farticle%2Ftask-fields%3Flanguage%3Den_US)  
  **启示：** 可以把右栏定位为当前任务的稳定编辑上下文，而非复制任务行所有控制；但该资料不证明具体宽度比例。

- Asana 的 My Tasks 官方明确支持显示字段开关、字段重排和列宽调整。[My Tasks](https://help.asana.com/s/article/my-tasks)  
  **启示：** “可调整”有成熟先例，但此证据仅覆盖任务表格列宽，**不**证明 task details 分隔线应可拖拽。

- Things 同一 Today/Upcoming 概念在 Mac/iPad 的侧栏和 iPhone 的主列表中呈现，且 iPhone 只在移动主列表视图展示相关项目；Todoist 的 week calendar 在移动端一次仅显示 3 天、桌面 7 天。[Things](https://culturedcode.com/things/support/articles/4001304/) [Todoist 视图](https://www.todoist.com/help/articles/customize-views-in-todoist-AoHhBxFdZ)  
  **启示：** 窄屏不必保留三栏并列；功能可通过切换/渐进披露保留，而空间密度与信息量降低。

### 无直接证据

本轮未找到上述产品官方资料对下列事项的可引用、精确规则：

- `1:2:2` 是否为成熟产品的推荐比例；
- 左栏或中/右分栏是否可拖拽、最小/最大宽度及是否持久化；
- 在具体 viewport 宽度下先收起哪一栏、详情是 overlay、push 还是独立路由；
- 键盘、屏幕阅读器下分栏拖拽的无障碍行为。

这些必须在 Octane 的 UI 设计/验证阶段单独制定，不能借“成熟产品三栏”之名冒充官方通用规范。

## 8. 离线优先、备份与导出覆盖的数据

### 离线

- Things Cloud 官方明确称设备保存完整本地数据库，离线可工作，之后自动同步。[Things Cloud](https://culturedcode.com/things/cloud/) 这是一手资料中最直接的“离线优先”实例。
- Microsoft To Do 官方说旧版不再跨设备同步时仍可 offline mode，并警告登出会丢失未同步数据；正常任务数据存于 Exchange Online 并同步至 Outlook。[offline 提示](https://support.microsoft.com/en-us/todo/important-updates-are-available-for-microsoft-to-do-apps) [存储](https://support.microsoft.com/en-us/todo/using-microsoft-to-do-with-outlook-tasks)
- Apple 和 Todoist 的本轮官方资料证明跨设备 iCloud/云同步，但**没有找到**足以支持“完整离线编辑、队列、冲突合并”的直接规格。[Apple 同步](https://support.apple.com/en-us/102484)

**启示（待决策）：** “支持离线”至少需拆成读取缓存、创建/编辑/完成可写、离线操作队列、重连冲突策略、登出/清理本地数据。不可仅以“有本地缓存或云同步”宣称离线优先。

### 备份/导出

| 产品            | 官方覆盖范围与限制                                                                                                                                                                                                                                                                                         | 可迁移启示（待决策）                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Todoist         | 付费计划自动创建 active projects 的 ZIP/CSV 备份，含日期时间、描述、duration、deadline、重复日期等；**不含** completed tasks 和 archived projects。还原通过新项目导入 CSV，活动任务、日期、评论、附件可还原。[备份](https://www.todoist.com/help/articles/download-or-restore-backups-in-todoist-ywaJeQbN) | 数据导出范围须显式列出，特别是历史完成项、归档容器、附件、评论、标签、重复规则及布局配置，避免用户误把“备份”理解为全量。 |
| Things          | 可导出行业标准 SQLite 数据库，官方称其包含每一项 to-do 信息；Mac 自动保留最近十天全库日备份，Things Cloud 仅保存当前快照、不能回滚旧版本或选择性恢复。[导出](https://culturedcode.com/things/support/articles/2982272/) [备份](https://culturedcode.com/things/support/articles/2803570/)                  | 可将“可机读全量导出”“人类可读打印/导出”“版本化备份/恢复”作为不同承诺，不要以一个 CSV 同时覆盖三者。                      |
| TickTick        | Web 设置可生成数据 backup 并 import；官方页未在可获取文本中列出备份格式、字段、是否含完成/归档/附件。[Backup & Import](https://help.ticktick.com/articles/7055781405648748544)                                                                                                                             | 若以 TickTick 为参照，只能证明“有生成/导入备份流程”，不能推断格式和全量性。                                              |
| Linear          | workspace CSV 导出明确含 issue 的 status、project、labels、completed/canceled/archived、due date、parent issue 等字段；权限、条数和私有 team 范围受限。[导出](https://linear.app/docs/exporting-data)                                                                                                      | 对协作型任务，导出应公布字段与权限边界；层级、终态时间、归档状态若要可迁移，应在 schema 中显式存在。                     |
| Asana           | project 可导出 JSON 或 CSV；Search View 和 My Tasks 也可导出。官方页未在本轮可获取内容中列出各格式的字段完整性。[导入导出](https://help.asana.com/s/article/project-importing-and-exporting)                                                                                                               | “可导出项目”不等于“账户可全量备份”；需明确对象范围。                                                                     |
| Apple Reminders | iCloud.com 可将 reminders/lists 恢复到系统自动归档的早期版本，恢复会同步到所有开启 iCloud Reminders 的设备；本轮未找到官方通用任务数据格式导出说明。[iCloud 恢复](https://support.apple.com/guide/icloud/restore-your-reminders-mm546be3afba/icloud)                                                       | 云端恢复与用户可携带导出是不同能力；若需要用户控制与迁移，不能只提供历史恢复。                                           |

## 9. 可用于后续问答的待决策清单

1. Inbox 是“默认实体清单”、`未归类`查询视图，还是两者兼有？新任务在 Today/全局创建时默认落在哪里，界面如何可见地提示？
2. 项目/清单归档是否可恢复？归档后的未完成任务在 Today、Upcoming、搜索、标签过滤、导出/备份中各自是否可见？
3. Task、Checklist Item、Subtask 各自可否有日期、提醒、标签、详情、独立搜索命中和独立完成？父子项完成、删除、移动是否级联？
4. 标签是否是跨清单多对多属性？是否允许层级/作用域、是否继承到子任务？
5. Today/Upcoming 由计划日期、截止日期、提醒时间、重复规则中的哪些驱动？逾期与重复实例怎么显示？
6. 是否有 Canceled/放弃状态；它与 Completed、Reopen、Archive、Trash 的数据保留和恢复入口如何区分？
7. 三栏的可拖拽范围、持久化和窄屏切换策略是什么？哪些信息必须在列表行显示，哪些可只在详情？
8. 离线首版的承诺是读缓存还是本地可写并可靠同步？备份/导出是否覆盖完成记录、归档、关系、标签、附件/评论及偏好？

## 10. 证据缺口与使用限制

- 本研究没有把第三方测评、论坛问答、搜索摘要当成事实；表中所有事实链接均为厂商官方页面、官方开发文档或官方 Issue。
- 2026-08-03 检索时，部分 Asana 帮助页由 JavaScript 渲染，正文以官方搜索索引可见内容交叉验证；若后续决定依赖其归档恢复或窄屏的具体交互，应在登录后的官方帮助中心/产品内再复核。
- 没有找到关于 TickTick 的归档/恢复、是否出现在日期/搜索聚合，以及离线写入与冲突处理的足够直接官方证据。
- 没有找到任何所列产品官方资料能支持 Issue #72 示意图的固定比例、可拖拽中右分栏，或特定窄屏断点。因此这些是设计假设，而非已证实行业规范。
- “成熟产品都有的功能”不构成 Octane 应实现同等范围的证据；本研究只用于把术语、状态边界和验收问题说清。

## 来源（官方）

- [GitHub Issue #72](https://github.com/VicoHu/Octane/issues/72) — 目标布局和上下文。
- [Todoist Help Center](https://www.todoist.com/help/) 与 [Todoist API](https://developer.todoist.com/api/v1/) — Inbox、项目、聚合、日期、子任务、归档与备份。
- [Things Support](https://culturedcode.com/things/support/) 与 [Things Cloud](https://culturedcode.com/things/cloud/) — 本地数据库、离线、日期语义、Logbook、导出/备份。
- [Microsoft To Do Support](https://support.microsoft.com/en-us/todo) — Steps、标签、My Day、due/reminder/repeat、恢复与离线提示。
- [Apple Reminders User Guide](https://support.apple.com/guide/reminders/welcome/mac) 与 [iCloud User Guide](https://support.apple.com/guide/icloud/welcome/icloud) — Smart Lists、标签、子任务、完成/删除恢复、提醒和 iCloud 恢复。
- [Linear Docs](https://linear.app/docs) — 状态机、归档/删除、Inbox、父子 issue、标签、CSV 导出。
- [Asana Help Center](https://help.asana.com/) — 项目/删除、My Tasks、任务字段、子任务、桌面 pane 布局、导出。
- [TickTick Help Center](https://help.ticktick.com/) — 多层任务与 Backup/Import。

检索日期：2026-08-03。
