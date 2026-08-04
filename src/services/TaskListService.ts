import { broadcastChange, getDB } from '@/shared/db/database';
import { taskContainerKey, normalizeTodoName } from '@/shared/tasks/taskRules';
import type { Task, TaskList, TodoColor } from '@/shared/types';
import { nextOrder, validateOrderedIds } from '@/shared/utils/order';

export interface TaskListInput {
  name: string;
  color: TodoColor;
}

export interface TaskListPatch {
  name?: string;
  color?: TodoColor;
}

export type TaskListArchiveResult =
  | { status: 'archived'; taskList: TaskList }
  | { status: 'confirmation-required'; incompleteCount: number };

function generateId(): string {
  return crypto.randomUUID();
}

function requireName(value: string): { name: string; normalizedName: string } {
  const normalized = normalizeTodoName(value);
  if (!normalized) throw new Error('清单名称不能为空');
  return normalized;
}

function isConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'ConstraintError';
}

function asTaskList(record: TaskList | undefined): TaskList {
  if (!record) throw new Error('清单不存在');
  return record;
}

/** 创建 Workspace 所属 Task List，名称唯一性由复合 unique index 最终保证。 */
export async function createTaskList(workspaceId: string, input: TaskListInput): Promise<TaskList> {
  const { name, normalizedName } = requireName(input.name);
  const db = await getDB();
  const tx = db.transaction(['workspaces', 'taskLists'], 'readwrite');

  try {
    const workspace = await tx.objectStore('workspaces').get(workspaceId);
    if (!workspace) throw new Error('工作区不存在');

    const store = tx.objectStore('taskLists');
    const existing = await store.index('by-workspaceId').getAll(workspaceId);
    const now = Date.now();
    const taskList: TaskList = {
      id: generateId(),
      workspaceId,
      name,
      normalizedName,
      color: input.color,
      order: nextOrder(existing),
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await store.put(taskList);
    await tx.done;
    broadcastChange('taskLists', 'put');
    return taskList;
  } catch (error) {
    await tx.done.catch(() => undefined);
    if (isConstraintError(error)) throw new Error('该工作区已存在同名清单');
    throw error;
  }
}

/** 更新 Task List 名称或颜色。 */
export async function updateTaskList(taskListId: string, patch: TaskListPatch): Promise<TaskList> {
  const nameUpdate = patch.name === undefined ? undefined : requireName(patch.name);
  const db = await getDB();
  const tx = db.transaction('taskLists', 'readwrite');

  try {
    const store = tx.objectStore('taskLists');
    const existing = asTaskList(await store.get(taskListId));
    const updated: TaskList = {
      ...existing,
      ...(nameUpdate ?? {}),
      ...(patch.color === undefined ? {} : { color: patch.color }),
      updatedAt: Date.now(),
    };
    await store.put(updated);
    await tx.done;
    broadcastChange('taskLists', 'put');
    return updated;
  } catch (error) {
    await tx.done.catch(() => undefined);
    if (isConstraintError(error)) throw new Error('该工作区已存在同名清单');
    throw error;
  }
}

/** 归档前在事务内统计未完成、未删除 Task；需要确认时不写入。 */
export async function archiveTaskList(
  taskListId: string,
  options: { allowIncompleteTasks?: boolean } = {},
): Promise<TaskListArchiveResult> {
  const db = await getDB();
  const tx = db.transaction(['taskLists', 'tasks'], 'readwrite');
  const taskListStore = tx.objectStore('taskLists');
  const taskStore = tx.objectStore('tasks');
  const taskList = asTaskList(await taskListStore.get(taskListId));
  const tasks = await taskStore.index('by-listId').getAll(taskListId);
  const incompleteCount = tasks.filter((task) => task.status === 'active' && task.deletedAt === null).length;

  if (incompleteCount > 0 && !options.allowIncompleteTasks) {
    await tx.done;
    return { status: 'confirmation-required', incompleteCount };
  }

  const updated: TaskList = { ...taskList, archivedAt: Date.now(), updatedAt: Date.now() };
  await taskListStore.put(updated);
  await tx.done;
  broadcastChange('taskLists', 'put');
  return { status: 'archived', taskList: updated };
}

/** 恢复 Task List；若原顺序已被 active 清单占用，追加到 active 末尾。 */
export async function restoreTaskList(taskListId: string): Promise<TaskList> {
  const db = await getDB();
  const tx = db.transaction('taskLists', 'readwrite');
  const store = tx.objectStore('taskLists');
  const taskList = asTaskList(await store.get(taskListId));
  const workspaceLists = await store.index('by-workspaceId').getAll(taskList.workspaceId);
  const activeLists = workspaceLists.filter((list) => list.id !== taskList.id && list.archivedAt === null);
  const orderConflict = activeLists.some((list) => list.order === taskList.order);
  const updated: TaskList = {
    ...taskList,
    archivedAt: null,
    order: orderConflict ? nextOrder(activeLists) : taskList.order,
    updatedAt: Date.now(),
  };
  await store.put(updated);
  await tx.done;
  broadcastChange('taskLists', 'put');
  return updated;
}

/** 获取永久删除确认框需要的关联 Task 数量。 */
export async function getTaskListDeleteImpact(
  taskListId: string,
): Promise<{ undeletedTaskCount: number; deletedTaskCount: number }> {
  const db = await getDB();
  const tx = db.transaction(['taskLists', 'tasks'], 'readonly');
  asTaskList(await tx.objectStore('taskLists').get(taskListId));
  const tasks = await tx.objectStore('tasks').index('by-listId').getAll(taskListId);
  await tx.done;
  return {
    undeletedTaskCount: tasks.filter((task) => task.deletedAt === null).length,
    deletedTaskCount: tasks.filter((task) => task.deletedAt !== null).length,
  };
}

/**
 * 永久删除空 Task List。Deleted Task 保留自身数据，但其原容器在同一事务中降级为 Inbox。
 */
export async function deleteTaskListPermanently(taskListId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['taskLists', 'tasks'], 'readwrite');
  const taskListStore = tx.objectStore('taskLists');
  const taskStore = tx.objectStore('tasks');
  const taskList = asTaskList(await taskListStore.get(taskListId));
  const referencedTasks = await taskStore.index('by-listId').getAll(taskListId);

  if (referencedTasks.some((task) => task.deletedAt === null)) {
    throw new Error('清单仍有未删除任务，不能永久删除');
  }

  const inboxKey = taskContainerKey(taskList.workspaceId, null);
  const inboxTasks = await taskStore.index('by-containerKey').getAll(inboxKey);
  let order = nextOrder(inboxTasks);
  const now = Date.now();
  for (const task of referencedTasks) {
    const updatedTask: Task = {
      ...task,
      listId: null,
      containerKey: inboxKey,
      order: order++,
      updatedAt: now,
    };
    await taskStore.put(updatedTask);
  }
  await taskListStore.delete(taskList.id);
  await tx.done;
  if (referencedTasks.length > 0) broadcastChange('tasks', 'put');
  broadcastChange('taskLists', 'delete');
}

/** 在同一 Workspace 内对 active/archived Task List 完整重编号。 */
export async function reorderTaskLists(workspaceId: string, orderedIds: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('taskLists', 'readwrite');
  const store = tx.objectStore('taskLists');
  const existing = await store.index('by-workspaceId').getAll(workspaceId);
  const error = validateOrderedIds(orderedIds, existing.map((taskList) => taskList.id));
  if (error) throw new Error(error);

  const byId = new Map(existing.map((taskList) => [taskList.id, taskList]));
  const now = Date.now();
  for (let index = 0; index < orderedIds.length; index++) {
    const taskList = byId.get(orderedIds[index]!)!;
    await store.put({ ...taskList, order: index, updatedAt: now });
  }
  await tx.done;
  broadcastChange('taskLists', 'put');
}
