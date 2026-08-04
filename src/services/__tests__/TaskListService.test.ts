import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/db/database', async (importActual) => {
  const actual = await importActual<typeof import('@/shared/db/database')>();
  return { ...actual, broadcastChange: vi.fn() };
});

import { broadcastChange, getDB, resetDB } from '@/shared/db/database';
import * as TaskListService from '@/services/TaskListService';
import type { Task, TaskList, Workspace } from '@/shared/types';
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

async function putWorkspace(id = 'workspace-1'): Promise<Workspace> {
  const workspace: Workspace = { id, name: id, icon: 'W', createdAt: 1, order: 0 };
  const db = await getDB();
  await db.put('workspaces', workspace);
  return workspace;
}

async function putTaskList(overrides: Partial<TaskList> = {}): Promise<TaskList> {
  const taskList: TaskList = {
    id: overrides.id ?? 'list-1',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    name: overrides.name ?? '清单',
    normalizedName: overrides.normalizedName ?? (overrides.name ?? '清单').toLowerCase(),
    color: overrides.color ?? 'green',
    order: overrides.order ?? 0,
    archivedAt: overrides.archivedAt ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
  const db = await getDB();
  await db.put('taskLists', taskList);
  return taskList;
}

async function putTask(overrides: Partial<Task> = {}): Promise<Task> {
  const workspaceId = overrides.workspaceId ?? 'workspace-1';
  const listId = overrides.listId === undefined ? 'list-1' : overrides.listId;
  const task: Task = {
    id: overrides.id ?? 'task-1',
    workspaceId,
    listId,
    containerKey: overrides.containerKey ?? taskContainerKey(workspaceId, listId),
    title: overrides.title ?? '任务',
    description: '',
    priority: 'none',
    dueDate: null,
    status: overrides.status ?? 'active',
    order: overrides.order ?? 0,
    completedAt: null,
    deletedAt: overrides.deletedAt ?? null,
    createdAt: 1,
    updatedAt: 1,
  };
  const db = await getDB();
  await db.put('tasks', task);
  return task;
}

beforeEach(() => vi.mocked(broadcastChange).mockReset());
afterEach(resetDatabase);

describe('TaskListService', () => {
  it('创建时规范化名称、追加顺序，并在提交后广播', async () => {
    await putWorkspace();
    await putTaskList({ id: 'existing', name: '已有', normalizedName: '已有', order: 3 });
    const committedSnapshots: Promise<TaskList[]>[] = [];
    vi.mocked(broadcastChange).mockImplementation((store) => {
      if (store === 'taskLists') committedSnapshots.push(getDB().then((db) => db.getAll('taskLists')));
    });

    const taskList = await TaskListService.createTaskList('workspace-1', {
      name: '  收集箱外  ',
      color: 'blue',
    });

    expect(taskList).toMatchObject({
      workspaceId: 'workspace-1',
      name: '收集箱外',
      normalizedName: '收集箱外',
      color: 'blue',
      order: 4,
      archivedAt: null,
    });
    const db = await getDB();
    expect(await db.get('taskLists', taskList.id)).toEqual(taskList);
    expect(await committedSnapshots[0]).toEqual(expect.arrayContaining([taskList]));
    expect(broadcastChange).toHaveBeenCalledWith('taskLists', 'put');
  });

  it('更新名称和颜色时同步规范名与更新时间', async () => {
    await putWorkspace();
    const list = await putTaskList({ name: '旧名', normalizedName: '旧名', color: 'gray' });

    const updated = await TaskListService.updateTaskList(list.id, { name: '  新名  ', color: 'pink' });

    expect(updated).toMatchObject({ name: '新名', normalizedName: '新名', color: 'pink' });
    expect(updated.updatedAt).toBeGreaterThanOrEqual(list.updatedAt);
  });

  it('同 Workspace 同规范名触发唯一索引时转为稳定中文错误且不留下部分记录', async () => {
    await putWorkspace();
    await TaskListService.createTaskList('workspace-1', { name: '项目', color: 'green' });

    await expect(
      TaskListService.createTaskList('workspace-1', { name: '  项目  ', color: 'red' }),
    ).rejects.toThrow('该工作区已存在同名清单');

    const db = await getDB();
    expect(await db.count('taskLists')).toBe(1);
    expect(broadcastChange).toHaveBeenCalledTimes(1);
  });

  it('归档含未完成任务的清单先要求确认，确认后在事务内归档', async () => {
    await putWorkspace();
    const list = await putTaskList();
    await putTask({ listId: list.id, status: 'active' });

    await expect(TaskListService.archiveTaskList(list.id)).resolves.toEqual({
      status: 'confirmation-required',
      incompleteCount: 1,
    });
    const db = await getDB();
    expect((await db.get('taskLists', list.id))?.archivedAt).toBeNull();

    const result = await TaskListService.archiveTaskList(list.id, { allowIncompleteTasks: true });
    expect(result.status).toBe('archived');
    expect(result.status === 'archived' && result.taskList.archivedAt).toEqual(expect.any(Number));
    expect(broadcastChange).toHaveBeenCalledWith('taskLists', 'put');
  });

  it('永久删除拒绝未删除任务；只有 Deleted Task 时原子迁移到 Inbox 再删除清单', async () => {
    await putWorkspace();
    const list = await putTaskList();
    await putTask({ id: 'active', listId: list.id, deletedAt: null });

    await expect(TaskListService.deleteTaskListPermanently(list.id)).rejects.toThrow('仍有未删除任务');
    const db = await getDB();
    expect(await db.get('taskLists', list.id)).toBeDefined();

    await db.delete('tasks', 'active');
    await putTask({ id: 'inbox-existing', listId: null, containerKey: taskContainerKey('workspace-1', null), order: 4 });
    await putTask({ id: 'deleted-a', listId: list.id, deletedAt: 10, order: 0 });
    await putTask({ id: 'deleted-b', listId: list.id, deletedAt: 11, order: 1 });

    await expect(TaskListService.getTaskListDeleteImpact(list.id)).resolves.toEqual({
      undeletedTaskCount: 0,
      deletedTaskCount: 2,
    });
    await TaskListService.deleteTaskListPermanently(list.id);

    expect(await db.get('taskLists', list.id)).toBeUndefined();
    expect(await db.get('tasks', 'deleted-a')).toMatchObject({
      listId: null,
      containerKey: taskContainerKey('workspace-1', null),
      order: 5,
    });
    expect(await db.get('tasks', 'deleted-b')).toMatchObject({ order: 6 });
    expect(broadcastChange).toHaveBeenCalledWith('tasks', 'put');
    expect(broadcastChange).toHaveBeenCalledWith('taskLists', 'delete');
  });

  it('恢复发生顺序冲突时把清单放到 active 末尾；重排拒绝不完整集合且不部分写入', async () => {
    await putWorkspace();
    const archived = await putTaskList({ id: 'archived', name: '归档', normalizedName: '归档', order: 1, archivedAt: 10 });
    await putTaskList({ id: 'active', name: '活跃', normalizedName: '活跃', order: 1 });
    await putTaskList({ id: 'other', name: '其他', normalizedName: '其他', order: 3 });

    const restored = await TaskListService.restoreTaskList(archived.id);
    expect(restored).toMatchObject({ archivedAt: null, order: 4 });

    await expect(TaskListService.reorderTaskLists('workspace-1', ['active', 'archived'])).rejects.toThrow('数量');
    const db = await getDB();
    expect((await db.get('taskLists', 'active'))?.order).toBe(1);
    expect((await db.get('taskLists', 'archived'))?.order).toBe(4);
  });
});
