import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/db/database', async (importActual) => {
  const actual = await importActual<typeof import('@/shared/db/database')>();
  return { ...actual, broadcastChange: vi.fn() };
});

import { broadcastChange, getDB, resetDB } from '@/shared/db/database';
import * as ChecklistItemService from '@/services/ChecklistItemService';
import type { ChecklistItem, Task, TaskList } from '@/shared/types';
import { taskContainerKey } from '@/shared/tasks/taskRules';

async function resetDatabase(): Promise<void> {
  try {
    const db = await getDB();
    db.close();
  } catch {
    // 尚未创建数据库时无需关闭。
  }
  resetDB();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('octane-db');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function putTask(overrides: Partial<Task> = {}): Promise<Task> {
  const task: Task = {
    id: overrides.id ?? 'task-1',
    workspaceId: 'workspace-1',
    listId: overrides.listId ?? null,
    containerKey: taskContainerKey('workspace-1', overrides.listId ?? null),
    title: '任务',
    description: '',
    priority: 'none',
    dueDate: null,
    status: 'active',
    order: 0,
    completedAt: null,
    deletedAt: overrides.deletedAt ?? null,
    createdAt: 1,
    updatedAt: 1,
  };
  const db = await getDB();
  await db.put('tasks', task);
  return task;
}

async function putTaskList(id: string, archivedAt: number | null): Promise<void> {
  const taskList: TaskList = {
    id,
    workspaceId: 'workspace-1',
    name: id,
    normalizedName: id,
    color: 'green',
    order: 0,
    archivedAt,
    createdAt: 1,
    updatedAt: 1,
  };
  const db = await getDB();
  await db.put('taskLists', taskList);
}

async function putItem(overrides: Partial<ChecklistItem> = {}): Promise<ChecklistItem> {
  const item: ChecklistItem = {
    id: overrides.id ?? 'item-1',
    taskId: overrides.taskId ?? 'task-1',
    text: overrides.text ?? '步骤',
    isCompleted: overrides.isCompleted ?? false,
    completedAt: overrides.completedAt ?? null,
    order: overrides.order ?? 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const db = await getDB();
  await db.put('checklistItems', item);
  return item;
}

beforeEach(() => vi.mocked(broadcastChange).mockReset());
afterEach(resetDatabase);

describe('ChecklistItemService', () => {
  it('创建、更新、完成和删除只修改 ChecklistItem，不改父 Task', async () => {
    const task = await putTask();
    const item = await ChecklistItemService.createChecklistItem(task.id, '第一步');
    expect(item).toMatchObject({ taskId: task.id, text: '第一步', order: 0, isCompleted: false, completedAt: null });

    const updated = await ChecklistItemService.updateChecklistItem(item.id, '改名步骤');
    expect(updated.text).toBe('改名步骤');
    const completed = await ChecklistItemService.setChecklistItemCompletion(item.id, true);
    expect(completed).toMatchObject({ isCompleted: true, completedAt: expect.any(Number) });

    const db = await getDB();
    expect(await db.get('tasks', task.id)).toEqual(task);
    await ChecklistItemService.deleteChecklistItem(item.id);
    expect(await db.get('checklistItems', item.id)).toBeUndefined();
    expect(broadcastChange).toHaveBeenCalledWith('checklistItems', 'put');
    expect(broadcastChange).toHaveBeenCalledWith('checklistItems', 'delete');
  });

  it('Service 层拒绝对 Deleted Task 与归档清单中的 Task 写 Checklist', async () => {
    await putTask({ id: 'deleted-task', deletedAt: 10 });
    await expect(ChecklistItemService.createChecklistItem('deleted-task', '不能写')).rejects.toThrow('已删除任务');

    await putTaskList('archived-list', 20);
    await putTask({ id: 'archived-task', listId: 'archived-list' });
    await expect(ChecklistItemService.createChecklistItem('archived-task', '不能写')).rejects.toThrow('已归档清单');
  });

  it('重排要求父 Task 存在且 ID 集合完整，失败不产生部分写入', async () => {
    await expect(ChecklistItemService.reorderChecklistItems('missing', [])).rejects.toThrow('任务不存在');

    await putTask();
    await putItem({ id: 'first', order: 0 });
    await putItem({ id: 'second', order: 1 });
    await expect(ChecklistItemService.reorderChecklistItems('task-1', ['second'])).rejects.toThrow('数量');

    const db = await getDB();
    expect((await db.get('checklistItems', 'first'))?.order).toBe(0);
    expect((await db.get('checklistItems', 'second'))?.order).toBe(1);

    await ChecklistItemService.reorderChecklistItems('task-1', ['second', 'first']);
    expect((await db.get('checklistItems', 'second'))?.order).toBe(0);
    expect((await db.get('checklistItems', 'first'))?.order).toBe(1);
  });
});
