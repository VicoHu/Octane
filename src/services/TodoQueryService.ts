import type { IDBPTransaction } from 'idb';
import { getDB, type OctaneDB } from '@/shared/db/database';
import type { ChecklistItem, Task, TaskList, TaskPriority, TaskTag, Workspace } from '@/shared/types';
import {
  buildTaskCounts,
  buildTaskRows,
  filterTasks,
  sortTasksForView,
  type TaskCounts,
  type TaskProjection,
  type TaskRow,
  type TaskSort,
  type TaskStatusFilter,
  type TodoView,
  type WorkspaceScope,
} from '@/shared/tasks/taskQuery';
import { taskContainerKey } from '@/shared/tasks/taskRules';

export type {
  TaskCounts,
  TaskRow,
  TaskSort,
  TaskStatusFilter,
  TodoView,
  WorkspaceScope,
};

export interface TaskQuery {
  scope: WorkspaceScope;
  view: TodoView;
  status: TaskStatusFilter;
  priority: TaskPriority | 'all';
  search: string;
  sort: TaskSort;
  today: string;
}

export interface TodoNavigationGroup {
  workspace: Workspace;
  taskLists: TaskList[];
  taskTags: TaskTag[];
  counts: TaskCounts;
}

export interface TodoNavigationSnapshot {
  groups: TodoNavigationGroup[];
  counts: TaskCounts;
}

export interface TaskQueryResult {
  active: TaskRow[];
  completed: TaskRow[];
  total: number;
  effectiveSort: TaskSort;
}

export interface TaskDetail {
  task: Task;
  checklistItems: ChecklistItem[];
  taskTags: TaskTag[];
  workspace: Workspace;
  taskList: TaskList | null;
}

export interface WorkspaceTodoImpact {
  taskCount: number;
  activeTaskCount: number;
  completedTaskCount: number;
  deletedTaskCount: number;
  checklistItemCount: number;
  taskListCount: number;
  archivedTaskListCount: number;
  taskTagCount: number;
  taskTagAssignmentCount: number;
}

interface ScopeData {
  workspaces: Workspace[];
  taskLists: TaskList[];
  taskTags: TaskTag[];
}

type TodoStoreName = 'workspaces' | 'taskLists' | 'tasks' | 'checklistItems' | 'taskTags' | 'taskTagAssignments';
type TodoTransaction = IDBPTransaction<OctaneDB, TodoStoreName[], 'readonly'>;

