import type { IDBPObjectStore, IDBPTransaction } from 'idb';
import { broadcastChange, getDB, type OctaneDB } from '@/shared/db/database';
import type { WorkspaceScope } from '@/services/TodoQueryService';
import { normalizeTodoName, taskContainerKey, validateDueDate } from '@/shared/tasks/taskRules';
import type { Task, TaskPriority, TaskTagAssignment } from '@/shared/types';
import { nextOrder, validateOrderedIds } from '@/shared/utils/order';

export interface CreateTaskInput {
  workspaceId: string;
  listId: string | null;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  tagIds?: string[];
}

export interface PatchTaskInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
}

export interface MoveTaskInput {
  taskId: string;
  workspaceId: string;
  listId: string | null;
  tagIds: string[];
}

export type TaskCompletionResult =
  | { status: 'updated'; task: Task }
  | { status: 'confirmation-required'; incompleteChecklistCount: number };

function generateId(): string {
  return crypto.randomUUID();
}

function asTask(record: Task | undefined): Task {
  if (!record) throw new Error('任务不存在');
  return record;
}

function requireTitle(value: string): string {
  const normalized = normalizeTodoName(value);
  if (!normalized) throw new Error('任务标题不能为空');
  return normalized.name;
}

function requireDueDate(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return value ?? null;
  if (!validateDueDate(value)) throw new Error('截止日期无效');
  return value;
}

function validateTagIds(tagIds: readonly string[]): void {
  if (tagIds.length > 20) throw new Error('每个任务最多关联 20 个标签');
  if (new Set(tagIds).size !== tagIds.length) throw new Error('任务标签不能重复');
}

type TaskServiceTransaction = IDBPTransaction<OctaneDB, string[], 'readwrite'>;
type AssignmentStore = IDBPObjectStore<OctaneDB, string[], 'taskTagAssignments', 'readwrite'>;
type ChecklistStore = IDBPObjectStore<OctaneDB, string[], 'checklistItems', 'readwrite'>;

async function validateTaskDestination(
  tx: TaskServiceTransaction,
  workspaceId: string,
  listId: string | null,
  tagIds: readonly string[],
): Promise<void> {
  validateTagIds(tagIds);
  const workspace = await tx.objectStore('workspaces').get(workspaceId);
  if (!workspace) throw new Error('工作区不存在');

  if (listId !== null) {
    const taskList = await tx.objectStore('taskLists').get(listId);
    if (!taskList || taskList.workspaceId !== workspaceId) throw new Error('清单不存在或不属于目标工作区');
    if (taskList.archivedAt !== null) throw new Error('已归档清单不能作为任务目标');
  }

  for (const tagId of tagIds) {
    const taskTag = await tx.objectStore('taskTags').get(tagId);
    if (!taskTag || taskTag.workspaceId !== workspaceId) throw new Error('标签不存在或不属于目标工作区');
  }
}

function activeUndeletedTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => task.status === 'active' && task.deletedAt === null);
}

async function replaceAssignments(
  assignmentStore: AssignmentStore,
  taskId: string,
  tagIds: readonly string[],
  createdAt: number,
): Promise<void> {
  const assignments = await assignmentStore.index('by-taskId').getAll(taskId) as TaskTagAssignment[];
  for (const assignment of assignments) await assignmentStore.delete([assignment.taskId, assignment.tagId]);
  for (const tagId of tagIds) await assignmentStore.put({ taskId, tagId, createdAt });
}

async function deleteTaskRelations(
  checklistStore: ChecklistStore,
  assignmentStore: AssignmentStore,
  taskId: string,
): Promise<void> {
  const [items, assignments] = await Promise.all([
    checklistStore.index('by-taskId').getAll(taskId),
    assignmentStore.index('by-taskId').getAll(taskId) as Promise<TaskTagAssignment[]>,
  ]);
  for (const item of items) await checklistStore.delete(item.id);
  for (const assignment of assignments) await assignmentStore.delete([assignment.taskId, assignment.tagId]);
}

