import type {
  ChecklistItem,
  Task,
  TaskList,
  TaskPriority,
  TaskTag,
  Workspace,
} from '@/shared/types';
import { PRIORITY_RANK, compareStableTaskOrder, type StableTaskOrderKey } from '@/shared/tasks/taskRules';

export type WorkspaceScope =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'all' };

export type TodoView =
  | { kind: 'today' }
  | { kind: 'next7' }
  | { kind: 'inbox' }
  | { kind: 'list'; listId: string }
  | { kind: 'tag'; tagId: string }
  | { kind: 'archivedList'; listId: string }
  | { kind: 'trash' };

export type TaskStatusFilter = 'active' | 'completed' | 'all';
export type TaskSort = 'manual' | 'dueDate' | 'priority' | 'createdAt';

/** 供纯查询函数使用的完整任务投影。 */
export interface TaskProjection {
  task: Task;
  workspace: Workspace;
  taskList: TaskList | null;
  taskTags: TaskTag[];
  checklistItems: ChecklistItem[];
}

export interface TaskFilterOptions {
  scope: WorkspaceScope;
  view: TodoView;
  status: TaskStatusFilter;
  priority: TaskPriority | 'all';
  search: string;
}

export interface TaskSearchMatch {
  source: 'title' | 'description' | 'checklist';
  /** 标题已在任务行中显示，其他命中才需要附加摘要。 */
  summary: string | null;
}

export interface TaskCounts {
  today: number;
  next7: number;
  inbox: number;
  trash: number;
  archivedLists: number;
  list: Record<string, number>;
  tag: Record<string, number>;
}

export interface TaskRow {
  id: string;
  task: Task;
  workspace: Workspace;
  taskList: TaskList | null;
  listName: string;
  taskTags: TaskTag[];
  hiddenTagCount: number;
  checklistCompletedCount: number;
  checklistTotalCount: number;
  searchMatch: TaskSearchMatch | null;
}