function sortByOrder<T extends { order: number; id: string }>(records: T[]): T[] {
  return records.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 在同一只读事务中按 Scope 读取 Workspace、List 与 Tag。 */
async function readScopeDataFromTransaction(
  tx: TodoTransaction,
  scope: WorkspaceScope,
): Promise<ScopeData> {
  const workspaceStore = tx.objectStore('workspaces');
  const taskListStore = tx.objectStore('taskLists');
  const taskTagStore = tx.objectStore('taskTags');
  if (scope.kind === 'workspace') {
    const [workspace, taskLists, taskTags] = await Promise.all([
      workspaceStore.get(scope.workspaceId) as Promise<Workspace | undefined>,
      taskListStore.index('by-workspaceId').getAll(scope.workspaceId) as Promise<TaskList[]>,
      taskTagStore.index('by-workspaceId').getAll(scope.workspaceId) as Promise<TaskTag[]>,
    ]);
    return { workspaces: workspace ? [workspace] : [], taskLists: sortByOrder(taskLists), taskTags: sortByOrder(taskTags) };
  }
  const [workspaces, taskLists, taskTags] = await Promise.all([
    workspaceStore.getAll() as Promise<Workspace[]>,
    taskListStore.getAll() as Promise<TaskList[]>,
    taskTagStore.getAll() as Promise<TaskTag[]>,
  ]);
  return { workspaces: sortByOrder(workspaces), taskLists: sortByOrder(taskLists), taskTags: sortByOrder(taskTags) };
}

async function readTasksForView(
  tx: TodoTransaction,
  query: Pick<TaskQuery, 'scope' | 'view'>,
): Promise<Task[]> {
  const taskStore = tx.objectStore('tasks');
  if (query.view.kind === 'tag') {
    const assignments = await tx.objectStore('taskTagAssignments').index('by-tagId').getAll(query.view.tagId) as { taskId: string }[];
    const tasks = await Promise.all(assignments.map((assignment) => taskStore.get(assignment.taskId) as Promise<Task | undefined>));
    return tasks.filter((task): task is Task => task !== undefined && (
      query.scope.kind === 'all' || task.workspaceId === query.scope.workspaceId
    ));
  }
  if (query.scope.kind !== 'workspace') return taskStore.getAll() as Promise<Task[]>;
  if (query.view.kind === 'inbox') {
    return taskStore.index('by-containerKey').getAll(taskContainerKey(query.scope.workspaceId, null)) as Promise<Task[]>;
  }
  if (query.view.kind === 'list' || query.view.kind === 'archivedList') {
    return taskStore.index('by-listId').getAll(query.view.listId) as Promise<Task[]>;
  }
  return taskStore.index('by-workspaceId').getAll(query.scope.workspaceId) as Promise<Task[]>;
}

async function buildProjections(
  tx: TodoTransaction,
  scopeData: ScopeData,
  tasks: readonly Task[],
  withChecklistForTaskIds: ReadonlySet<string>,
): Promise<TaskProjection[]> {
  const workspacesById = new Map(scopeData.workspaces.map((workspace) => [workspace.id, workspace]));
  const listsById = new Map(scopeData.taskLists.map((list) => [list.id, list]));
  const tagsById = new Map(scopeData.taskTags.map((tag) => [tag.id, tag]));
  const assignmentStore = tx.objectStore('taskTagAssignments');
  const checklistStore = tx.objectStore('checklistItems');

  const records = await Promise.all(tasks.map(async (task) => {
    const [assignments, checklistItems] = await Promise.all([
      assignmentStore.index('by-taskId').getAll(task.id) as Promise<{ tagId: string }[]>,
      withChecklistForTaskIds.has(task.id)
        ? checklistStore.index('by-taskId').getAll(task.id) as Promise<ChecklistItem[]>
        : Promise.resolve([] as ChecklistItem[]),
    ]);
    const workspace = workspacesById.get(task.workspaceId);
    if (!workspace) return null;
    const taskTags = assignments
      .map((assignment) => tagsById.get(assignment.tagId))
      .filter((tag): tag is TaskTag => tag !== undefined);
    return {
      task,
      workspace,
      taskList: task.listId === null ? null : listsById.get(task.listId) ?? null,
      taskTags: sortByOrder(taskTags),
      checklistItems: checklistItems.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)),
    } satisfies TaskProjection;
  }));
  return records.filter((record): record is TaskProjection => record !== null);
}

function storesForQuery() {
  return ['workspaces', 'taskLists', 'tasks', 'checklistItems', 'taskTags', 'taskTagAssignments'] as const;
}

/** 读取按 Workspace 分组的导航实体及稳定数量徽标，不修改数据库。 */
export async function loadNavigation(scope: WorkspaceScope, today: string): Promise<TodoNavigationSnapshot> {
  const db = await getDB();
  const tx = db.transaction([...storesForQuery()], 'readonly');
  const scopeData = await readScopeDataFromTransaction(tx, scope);
  const tasks = scope.kind === 'workspace'
    ? await tx.objectStore('tasks').index('by-workspaceId').getAll(scope.workspaceId) as Task[]
    : await tx.objectStore('tasks').getAll() as Task[];
  const projections = await buildProjections(tx, scopeData, tasks, new Set());
  await tx.done;

  const groups = scopeData.workspaces.map((workspace) => {
    const workspaceTasks = projections.filter((projection) => projection.task.workspaceId === workspace.id);
    const taskLists = scopeData.taskLists.filter((list) => list.workspaceId === workspace.id);
    return {
      workspace,
      taskLists,
      taskTags: scopeData.taskTags.filter((tag) => tag.workspaceId === workspace.id),
      counts: buildTaskCounts(workspaceTasks, taskLists, today),
    };
  });
  return { groups, counts: buildTaskCounts(projections, scopeData.taskLists, today) };
}

