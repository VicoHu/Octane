import type { IDBPObjectStore } from 'idb';
import { broadcastChange, getDB, type OctaneDB } from '@/shared/db/database';
import type { ChecklistItem, Task } from '@/shared/types';
import { nextOrder, validateOrderedIds } from '@/shared/utils/order';

type TaskStore = IDBPObjectStore<OctaneDB, string[], 'tasks', 'readwrite'>;
type TaskListStore = IDBPObjectStore<OctaneDB, string[], 'taskLists', 'readwrite'>;

function generateId(): string {
  return crypto.randomUUID();
}

async function getEditableTask(
  taskStore: TaskStore,
  taskListStore: TaskListStore,
  taskId: string,
): Promise<Task> {
  const task = await taskStore.get(taskId);
  if (!task) throw new Error('任务不存在');
  if (task.deletedAt !== null) throw new Error('已删除任务不能编辑检查项');
  if (task.listId !== null) {
    const taskList = await taskListStore.get(task.listId);
    if (taskList && taskList.archivedAt !== null) {
      throw new Error('已归档清单中的任务不能编辑检查项');
    }
  }
  return task;
}

function asChecklistItem(record: ChecklistItem | undefined): ChecklistItem {
  if (!record) throw new Error('检查项不存在');
  return record;
}

/** 创建 Checklist Item，追加到可编辑父 Task 的末尾。 */
export async function createChecklistItem(taskId: string, text: string): Promise<ChecklistItem> {
  const db = await getDB();
  const tx = db.transaction(['tasks', 'taskLists', 'checklistItems'], 'readwrite');
  const taskStore = tx.objectStore('tasks');
  const taskListStore = tx.objectStore('taskLists');
  const itemStore = tx.objectStore('checklistItems');
  await getEditableTask(taskStore, taskListStore, taskId);
  const existing = await itemStore.index('by-taskId').getAll(taskId);
  const now = Date.now();
  const item: ChecklistItem = {
    id: generateId(),
    taskId,
    text,
    isCompleted: false,
    completedAt: null,
    order: nextOrder(existing),
    createdAt: now,
    updatedAt: now,
  };
  await itemStore.put(item);
  await tx.done;
  broadcastChange('checklistItems', 'put');
  return item;
}

/** 修改 Checklist Item 文本，仍受父 Task 可编辑规则约束。 */
export async function updateChecklistItem(itemId: string, text: string): Promise<ChecklistItem> {
  const db = await getDB();
  const tx = db.transaction(['tasks', 'taskLists', 'checklistItems'], 'readwrite');
  const taskStore = tx.objectStore('tasks');
  const taskListStore = tx.objectStore('taskLists');
  const itemStore = tx.objectStore('checklistItems');
  const item = asChecklistItem(await itemStore.get(itemId));
  await getEditableTask(taskStore, taskListStore, item.taskId);
  const updated: ChecklistItem = { ...item, text, updatedAt: Date.now() };
  await itemStore.put(updated);
  await tx.done;
  broadcastChange('checklistItems', 'put');
  return updated;
}

/** 切换 Checklist Item 完成状态，不修改父 Task。 */
export async function setChecklistItemCompletion(
  itemId: string,
  completed: boolean,
): Promise<ChecklistItem> {
  const db = await getDB();
  const tx = db.transaction(['tasks', 'taskLists', 'checklistItems'], 'readwrite');
  const taskStore = tx.objectStore('tasks');
  const taskListStore = tx.objectStore('taskLists');
  const itemStore = tx.objectStore('checklistItems');
  const item = asChecklistItem(await itemStore.get(itemId));
  await getEditableTask(taskStore, taskListStore, item.taskId);
  const updated: ChecklistItem = {
    ...item,
    isCompleted: completed,
    completedAt: completed ? Date.now() : null,
    updatedAt: Date.now(),
  };
  await itemStore.put(updated);
  await tx.done;
  broadcastChange('checklistItems', 'put');
  return updated;
}

/** 仅对可编辑父 Task 的完整 Checklist Item 集合进行重排。 */
export async function reorderChecklistItems(taskId: string, orderedIds: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['tasks', 'taskLists', 'checklistItems'], 'readwrite');
  const taskStore = tx.objectStore('tasks');
  const taskListStore = tx.objectStore('taskLists');
  const itemStore = tx.objectStore('checklistItems');
  await getEditableTask(taskStore, taskListStore, taskId);
  const existing = await itemStore.index('by-taskId').getAll(taskId);
  const error = validateOrderedIds(orderedIds, existing.map((item) => item.id));
  if (error) throw new Error(error);

  const byId = new Map(existing.map((item) => [item.id, item]));
  const now = Date.now();
  for (let index = 0; index < orderedIds.length; index++) {
    const item = byId.get(orderedIds[index]!)!;
    await itemStore.put({ ...item, order: index, updatedAt: now });
  }
  await tx.done;
  broadcastChange('checklistItems', 'put');
}

/** 删除可编辑父 Task 下的 Checklist Item。 */
export async function deleteChecklistItem(itemId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['tasks', 'taskLists', 'checklistItems'], 'readwrite');
  const taskStore = tx.objectStore('tasks');
  const taskListStore = tx.objectStore('taskLists');
  const itemStore = tx.objectStore('checklistItems');
  const item = asChecklistItem(await itemStore.get(itemId));
  await getEditableTask(taskStore, taskListStore, item.taskId);
  await itemStore.delete(item.id);
  await tx.done;
  broadcastChange('checklistItems', 'delete');
}