/** 创建任务与其标签关联；归属和标签均在同一事务内验证。 */
export async function createTask(input: CreateTaskInput): Promise<Task> {
  const title = requireTitle(input.title);
  const dueDate = requireDueDate(input.dueDate);
  const tagIds = input.tagIds ?? [];
  validateTagIds(tagIds);
  const db = await getDB();
  const tx = db.transaction(['workspaces', 'taskLists', 'taskTags', 'tasks', 'taskTagAssignments'], 'readwrite');

  await validateTaskDestination(tx, input.workspaceId, input.listId, tagIds);
  const taskStore = tx.objectStore('tasks');
  const containerKey = taskContainerKey(input.workspaceId, input.listId);
  const existing = await taskStore.index('by-containerKey').getAll(containerKey) as Task[];
  const now = Date.now();
  const task: Task = {
    id: generateId(),
    workspaceId: input.workspaceId,
    listId: input.listId,
    containerKey,
    title,
    description: input.description ?? '',
    priority: input.priority ?? 'none',
    dueDate,
    status: 'active',
    order: nextOrder(activeUndeletedTasks(existing)),
    completedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await taskStore.put(task);
  for (const tagId of tagIds) await tx.objectStore('taskTagAssignments').put({ taskId: task.id, tagId, createdAt: now });
  await tx.done;
  broadcastChange('tasks', 'put');
  return task;
}

/** 修改任务的非归属字段。 */
export async function patchTask(taskId: string, patch: PatchTaskInput): Promise<Task> {
  const title = patch.title === undefined ? undefined : requireTitle(patch.title);
  const dueDate = patch.dueDate === undefined ? undefined : requireDueDate(patch.dueDate);
  const db = await getDB();
  const tx = db.transaction('tasks', 'readwrite');
  const store = tx.objectStore('tasks');
  const task = asTask(await store.get(taskId));
  const updated: Task = {
    ...task,
    ...(title === undefined ? {} : { title }),
    ...(patch.description === undefined ? {} : { description: patch.description }),
    ...(patch.priority === undefined ? {} : { priority: patch.priority }),
    ...(dueDate === undefined ? {} : { dueDate }),
    updatedAt: Date.now(),
  };
  await store.put(updated);
  await tx.done;
  broadcastChange('tasks', 'put');
  return updated;
}

/** 完成任务前检查未完成 Checklist；确认后在同一事务内完成。 */
export async function setTaskCompletion(
  taskId: string,
  completed: boolean,
  options: { allowIncompleteChecklist?: boolean } = {},
): Promise<TaskCompletionResult> {
  const db = await getDB();
  const tx = db.transaction(['tasks', 'checklistItems'], 'readwrite');
  const taskStore = tx.objectStore('tasks');
  const task = asTask(await taskStore.get(taskId));
  const now = Date.now();

  if (completed) {
    const items = await tx.objectStore('checklistItems').index('by-taskId').getAll(taskId);
    const incompleteChecklistCount = items.filter((item) => !item.isCompleted).length;
    if (incompleteChecklistCount > 0 && !options.allowIncompleteChecklist) {
      await tx.done;
      return { status: 'confirmation-required', incompleteChecklistCount };
    }
    const updated: Task = { ...task, status: 'completed', completedAt: now, updatedAt: now };
    await taskStore.put(updated);
    await tx.done;
    broadcastChange('tasks', 'put');
    return { status: 'updated', task: updated };
  }

  const existing = await taskStore.index('by-containerKey').getAll(task.containerKey) as Task[];
  const updated: Task = {
    ...task,
    status: 'active',
    completedAt: null,
    order: nextOrder(activeUndeletedTasks(existing.filter((candidate) => candidate.id !== task.id))),
    updatedAt: now,
  };
  await taskStore.put(updated);
  await tx.done;
  broadcastChange('tasks', 'put');
  return { status: 'updated', task: updated };
}

/** 用明确的目标标签集合替换任务全部标签关联。 */
export async function replaceTaskTags(taskId: string, tagIds: string[]): Promise<void> {
  validateTagIds(tagIds);
  const db = await getDB();
  const tx = db.transaction(['tasks', 'taskTags', 'taskTagAssignments'], 'readwrite');
  const task = asTask(await tx.objectStore('tasks').get(taskId));
  for (const tagId of tagIds) {
    const taskTag = await tx.objectStore('taskTags').get(tagId);
    if (!taskTag || taskTag.workspaceId !== task.workspaceId) throw new Error('标签不存在或不属于任务工作区');
  }
  await replaceAssignments(tx.objectStore('taskTagAssignments'), task.id, tagIds, Date.now());
  await tx.done;
  broadcastChange('tasks', 'put');
}

/** 移动任务到目标 Workspace/Task List，并原子替换标签关联。 */
export async function moveTask(input: MoveTaskInput): Promise<Task> {
  validateTagIds(input.tagIds);
  const db = await getDB();
  const tx = db.transaction(['workspaces', 'taskLists', 'taskTags', 'tasks', 'taskTagAssignments'], 'readwrite');
  const taskStore = tx.objectStore('tasks');
  const task = asTask(await taskStore.get(input.taskId));
  await validateTaskDestination(tx, input.workspaceId, input.listId, input.tagIds);
  const containerKey = taskContainerKey(input.workspaceId, input.listId);
  const existing = await taskStore.index('by-containerKey').getAll(containerKey) as Task[];
  const now = Date.now();
  const updated: Task = {
    ...task,
    workspaceId: input.workspaceId,
    listId: input.listId,
    containerKey,
    order: nextOrder(activeUndeletedTasks(existing.filter((candidate) => candidate.id !== task.id))),
    updatedAt: now,
  };
  await taskStore.put(updated);
  await replaceAssignments(tx.objectStore('taskTagAssignments'), task.id, input.tagIds, now);
  await tx.done;
  broadcastChange('tasks', 'put');
  return updated;
}

/** 将任务标记为 Deleted，保留其原有归属、顺序和关联。 */
export async function softDeleteTask(taskId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('tasks', 'readwrite');
  const store = tx.objectStore('tasks');
  const task = asTask(await store.get(taskId));
  await store.put({ ...task, deletedAt: Date.now(), updatedAt: Date.now() });
  await tx.done;
  broadcastChange('tasks', 'put');
}

/** 恢复 Deleted 任务；失效清单降级为 Inbox，失效标签关联在事务内清理。 */
export async function restoreTask(taskId: string): Promise<Task> {
  const db = await getDB();
  const tx = db.transaction(['taskLists', 'taskTags', 'tasks', 'taskTagAssignments'], 'readwrite');
  const taskStore = tx.objectStore('tasks');
  const task = asTask(await taskStore.get(taskId));
  let listId = task.listId;
  if (listId !== null) {
    const taskList = await tx.objectStore('taskLists').get(listId);
    if (!taskList || taskList.workspaceId !== task.workspaceId) listId = null;
  }
  const containerKey = taskContainerKey(task.workspaceId, listId);
  const existing = await taskStore.index('by-containerKey').getAll(containerKey) as Task[];
  const assignmentStore = tx.objectStore('taskTagAssignments');
  const assignments = await assignmentStore.index('by-taskId').getAll(task.id) as TaskTagAssignment[];
  for (const assignment of assignments) {
    const tag = await tx.objectStore('taskTags').get(assignment.tagId);
    if (!tag || tag.workspaceId !== task.workspaceId) await assignmentStore.delete([assignment.taskId, assignment.tagId]);
  }
  const updated: Task = {
    ...task,
    listId,
    containerKey,
    order: nextOrder(activeUndeletedTasks(existing.filter((candidate) => candidate.id !== task.id))),
    deletedAt: null,
    updatedAt: Date.now(),
  };
  await taskStore.put(updated);
  await tx.done;
  broadcastChange('tasks', 'put');
  return updated;
}

/** 永久删除任务及其 Checklist 与标签关联。 */
export async function deleteTaskPermanently(taskId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['tasks', 'checklistItems', 'taskTagAssignments'], 'readwrite');
  const taskStore = tx.objectStore('tasks');
  asTask(await taskStore.get(taskId));
  await deleteTaskRelations(tx.objectStore('checklistItems'), tx.objectStore('taskTagAssignments'), taskId);
  await taskStore.delete(taskId);
  await tx.done;
  broadcastChange('tasks', 'delete');
}