/** 查询当前视图的任务行、搜索摘要与 active/completed 分组，不修改数据库。 */
export async function queryTasks(query: TaskQuery): Promise<TaskQueryResult> {
  const db = await getDB();
  const tx = db.transaction([...storesForQuery()], 'readonly');
  const scopeData = await readScopeDataFromTransaction(tx, query.scope);
  const tasks = await readTasksForView(tx, query);
  const partialProjections = await buildProjections(tx, scopeData, tasks, new Set());
  const candidates = filterTasks(partialProjections, { ...query, search: '' }, query.today);
  const projections = await buildProjections(tx, scopeData, candidates.map((candidate) => candidate.task), new Set(candidates.map((candidate) => candidate.task.id)));
  await tx.done;

  const filtered = filterTasks(projections, query, query.today);
  const active = filtered.filter((projection) => projection.task.status === 'active');
  const completed = filtered.filter((projection) => projection.task.status === 'completed');
  return {
    active: buildTaskRows(sortTasksForView(active, query.view, query.sort, query.today), query.search),
    completed: buildTaskRows(sortTasksForView(completed, query.view, query.sort, query.today, 'completed'), query.search),
    total: filtered.length,
    effectiveSort: query.sort,
  };
}

/** 返回 Task 详情所需的 Task、Checklist、Task Tag、Workspace 与 Task List。 */
export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const db = await getDB();
  const tx = db.transaction([...storesForQuery()], 'readonly');
  const task = await tx.objectStore('tasks').get(taskId) as Task | undefined;
  if (!task) {
    await tx.done;
    return null;
  }
  const [workspace, taskList, checklistItems, assignments] = await Promise.all([
    tx.objectStore('workspaces').get(task.workspaceId) as Promise<Workspace | undefined>,
    task.listId === null
      ? Promise.resolve(null)
      : tx.objectStore('taskLists').get(task.listId) as Promise<TaskList | undefined>,
    tx.objectStore('checklistItems').index('by-taskId').getAll(task.id) as Promise<ChecklistItem[]>,
    tx.objectStore('taskTagAssignments').index('by-taskId').getAll(task.id) as Promise<{ tagId: string }[]>,
  ]);
  const tags = await Promise.all(assignments.map((assignment) => tx.objectStore('taskTags').get(assignment.tagId) as Promise<TaskTag | undefined>));
  await tx.done;
  if (!workspace) return null;
  return {
    task,
    workspace,
    taskList: taskList ?? null,
    checklistItems: checklistItems.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1)),
    taskTags: sortByOrder(tags.filter((tag): tag is TaskTag => tag !== undefined)),
  };
}

/** 读取删除 Workspace 前确认框需要的待办影响数量，不修改数据库。 */
export async function getWorkspaceImpact(workspaceId: string): Promise<WorkspaceTodoImpact> {
  const db = await getDB();
  const tx = db.transaction([...storesForQuery()], 'readonly');
  const taskStore = tx.objectStore('tasks');
  const [tasks, taskLists, taskTags] = await Promise.all([
    taskStore.index('by-workspaceId').getAll(workspaceId) as Promise<Task[]>,
    tx.objectStore('taskLists').index('by-workspaceId').getAll(workspaceId) as Promise<TaskList[]>,
    tx.objectStore('taskTags').index('by-workspaceId').getAll(workspaceId) as Promise<TaskTag[]>,
  ]);
  const taskIds = new Set(tasks.map((task) => task.id));
  const [checklistGroups, assignmentGroups] = await Promise.all([
    Promise.all(tasks.map((task) => tx.objectStore('checklistItems').index('by-taskId').getAll(task.id) as Promise<ChecklistItem[]>)),
    Promise.all(tasks.map((task) => tx.objectStore('taskTagAssignments').index('by-taskId').getAll(task.id) as Promise<unknown[]>)),
  ]);
  await tx.done;
  return {
    taskCount: tasks.length,
    activeTaskCount: tasks.filter((task) => task.status === 'active' && task.deletedAt === null).length,
    completedTaskCount: tasks.filter((task) => task.status === 'completed' && task.deletedAt === null).length,
    deletedTaskCount: tasks.filter((task) => task.deletedAt !== null).length,
    checklistItemCount: checklistGroups.flat().filter((item) => taskIds.has(item.taskId)).length,
    taskListCount: taskLists.length,
    archivedTaskListCount: taskLists.filter((list) => list.archivedAt !== null).length,
    taskTagCount: taskTags.length,
    taskTagAssignmentCount: assignmentGroups.flat().length,
  };
}