function plusDays(today: string, days: number): string {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

function isArchived(projection: TaskProjection): boolean {
  return projection.taskList?.archivedAt != null;
}

function stableKey(projection: TaskProjection): StableTaskOrderKey {
  return {
    workspaceOrder: projection.workspace.order,
    listId: projection.task.listId,
    listOrder: projection.taskList?.order ?? 0,
    order: projection.task.order,
    createdAt: projection.task.createdAt,
    id: projection.task.id,
  };
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePriority(a: TaskProjection, b: TaskProjection): number {
  return PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority];
}

function compareDueDate(a: TaskProjection, b: TaskProjection): number {
  if (a.task.dueDate === null) return b.task.dueDate === null ? 0 : 1;
  if (b.task.dueDate === null) return -1;
  return a.task.dueDate < b.task.dueDate ? -1 : a.task.dueDate > b.task.dueDate ? 1 : 0;
}

function compareCreatedAtAndId(a: TaskProjection, b: TaskProjection): number {
  return a.task.createdAt - b.task.createdAt || compareId(a.task.id, b.task.id);
}

/** 返回文本命中来源；search 为空时没有搜索摘要。 */
export function findTaskSearchMatch(
  projection: TaskProjection,
  search: string,
): TaskSearchMatch | null {
  const needle = search.trim().toLocaleLowerCase();
  if (needle === '') return null;
  if (projection.task.title.toLocaleLowerCase().includes(needle)) {
    return { source: 'title', summary: null };
  }
  if (projection.task.description.toLocaleLowerCase().includes(needle)) {
    return { source: 'description', summary: projection.task.description };
  }
  const matchingItem = projection.checklistItems.find((item) => item.text.toLocaleLowerCase().includes(needle));
  return matchingItem ? { source: 'checklist', summary: matchingItem.text } : null;
}

/** 按范围、视图、状态、优先级与文本搜索过滤已投影任务。 */
export function filterTasks(
  projections: readonly TaskProjection[],
  options: TaskFilterOptions,
  today: string,
): TaskProjection[] {
  const lastNext7Day = plusDays(today, 6);

  return projections.filter((projection) => {
    const { task } = projection;
    if (options.scope.kind === 'workspace' && task.workspaceId !== options.scope.workspaceId) return false;

    if (options.view.kind === 'trash') {
      if (task.deletedAt === null) return false;
    } else {
      if (task.deletedAt !== null) return false;
      if (options.view.kind === 'archivedList') {
        if (task.listId !== options.view.listId || !isArchived(projection)) return false;
      } else {
        if (isArchived(projection)) return false;
        if (options.view.kind === 'today' && (task.status !== 'active' || task.dueDate === null || task.dueDate > today)) return false;
        if (options.view.kind === 'next7' && (
          task.status !== 'active'
          || task.dueDate === null
          || task.dueDate < today
          || task.dueDate > lastNext7Day
        )) return false;
        if (options.view.kind === 'inbox' && task.listId !== null) return false;
        if (options.view.kind === 'list' && task.listId !== options.view.listId) return false;
        if (options.view.kind === 'tag') {
          const { tagId } = options.view;
          if (!projection.taskTags.some((tag) => tag.id === tagId)) return false;
        }
      }
    }

    const fixedActive = options.view.kind === 'today' || options.view.kind === 'next7';
    if (!fixedActive && options.view.kind !== 'trash' && options.status !== 'all' && task.status !== options.status) return false;
    if (options.priority !== 'all' && task.priority !== options.priority) return false;
    return options.search.trim() === '' || findTaskSearchMatch(projection, options.search) !== null;
  });
}

/** 依据视图和用户选择，以稳定 tie-breaker 排序任务投影。 */
export function sortTasksForView(
  projections: readonly TaskProjection[],
  view: TodoView,
  sort: TaskSort,
  today: string,
  group: 'active' | 'completed' = 'active',
): TaskProjection[] {
  const sorted = [...projections];
  if (group === 'completed') {
    return sorted.sort((a, b) => (
      (b.task.completedAt ?? 0) - (a.task.completedAt ?? 0)
      || compareStableTaskOrder(stableKey(a), stableKey(b))
    ));
  }

  if (view.kind === 'today') {
    return sorted.sort((a, b) => {
      const aOverdue = a.task.dueDate !== null && a.task.dueDate < today;
      const bOverdue = b.task.dueDate !== null && b.task.dueDate < today;
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      return comparePriority(a, b) || compareStableTaskOrder(stableKey(a), stableKey(b));
    });
  }

  if (view.kind === 'next7') {
    return sorted.sort((a, b) => (
      compareDueDate(a, b)
      || comparePriority(a, b)
      || compareStableTaskOrder(stableKey(a), stableKey(b))
    ));
  }

  if (view.kind === 'tag') {
    return sorted.sort((a, b) => (
      compareDueDate(a, b)
      || comparePriority(a, b)
      || compareCreatedAtAndId(a, b)
    ));
  }

  if (sort === 'priority') {
    return sorted.sort((a, b) => comparePriority(a, b) || compareStableTaskOrder(stableKey(a), stableKey(b)));
  }
  if (sort === 'dueDate') {
    return sorted.sort((a, b) => (
      compareDueDate(a, b)
      || comparePriority(a, b)
      || compareStableTaskOrder(stableKey(a), stableKey(b))
    ));
  }
  if (sort === 'createdAt') {
    return sorted.sort(compareCreatedAtAndId);
  }
  return sorted.sort((a, b) => compareStableTaskOrder(stableKey(a), stableKey(b)));
}

/** 构建不受中栏搜索、优先级或完成筛选影响的左栏计数。 */
export function buildTaskCounts(
  projections: readonly TaskProjection[],
  taskLists: readonly TaskList[],
  today: string,
): TaskCounts {
  const lastNext7Day = plusDays(today, 6);
  const counts: TaskCounts = {
    today: 0,
    next7: 0,
    inbox: 0,
    trash: 0,
    archivedLists: taskLists.filter((list) => list.archivedAt !== null).length,
    list: {},
    tag: {},
  };

  for (const projection of projections) {
    const { task } = projection;
    if (task.deletedAt !== null) {
      counts.trash += 1;
      continue;
    }
    if (task.status !== 'active' || isArchived(projection)) continue;

    if (task.dueDate !== null && task.dueDate <= today) counts.today += 1;
    if (task.dueDate !== null && task.dueDate >= today && task.dueDate <= lastNext7Day) counts.next7 += 1;
    if (task.listId === null) counts.inbox += 1;
    if (task.listId !== null) counts.list[task.listId] = (counts.list[task.listId] ?? 0) + 1;
    for (const tag of projection.taskTags) counts.tag[tag.id] = (counts.tag[tag.id] ?? 0) + 1;
  }

  return counts;
}

/** 将完整任务投影转换为中栏所需的扁平行数据。 */
export function buildTaskRows(
  projections: readonly TaskProjection[],
  search: string,
): TaskRow[] {
  return projections.map((projection) => {
    const checklistCompletedCount = projection.checklistItems.filter((item) => item.isCompleted).length;
    return {
      id: projection.task.id,
      task: projection.task,
      workspace: projection.workspace,
      taskList: projection.taskList,
      listName: projection.taskList?.name ?? '收集箱',
      taskTags: projection.taskTags.slice(0, 2),
      hiddenTagCount: Math.max(0, projection.taskTags.length - 2),
      checklistCompletedCount,
      checklistTotalCount: projection.checklistItems.length,
      searchMatch: findTaskSearchMatch(projection, search),
    };
  });
}
