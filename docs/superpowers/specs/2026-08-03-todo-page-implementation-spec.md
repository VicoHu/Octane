# 待办事项页面实施规格

**日期：** 2026-08-03  
**状态：** 可实施  
**产品规格：** [待办事项页面设计](./2026-08-03-todo-page-design.md)  
**基线提交：** `4cb0d03 docs: define todo page product scope`  
**来源：** [GitHub Issue #72](https://github.com/VicoHu/Octane/issues/72)

## 1. 目的与优先级

本文把已确认的产品规格映射为现有代码库中的 Module、Interface、数据表、文件和验证步骤。它不重新定义产品语义。

发生冲突时优先级如下：

1. `CONTEXT.md` 的领域词汇。
2. `docs/adr/0001-workspace-owned-task-model.md` 与 `docs/adr/0002-separate-bookmark-and-task-tags.md`。
3. 产品规格 `2026-08-03-todo-page-design.md`。
4. 本实施规格。
5. 具体实现细节。

实施必须遵循 `DESIGN.md`、`docs/standards/testing.md` 和仓库根目录 `AGENTS.md`。

## 2. 当前架构事实

- Home 是 WXT React 入口，根组件位于 `src/entrypoints/home/App.tsx`。
- `App.tsx` 当前直接组合 `AppRail + Sidebar + Content`，没有主页面路由或页面状态机。
- `AppRail` 当前把主页激活态写死，Workspace 按钮直接调用 `switchWorkspace`。
- `<=760px` 时 App Rail 隐藏，现有 `.app-sidebar` 变成移动侧栏。
- 数据库使用 `idb`，不是 Dexie；连接、升级、事务、广播和全量导入均集中在 `src/shared/db/database.ts`。
- 当前 `DB_VERSION = 6`，任务数据需要升级到 v7。
- 当前 `BACKUP_VERSION = 5`，任务集合需要升级到 v6。
- 业务写入遵循 Service 执行事务、事务完成后 `broadcastChange`、Zustand store 更新切片的模式。
- 排序沿用 `nextOrder`、`validateOrderedIds`、容器内完整重编号和失败回滚模式。
- 全量恢复由 `BackupMessaging` 在 background 执行；分享导入与全量恢复是不同消息通道。
- 项目使用 shadcn/ui Base UI 基座。`ScrollArea`、`Sheet`、`AlertDialog`、`Popover` 等已存在，`Resizable` 与 `ToggleGroup` 尚未安装。
- 当前没有 Playwright 基建。自动化验证以 Vitest、Testing Library、fake-indexeddb、typecheck 为主，视觉验收使用实际扩展视口截图或真机观察。

## 3. 总体 Module 设计

### 3.1 Module 与 Interface

| Module                 | Interface                                                             | 隐藏的实现复杂度                                                        |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `TodoQueryService`     | `loadNavigation`、`queryTasks`、`getTaskDetail`、`getWorkspaceImpact` | 五表 join、范围过滤、归档过滤、日期视图、搜索 Checklist、计数、稳定排序 |
| `TaskService`          | Task 生命周期和归属命令                                               | 创建、字段更新、完成、移动、软删除、恢复、永久删除、Trash、容器顺序事务 |
| `TaskListService`      | Task List 生命周期命令                                                | 名称唯一、顺序、归档、恢复、永久删除守卫、Trash 归属降级                |
| `TaskTagService`       | Task Tag 生命周期命令                                                 | 名称唯一、颜色、顺序、删除 Assignment、每 Task 20 Tag 上限              |
| `ChecklistItemService` | Checklist Item 命令                                                   | 父 Task 校验、顺序、完成状态、级联删除                                  |
| `useTodoData`          | 页面需要的数据快照和用户命令                                          | 请求序列 guard、loading/error、写后刷新、跨 context 失效                |
| `useTodoView`          | 范围、视图、筛选、排序、选择和响应式状态                              | 视图回退规则、本机会话保持、UI 偏好读写                                 |
| `TodoPage`             | `active`、`onOpenMobilePrimaryNav`                                    | 三种断点组合、详情草稿提交门控、面板选择与导航                          |

不新增 Repository/Adapter 抽象。当前只有 IndexedDB 一个存储实现，额外 Repository seam 没有第二个 Adapter，不会增加实际可替换性。

### 3.2 调用方向

- React UI 只能调用 Zustand store 或纯展示 helper。
- Zustand store 调用 Service，不直接打开数据库事务。
- Mutation Service 负责事务、校验和广播。
- `TodoQueryService` 负责只读事务和展示投影。
- `database.ts` 只负责 schema、通用 CRUD、跨域级联和备份搬运，不放页面筛选逻辑。
- 纯排序、日期和文本匹配位于 `src/shared/tasks/`，由 `TodoQueryService` 调用并单测。

## 4. 领域类型

修改 `src/shared/types/index.ts`，新增以下类型。

### 4.1 枚举联合

- `TaskPriority = 'high' | 'medium' | 'low' | 'none'`
- `TaskStatus = 'active' | 'completed'`
- `TodoColor = 'gray' | 'red' | 'amber' | 'green' | 'cyan' | 'blue' | 'violet' | 'pink'`

### 4.2 Task List

`TaskList` 字段：

- `id: string`
- `workspaceId: string`
- `name: string`
- `normalizedName: string`
- `color: TodoColor`
- `order: number`
- `archivedAt: number | null`
- `createdAt: number`
- `updatedAt: number`

`archivedAt === null` 表示 active。不得同时增加 `archived: boolean`，避免双字段漂移。

### 4.3 Task

`Task` 字段：

- `id: string`
- `workspaceId: string`
- `listId: string | null`
- `containerKey: string`
- `title: string`
- `description: string`
- `priority: TaskPriority`
- `dueDate: string | null`
- `status: TaskStatus`
- `order: number`
- `completedAt: number | null`
- `deletedAt: number | null`
- `createdAt: number`
- `updatedAt: number`

约束：

- `containerKey` 由唯一 helper `taskContainerKey(workspaceId, listId)` 生成。
- helper 返回 `JSON.stringify([workspaceId, listId])`，Inbox 也得到稳定字符串键。
- 任何创建、同 Workspace 移动、跨 Workspace 移动和 Task List 永久删除都必须同步更新 `workspaceId`、`listId`、`containerKey` 和 `order`。
- `status === 'completed'` 时 `completedAt` 必须为 number；active 时必须为 null。
- `deletedAt` 与完成状态独立。
- `dueDate` 只接受真实本地日历日期 `YYYY-MM-DD`，不能只用正则检查月份和天数。

### 4.4 Checklist Item

`ChecklistItem` 字段：

- `id: string`
- `taskId: string`
- `text: string`
- `isCompleted: boolean`
- `completedAt: number | null`
- `order: number`
- `createdAt: number`
- `updatedAt: number`

父 Task 完成时不修改这些字段。

### 4.5 Task Tag

`TaskTag` 字段：

- `id: string`
- `workspaceId: string`
- `name: string`
- `normalizedName: string`
- `color: TodoColor`
- `order: number`
- `createdAt: number`
- `updatedAt: number`

`TaskTagAssignment` 字段：

- `taskId: string`
- `tagId: string`
- `createdAt: number`

Assignment 不增加 `workspaceId` 或随机 `id`。Workspace 从 Task 与 Task Tag 推导；对象表使用 `[taskId, tagId]` 复合主键保证关系唯一。

## 5. IndexedDB v7

### 5.1 版本

- `DB_VERSION` 从 6 升为 7。
- `runUpgrade` 增加 `oldVersion < 7` 分支。
- v7 只创建新 stores/indexes，不迁移现有记录。
- 升级回调不得调用 `getDB`、`putRecord` 或任何打开第二事务的 helper。

### 5.2 Stores 与索引

| Store                | keyPath           | Index                                                                                       |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `taskLists`          | `id`              | `by-workspaceId`; `by-workspaceId-normalizedName` = `[workspaceId, normalizedName]`, unique |
| `tasks`              | `id`              | `by-workspaceId`; `by-containerKey`; `by-listId`; `by-dueDate`; `by-deletedAt`              |
| `checklistItems`     | `id`              | `by-taskId`                                                                                 |
| `taskTags`           | `id`              | `by-workspaceId`; `by-workspaceId-normalizedName` = `[workspaceId, normalizedName]`, unique |
| `taskTagAssignments` | `[taskId, tagId]` | `by-taskId`; `by-tagId`                                                                     |

IndexedDB 限制：

- `null` 不是有效索引键。`listId = null`、`dueDate = null`、`deletedAt = null` 的记录不会出现在对应索引中。
- Inbox 查询和排序必须使用非空 `containerKey`，不能调用 `by-listId(null)`。
- `by-listId` 只用于真实 Task List 的引用查询和永久删除守卫。
- `by-dueDate` 只包含设置了 Due Date 的 Task。
- `by-deletedAt` 只包含 Trash 中的 Task。
- Task List/Task Tag 名称唯一同时由 unique compound index 和 Service 内中文错误转换保证；不能只扫描后写入，否则多 context 并发仍有 TOCTOU。

### 5.3 database.ts 类型与常量

必须同步扩展：

- `OctaneDB` 的 5 个 object store 声明。
- `StoreName` 的 5 个名称。
- `DbChangeEvent` 自动获得新 store union。
- `DATA_STORES` 加入 5 个待办表，用于全量覆盖清空。
- `ALL_STORES` 加入 5 个待办表，用于全量恢复事务。

`mergeImportRaw` 是例外：分享合并事务继续只打开现有书签相关 stores，绝不因为 `ALL_STORES` 扩展而触碰待办表。

### 5.4 Workspace 级联

扩展 `cascadeDeleteWorkspace` 的同一 readwrite transaction：

1. 通过 `tasks.by-workspaceId` 获取 Task IDs。
2. 删除每个 Task 的 Checklist Item 和 Assignment。
3. 删除 Tasks。
4. 删除该 Workspace 的 Task Lists 与 Task Tags。
5. 执行现有 Category、Bookmark、Context、Pinned Tab 和 Workspace 删除。
6. `tx.done` 后广播 `tasks`、`taskLists`、`taskTags` delete；现有广播保持。

任何一步失败时整个 Workspace 删除回滚。

## 6. 共享规则与纯函数

新增 `src/shared/tasks/taskRules.ts`：

- `normalizeTodoName(value)`：trim 后非空，返回显示名与 `toLowerCase` 规范名。
- `validateTaskTagName`：额外验证 32 字符上限。
- `validateDueDate`：解析年月日并验证重新格式化后仍等于输入。
- `taskContainerKey`：唯一生成容器键。
- `PRIORITY_RANK`：high 0、medium 1、low 2、none 3。
- `compareStableTaskOrder`：Workspace order、Inbox 优先、Task List order、Task order、createdAt、id。
- `isTaskDragEnabled`：只允许单 Workspace、单 Task List/Inbox、manual、无搜索筛选。

新增 `src/shared/tasks/taskQuery.ts`，只包含纯投影：

- `filterTasks`
- `sortTasksForView`
- `findTaskSearchMatch`
- `buildTaskCounts`
- `buildTaskRows`

所有日期函数显式接收 `today: string`，测试不依赖运行机器当天日期。

## 7. Query Module

新增 `src/services/TodoQueryService.ts`，这是 UI 和数据库之间的主要只读 seam。

### 7.1 输入类型

`WorkspaceScope`：

- `{ kind: 'workspace'; workspaceId: string }`
- `{ kind: 'all' }`

`TodoView`：

- `today`
- `next7`
- `inbox`
- `list`，带 `listId`
- `tag`，带 `tagId`
- `archivedList`，带 `listId`
- `trash`

`TaskQuery` 包含：

- scope
- view
- `status: 'active' | 'completed' | 'all'`
- `priority: TaskPriority | 'all'`
- search string
- `sort: 'manual' | 'dueDate' | 'priority' | 'createdAt'`
- today string

### 7.2 Interface

- `loadNavigation(scope, today): Promise<TodoNavigationSnapshot>`
- `queryTasks(query): Promise<TaskQueryResult>`
- `getTaskDetail(taskId): Promise<TaskDetail | null>`
- `getWorkspaceImpact(workspaceId): Promise<WorkspaceTodoImpact>`

`TodoNavigationSnapshot` 返回按 Workspace 分组的 Task Lists、Task Tags 和稳定计数。`TaskQueryResult` 返回 active/completed 分组、搜索摘要、总数和有效排序。`TaskDetail` 返回 Task、Checklist、Task Tags、所属 Workspace/Task List。

### 7.3 读取策略

- 单 Workspace 优先使用 `by-workspaceId`、`by-containerKey`、`by-listId` 等索引。
- 所有工作区模式允许在一个 readonly transaction 中读取五表并在内存投影。
- Tag 视图先读取 `taskTagAssignments.by-tagId`，再批量获取 Tasks。
- 文本搜索 Checklist 时，只读取候选 Task IDs 的 Checklist Item。
- 归档过滤始终读取 Task List 状态；不得在 Task 上增加冗余 `archived`。
- Query Module 不修改 store，不广播。

## 8. Mutation Services

### 8.1 TaskService

新增 `src/services/TaskService.ts`。

Interface：

- `createTask(input): Promise<Task>`
- `patchTask(taskId, patch): Promise<Task>`
- `setTaskCompletion(taskId, completed, options?): Promise<TaskCompletionResult>`
- `replaceTaskTags(taskId, tagIds): Promise<void>`
- `moveTask(input): Promise<Task>`
- `softDeleteTask(taskId): Promise<void>`
- `restoreTask(taskId): Promise<Task>`
- `deleteTaskPermanently(taskId): Promise<void>`
- `emptyTrash(scope): Promise<number>`
- `reorderTasks(workspaceId, listId, orderedIds): Promise<void>`

事务要求：

- 创建时验证 Workspace、active Task List、Task Tags 同 Workspace，并在 `tasks + taskTagAssignments` 单事务中写入。
- `patchTask` 只允许标题、描述、Priority、Due Date；同 Workspace Task List 移动也必须走 `moveTask`。
- `replaceTaskTags` 验证最多 20 个、无重复、全部与 Task 同 Workspace。
- `TaskCompletionResult` 是 `updated` 或 `confirmation-required` 联合。完成且仍有未完成 Checklist 时，默认返回数量且不写入；UI 确认后以 `allowIncompleteChecklist: true` 重试。事务内重新计数，避免确认与写入之间状态漂移。
- 取消完成不需要确认，并把 Task 追加到 active 容器末尾；Completed 分组默认按 completedAt 降序展示，不参与 active 手动拖拽。
- `moveTask` 同时更新 Workspace、listId、containerKey、目标末尾 order，并替换 Assignment；不按名称匹配 Tag。
- 软删除保留 listId、containerKey、order、Checklist 和 Assignment。
- 恢复时若原 Task List 不存在则改为 Inbox；不存在的 Assignment 在恢复事务中删除。
- 永久删除和 Empty Trash 级联 Checklist 与 Assignment。
- 重排只接受该容器全部未删除 active Task IDs，按 0..N 重编号；Completed Task 不参与 active 拖拽，UI 不得提交搜索、Priority 或其他筛选后的子集。

### 8.2 TaskListService

新增 `src/services/TaskListService.ts`。

Interface：

- `createTaskList(workspaceId, input): Promise<TaskList>`
- `updateTaskList(taskListId, patch): Promise<TaskList>`
- `archiveTaskList(taskListId, options?): Promise<TaskListArchiveResult>`
- `restoreTaskList(taskListId): Promise<TaskList>`
- `getTaskListDeleteImpact(taskListId): Promise<{ undeletedTaskCount: number; deletedTaskCount: number }>`
- `deleteTaskListPermanently(taskListId): Promise<void>`
- `reorderTaskLists(workspaceId, orderedIds): Promise<void>`

规则：

- 名称唯一冲突捕获 unique index 的 `ConstraintError`，转换为稳定中文错误。
- `TaskListArchiveResult` 是 `archived` 或 `confirmation-required` 联合。存在未完成 Task 时默认不写入并返回数量；UI 确认后以 `allowIncompleteTasks: true` 重试，事务内重新计数。
- 删除对话框先读取 impact；永久删除事务仍重新校验，有任何未删除 Task 时失败。
- 只有 Deleted Task 引用时，事务把它们移动到同 Workspace Inbox，更新 containerKey 和 Inbox 末尾 order，再删除 Task List。
- 恢复时尽量保留原 order；冲突时规范化到末尾。

### 8.3 TaskTagService

新增 `src/services/TaskTagService.ts`。

Interface：

- `createTaskTag(workspaceId, input): Promise<TaskTag>`
- `updateTaskTag(taskTagId, patch): Promise<TaskTag>`
- `getTaskTagDeleteImpact(taskTagId): Promise<{ affectedTaskCount: number }>`
- `deleteTaskTag(taskTagId): Promise<void>`
- `reorderTaskTags(workspaceId, orderedIds): Promise<void>`

删除事务只删除 Task Tag 和 Assignment，不修改 Task。

### 8.4 ChecklistItemService

新增 `src/services/ChecklistItemService.ts`。

Interface：

- `createChecklistItem(taskId, text): Promise<ChecklistItem>`
- `updateChecklistItem(itemId, text): Promise<ChecklistItem>`
- `setChecklistItemCompletion(itemId, completed): Promise<ChecklistItem>`
- `reorderChecklistItems(taskId, orderedIds): Promise<void>`
- `deleteChecklistItem(itemId): Promise<void>`

归档清单中的 Task 和 Deleted Task 在 Service 层拒绝修改 Checklist，不能只依赖 disabled UI。

## 9. Backup v6

### 9.1 数据形状

修改 `BackupData`，新增 5 个必填数组：

- `taskLists`
- `tasks`
- `checklistItems`
- `taskTags`
- `taskTagAssignments`

- `BACKUP_VERSION` 从 5 升为 6。
- `ACCEPTED_BACKUP_VERSIONS` 追加 6。
- v1-v5 文件缺少待办字段时规范化为 5 个空数组。
- v6 文件缺少任一待办数组时拒绝。

所有现有 `BackupData` 测试 fixture 必须显式补齐 5 个数组，避免可选字段把错误隐藏到运行时。

### 9.2 严格校验

v6 全量备份恢复前验证：

- 每个 Task List/Task Tag 的 Workspace 存在。
- Task 的 Workspace 存在；非 null Task List 存在且同 Workspace。
- containerKey 与 workspaceId/listId 重新计算结果一致。
- Priority、status、dueDate、时间字段和 order 合法。
- Checklist Item 的 Task 存在。
- Assignment 的 Task/Tag 存在且同 Workspace。
- Task Tag 每 Task 不超过 20 个。
- Task List/Task Tag 规范名在 Workspace 内唯一。
- v6 非法数据直接拒绝，不静默修复。

### 9.3 全量恢复

扩展：

- `exportAllData`
- `replaceAllDataRaw`
- `applyImport`
- `applyImport` 后的 task store 广播

写入顺序：Workspace → Task List/Task Tag → Task → Checklist/Assignment。所有业务表在同一 transaction 中 clear + put。

旧备份规范化出的空数组会清空当前全部待办，这是已确认行为。

### 9.4 分享包严格排除

- `buildShareData` 返回的 5 个待办数组固定为 `[]`。
- v6 `kind: 'share'` 如果携带非空待办数组则拒绝，不静默忽略。
- `applyShareImport`、`remapShareIds`、`mergeImportRaw` 不处理待办实体。
- 分享合并 transaction 不打开待办 stores。
- 接收方现有待办数据在分享导入成功和失败路径都保持逐字节不变。

### 9.5 恢复预览 Interface

扩展 `ValidationResult` 成功结果，保留：

- data
- kind
- version
- exportedAt
- appVersion
- `containsTodoData`
- `isLegacyWithoutTodo`

`useBackup` 不再只保存 `pendingData`，而是保存完整 `pendingBackup`。Local 与 Cloud 恢复确认显示备份时间、版本、是否包含待办，以及全库覆盖警告。

Cloud 的 `restoreFromCloud` 与 `restoreCloudVersion` 返回完整解析结果；`applyCloudRestore` 只接收确认后的 data。

## 10. Zustand 状态

### 10.1 useTodoData

新增 `src/store/useTodoData.ts`。

状态：

- `navigation: TodoNavigationSnapshot | null`
- `queryResult: TaskQueryResult | null`
- `detail: TaskDetail | null`
- `navigationLoading`、`queryLoading`、`detailLoading`
- `mutation: null | { kind; entityId? }`
- `invalidated: boolean`

Interface：

- `loadNavigation(scope, today)`
- `loadQuery(query)`
- `loadDetail(taskId)`
- `invalidate()`
- 对应 Mutation Service 的用户命令

每种 load 使用独立递增序列号。旧请求晚返回时不得覆盖新 Workspace、View 或 Task。

Mutation 成功后只刷新受影响的 navigation/query/detail；失败时恢复乐观快照并向 UI 抛错。拖拽是必须乐观更新并失败回滚的路径，其他写入可先持久化再刷新，避免过度复杂的多切片补丁。

### 10.2 useTodoView

新增 `src/store/useTodoView.ts`，只保存页面状态：

- `scopeMode: 'current' | 'all'`
- `view`
- `selectedTaskId`
- `statusFilter`
- `priorityFilter`
- `searchQuery`
- `sortMode`
- `mobileDetailOpen`
- `todoNavOpen`
- `detailSplitPercent`

规则：

- 新 New Tab 默认 current + today + active。
- 组件卸载后 Zustand 内存状态仍在，因此同一页面会话返回待办时恢复。
- 切 all 时若当前为具体 List/Tag，回到 today。
- App Rail Workspace 点击时强制 current，但保留 today、next7、inbox、trash 等系统视图；当前为具体 List、Tag 或 Archived List 时回到 today。清除不属于目标 Workspace 的 selected Task，主页面保持 tasks。
- Today/Next 7 固定 active。
- Trash 固定 deleted，Archived List 允许 active/completed/all。

### 10.3 UI 偏好

新增 `src/shared/todoUiPreferences.ts`，使用 `chrome.storage.local` 容错读写：

- `todo.detailSplitPercent`
- `todo.sortOverrides`

范围模式、当前视图、搜索和选中 Task 不持久化。UI 偏好不进入 BackupData。

## 11. Home 壳层与导航

### 11.1 App 主页面状态

修改 `src/entrypoints/home/App.tsx`：

- 使用局部 `activePage: 'home' | 'tasks'`，默认 home。
- 不新增 URL Router，也不为该状态建立持久化 store。
- 把现有 Sidebar + Content 标记提取为 `HomePageShell`，首次渲染后始终保留其 React subtree。
- 非激活页面使用 `hidden` 与 `inert` 隐藏并禁止焦点，而不是卸载；这样保留 Content 的本地视图、Tag 筛选和滚动状态。
- tasks 激活时显示 `TodoPage`，书签 Sidebar 不可见；TodoPage 可在首次访问时懒挂载，此后同样保留 subtree。
- 给 `Content` 增加 `active` prop，只在主页激活时注册或响应 `Ctrl/Cmd+K` 等全局键盘监听，隐藏页面不能抢焦点。
- 保留现有 workspace、bookmark、crypto 和 import effects；不为待办功能下沉或重构现有书签加载 effect。
- Import 事件额外调用 `useTodoData.invalidate()` 并清除无效 Task 选择。
- task stores 的 DB change 事件调用 `useTodoData.invalidate()`；TodoPage 挂载时或已挂载时重新加载。

### 11.2 AppRail Interface

修改 `AppRail` 为 props 驱动：

- `activePage`
- `onNavigate(page)`
- `onWorkspaceSelect(workspaceId)`

AppRail 不再直接拥有页面切换规则。App 的 `onWorkspaceSelect` 先执行现有 `switchWorkspace`，成功后若 activePage 为 tasks，则调用 `useTodoView.onWorkspaceSelected()`。

主页和待办按钮提供：

- `aria-label`
- `aria-current="page"`
- 互斥 `is-active`
- Tooltip

Workspace 按钮现有 loading、disabled 与 Tooltip 行为不变。

### 11.3 移动主导航

新增 `MobilePrimaryNavigation`，同时渲染于：

- Home 移动 Sidebar 顶部。
- TodoNavigation Sheet 顶部。

它只包含主页/待办页面切换，不复制 Workspace、Category 或 Todo 业务导航。

## 12. TodoPage 组合

新增目录 `src/entrypoints/home/components/TodoPage/`。

### 12.1 TodoPage

`index.tsx` 负责：

- 读取断点。
- 组合 TodoNavigation、TaskListPane、TaskDetailPane。
- 管理详情草稿提交门控。
- 切换范围/视图/Task 后触发 store load。
- 在本地日期跨午夜和页面重新可见时刷新 today/query/counts。

新增 `useLocalToday` hook：定时到下一个本地午夜，额外监听 `visibilitychange`，返回 `YYYY-MM-DD`。

### 12.2 TodoNavigation

内容：

- current/all 单选 ToggleGroup。
- 今天、未来 7 天、Inbox。
- active Task Lists。
- 已归档清单入口。
- Task Tags。
- Trash。
- 数量徽标。
- 创建、重命名、颜色、重排、归档、恢复和删除入口。

所有工作区模式按 Workspace 分组。创建 Task List/Task Tag 时 Workspace 字段可见并默认当前 Workspace。

### 12.3 TaskListPane

内容：

- 视图标题与结果数。
- 当前视图允许时的 active/completed/all 控件。
- Priority 筛选。
- 排序菜单。
- 当前视图内搜索。
- 条件式 Quick Add。
- ScrollArea 任务列表。
- 默认折叠 Completed 分组。
- dnd-kit 手动拖拽。

TaskRow 展示严格遵循产品规格，不加入卡片容器。Checkbox 事件必须阻止行点击冒泡。

完成当前选中 Task 后，active-only 视图从中栏移除该行但右栏保留完成详情，并提供撤销 Toast。软删除当前选中 Task 后清空详情，按“下一条优先、否则上一条”移动焦点，并提供调用 `restoreTask` 的撤销 Toast。

### 12.4 TaskDetailPane

内容：

- Empty 空状态。
- 标题草稿。
- 描述草稿。
- Workspace 归属和显式跨 Workspace Move Dialog。
- Task List Select。
- Task Tag Popover + Checkbox 多选。
- Priority 选项。
- 原生 `Input type="date"`，直接读写 `YYYY-MM-DD`，不增加日期库。
- 完成状态。
- Checklist CRUD 与重排。
- 删除、恢复、永久删除。
- 移动端返回。

归档清单中的 Task 与 Trash Task 渲染只读详情，只展示允许命令。

### 12.5 草稿提交 Interface

`TaskDetailPane` 暴露 `TaskDetailPaneHandle`：

- `commitDraft(): Promise<boolean>`
- `discardDraft(): void`
- `hasDirtyDraft(): boolean`

TodoPage 在选择其他 Task、关闭详情、移动端返回和切换视图前先调用 `commitDraft`。失败返回 false 时阻止导航并保留草稿；用户可重试或通过确认对话框放弃。

结构化字段立即保存，失败回滚并 Toast。标题/描述在 blur、`Ctrl/Cmd + Enter` 或导航前提交。慢写入超过 300ms 才显示 Spinner。

## 13. 三栏与响应式

### 13.1 组件

通过项目 package runner：

2026-08-03 已在基线提交执行 dry-run：

- `resizable` 新增 `src/components/ui/resizable.tsx` 和依赖 `react-resizable-panels`。
- `toggle-group` 新增 `src/components/ui/toggle.tsx`、`src/components/ui/toggle-group.tsx`，不增加第三方依赖。
- 两者都未引入 Radix 依赖，与当前 Base UI 项目配置兼容。

实施时先用 `--diff` 审查生成内容，再执行安装。新增源码后按 shadcn skill 检查组合、图标和 token。

### 13.2 断点

- `>=1200px`：240px TodoNavigation + 中右 Resizable；中最小 340px，右最小 380px。
- `761-1199px`：App Rail + TodoNavigation Sheet + 中右 Resizable；中最小 280px，右最小 360px。
- `<=760px`：App Rail 隐藏，导航 Sheet；列表与详情单面板替换。

新增 `useMediaQuery`，查询只使用 `max-width:760px` 和 `min-width:1200px`。CSS 使用完全相同的边界，避免 760/761 漂移。

### 13.3 分栏偏好

- 默认 50:50。
- `onLayoutChange` 保存百分比。
- 桌面与窄桌面按各自最小宽度夹紧。
- 双击 handle 重置 50:50。
- 方向键调整不属于首版验收；若底层组件原生提供，不禁用。

每个 pane 自己拥有 ScrollArea。TodoPage 根必须 `height: 100%; min-width: 0; overflow: hidden`。

## 14. 设计 token

先修改 `DESIGN.md`，再修改 `src/styles/tailwind-theme.css`，禁止在组件中裸写颜色。

新增 Priority token：

- high `#DC2626`
- medium `#B45309`
- low `#2563EB`
- none `#64748B`

新增 TodoColor palette：

- gray `#64748B`
- red `#DC2626`
- amber `#B45309`
- green `#007D63`
- cyan `#0E7490`
- blue `#2563EB`
- violet `#7C3AED`
- pink `#BE185D`

颜色只作辅助；列表选中、Priority、逾期和状态必须同时提供图标、文字或结构信号。

## 15. 文件清单

### 15.1 修改

- `src/shared/types/index.ts`
- `src/shared/db/database.ts`
- `src/services/BackupService.ts`
- `src/services/BackupMessaging.ts`，仅在消息类型元数据需要扩展时修改
- `src/services/WorkspaceService.ts`，保持删除入口，必要时暴露 impact 查询
- `src/store/useBackup.ts`
- `src/entrypoints/home/App.tsx`
- `src/entrypoints/home/App.css`
- `src/entrypoints/home/components/AppRail/index.tsx`
- `src/entrypoints/home/components/Content/index.tsx`，仅增加 inactive 键盘门控
- `src/entrypoints/home/components/ManagePanel/index.tsx`
- `src/components/backup/LocalBackupSection.tsx`
- `src/components/backup/CloudBackupSection.tsx`
- `src/styles/tailwind-theme.css`
- `DESIGN.md`
- 所有构造 `BackupData` 的测试 fixture

### 15.2 新增生产文件

- `src/shared/tasks/taskRules.ts`
- `src/shared/tasks/taskQuery.ts`
- `src/shared/tasks/todoColors.ts`
- `src/shared/todoUiPreferences.ts`
- `src/services/TodoQueryService.ts`
- `src/services/TaskService.ts`
- `src/services/TaskListService.ts`
- `src/services/TaskTagService.ts`
- `src/services/ChecklistItemService.ts`
- `src/store/useTodoData.ts`
- `src/store/useTodoView.ts`
- `src/entrypoints/home/hooks/useMediaQuery.ts`
- `src/entrypoints/home/hooks/useLocalToday.ts`
- `src/entrypoints/home/components/HomePageShell.tsx`
- `src/entrypoints/home/components/MobilePrimaryNavigation.tsx`
- `src/entrypoints/home/components/TodoPage/index.tsx`
- `src/entrypoints/home/components/TodoPage/index.module.css`
- `src/entrypoints/home/components/TodoPage/TodoNavigation.tsx`
- `src/entrypoints/home/components/TodoPage/TodoNavigation.module.css`
- `src/entrypoints/home/components/TodoPage/TaskListPane.tsx`
- `src/entrypoints/home/components/TodoPage/TaskListPane.module.css`
- `src/entrypoints/home/components/TodoPage/TaskRow.tsx`
- `src/entrypoints/home/components/TodoPage/TaskDetailPane.tsx`
- `src/entrypoints/home/components/TodoPage/TaskDetailPane.module.css`
- `src/entrypoints/home/components/TodoPage/QuickAddTask.tsx`
- `src/entrypoints/home/components/TodoPage/TaskMoveDialog.tsx`
- `src/entrypoints/home/components/TodoPage/TaskListDialog.tsx`
- `src/entrypoints/home/components/TodoPage/TaskTagDialog.tsx`
- shadcn 生成的 `src/components/ui/resizable.tsx`
- shadcn 生成的 `src/components/ui/toggle.tsx`
- shadcn 生成的 `src/components/ui/toggle-group.tsx`

文件可以在实现中进一步合并，但不得把事务逻辑移入 React 组件，也不得把五表原始数组全部暴露给每个组件。

## 16. TDD 与实施阶段

### 阶段 0：基线与依赖 spike

1. 运行 `pnpm run typecheck`、`pnpm run test`，记录基线。
2. 基于已确认的 dry-run 结果，用 `--diff` 再检查当前 registry 输出是否变化。
3. 不修改现有 warning，除非由本功能触发。

验证：基线双绿；`resizable` 仅新增 `react-resizable-panels`，Toggle Group 不引入 Radix。

### 阶段 1：类型、规则与 DB v7

先写失败测试：

- `src/shared/db/__tests__/db-migration-v7.test.ts`
- `src/shared/tasks/__tests__/taskRules.test.ts`
- 更新 `db-migration-regression.test.ts` 版本断言

再实现类型、helper、stores 和 indexes。

验证：v6 库升级后旧数据不变，五表存在且为空；新库 keyPath/index 与规格一致。

### 阶段 2：Mutation Services

逐个 Service 先测后写：

- `TaskListService.test.ts`
- `TaskTagService.test.ts`
- `ChecklistItemService.test.ts`
- `TaskService.test.ts`

验证：归属、唯一性、移动、排序、归档、Trash 和级联事务。

### 阶段 3：Query Module

先写 `taskQuery.test.ts` 与 `TodoQueryService.test.ts`，覆盖：

- current/all scope
- 今天/未来 7 天
- 归档和 Trash 排除
- 单 Tag
- Checklist 搜索摘要
- active/completed/all
- Priority 与稳定 tie-breaker
- 所有计数

### 阶段 4：Workspace 删除与 Backup v6

先扩展：

- `tests/db/database.test.ts`
- `BackupService.tasks.test.ts`
- `BackupService.applyImport.test.ts`
- `buildShareData.test.ts`
- `applyShareImport.test.ts`
- `tests/db/export-import.test.ts`
- Cloud/Local backup 组件测试

验证：

- Workspace 单事务级联五表。
- v6 全量往返。
- v1-v5 恢复清空待办并显示警告。
- v6 share 待办数组为空。
- 恶意非空 share 待办被拒绝。
- share 合并不读写接收方待办 stores。
- Cloud 成功往返和失败不改本地。

### 阶段 5：Zustand 与偏好

新增：

- `useTodoData.test.ts`
- `useTodoView.test.ts`
- `todoUiPreferences.test.ts`

验证请求序列 guard、视图回退、分栏/排序偏好和写后刷新。

### 阶段 6：Home/AppRail 接入

扩展现有：

- `AppRail/__tests__/index.test.tsx`
- `AppRail/__tests__/styles.test.ts`
- `App.broadcast.test.tsx`
- 新增 App 页面切换测试

验证主页/待办互斥、Workspace 点击退出 all、移动入口和导入失效。

### 阶段 7：TodoNavigation 与 TaskListPane

先写真实组件测试，再实现导航、计数、搜索、Quick Add、状态筛选、排序和拖拽。

验证只在允许条件下启用拖拽；搜索词非空和 completed/Trash/archived 时隐藏 Quick Add。

### 阶段 8：TaskDetailPane 与草稿

先写：

- `TaskDetailPane.test.tsx`
- `TaskDetailPane.autosave.test.tsx`
- Move/List/Tag dialog tests

验证字段保存、失败回滚、草稿保留、切换门控、Checklist 确认、只读归档/Trash 和移动原子性。

### 阶段 9：Responsive 与视觉

实现 Resizable、Sheet 和单面板切换。

验证实际扩展视口：1440、1200、1024、761、760、375px。检查无横向滚动、遮挡、文本溢出和布局位移；截图保存为实施验证产物，不提交临时截图，除非仓库后续建立固定视觉基线目录。

### 阶段 10：最终回归

必须执行：

- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run lint`
- `pnpm run build`

lint 现有 warning 可保留，但不得新增 warning。最终人工检查 App Rail、主页、书签 CRUD、Workspace 切换、Local/Cloud backup 和移动导航。

## 17. 测试规则

- 组件真实渲染 shadcn，不整体 mock UI 库。
- 使用 `userEvent`，禁止新增 `fireEvent`。
- 优先 `getByRole`、`getByText`、`getByPlaceholderText`。
- Toast 只 mock `@/components/ui/toast` 命令式边界。
- IndexedDB 用 fake-indexeddb，不 mock被测 Service。
- 日期测试注入 today、fake timer 和 timezone 场景。
- 事务失败测试在中途写入故障后验证全部表保持原状态。
- 广播测试验证 store 名和失效行为，不断言内部函数实现细节。

## 18. 完成定义

只有同时满足以下条件才可声明 Issue #72 实现完成：

- 产品规格全部“必须交付”行为可操作。
- 五表 schema、事务、归属和备份测试通过。
- v1-v5 与 v6 备份路径均验证。
- 分享包不携带、不解析、不导入待办实体。
- 当前/所有工作区、归档、Trash、Priority、Due Date、Checklist 的行为符合规格。
- 三种响应式模式在指定边界无布局问题。
- typecheck、test、lint、build 达到阶段 10 要求。
- 没有新增 LSP 或 pi-lens blocking diagnostics。
- 分隔线方向键调整仍是已知非阻塞可访问性风险，不得把它误报为已验收能力。

## 19. Stop Rules

实施过程中遇到以下情况必须暂停并回到产品决策，不得自行扩展：

- 需要让 Bookmark Tag 与 Task Tag 共用实体。
- 需要把待办加入 share package。
- 需要引入 reminder、repeat、Subtask、协作或实时同步。
- 需要改变 `listId = null` 的 Inbox 语义。
- 需要让归档清单中的 Task 重新进入活跃聚合。
- 需要让 Task 数据接入现有主密码加密。

纯实现问题由执行者自行处理，但必须保持本文 Module Interface、事务责任和验证契约。