/** 永久清空指定范围中的 Deleted 任务及其关联数据。 */
export async function emptyTrash(scope: WorkspaceScope): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(['tasks', 'checklistItems', 'taskTagAssignments'], 'readwrite');
  const taskStore = tx.objectStore('tasks');
  const candidates = scope.kind === 'workspace'
    ? await taskStore.index('by-workspaceId').getAll(scope.workspaceId) as Task[]
    : await taskStore.getAll() as Task[];
  const deletedTasks = candidates.filter((task) => task.deletedAt !== null);
  for (const task of deletedTasks) {
    await deleteTaskRelations(tx.objectStore('checklistItems'), tx.objectStore('taskTagAssignments'), task.id);
    await taskStore.delete(task.id);
  }
  await tx.done;
  if (deletedTasks.length > 0) broadcastChange('tasks', 'delete');
  return deletedTasks.length;
}

/** 只对容器内所有未删除 active 任务进行完整重排。 */
export async function reorderTasks(workspaceId: string, listId: string | null, orderedIds: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('tasks', 'readwrite');
  const store = tx.objectStore('tasks');
  const existing = await store.index('by-containerKey').getAll(taskContainerKey(workspaceId, listId)) as Task[];
  const activeTasks = activeUndeletedTasks(existing);
  const error = validateOrderedIds(orderedIds, activeTasks.map((task) => task.id));
  if (error) throw new Error(error);

  const byId = new Map(activeTasks.map((task) => [task.id, task]));
  const now = Date.now();
  for (let index = 0; index < orderedIds.length; index++) {
    const task = byId.get(orderedIds[index]!)!;
    await store.put({ ...task, order: index, updatedAt: now });
  }
  await tx.done;
  broadcastChange('tasks', 'put');
}
