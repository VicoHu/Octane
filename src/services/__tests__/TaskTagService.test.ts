import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/db/database', async (importActual) => {
  const actual = await importActual<typeof import('@/shared/db/database')>();
  return { ...actual, broadcastChange: vi.fn() };
});

import { broadcastChange, getDB, resetDB } from '@/shared/db/database';
import * as TaskTagService from '@/services/TaskTagService';
import type { Task, TaskTag, Workspace } from '@/shared/types';
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

async function putWorkspace(id = 'workspace-1'): Promise<void> {
  const db = await getDB();
  await db.put('workspaces', { id, name: id, icon: 'W', createdAt: 1, order: 0 } satisfies Workspace);
}

async function putTaskTag(overrides: Partial<TaskTag> = {}): Promise<TaskTag> {
  const tag: TaskTag = {
    id: overrides.id ?? 'tag-1',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    name: overrides.name ?? '标签',
    normalizedName: overrides.normalizedName ?? (overrides.name ?? '标签').toLowerCase(),
    color: overrides.color ?? 'green',
    order: overrides.order ?? 0,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
  const db = await getDB();
  await db.put('taskTags', tag);
  return tag;
}

async function putTask(id: string, deletedAt: number | null): Promise<void> {
  const task: Task = {
    id,
    workspaceId: 'workspace-1',
    listId: null,
    containerKey: taskContainerKey('workspace-1', null),
    title: id,
    description: '',
    priority: 'none',
    dueDate: null,
    status: 'active',
    order: 0,
    completedAt: null,
    deletedAt,
    createdAt: 1,
    updatedAt: 1,
  };
  const db = await getDB();
  await db.put('tasks', task);
}

beforeEach(() => vi.mocked(broadcastChange).mockReset());
afterEach(resetDatabase);

describe('TaskTagService', () => {
  it('创建时规范化名称并拒绝超过 32 字符的名称', async () => {
    await putWorkspace();

    const tag = await TaskTagService.createTaskTag('workspace-1', { name: '  紧急  ', color: 'red' });
    expect(tag).toMatchObject({ name: '紧急', normalizedName: '紧急', order: 0, color: 'red' });
    await expect(
      TaskTagService.createTaskTag('workspace-1', { name: 'a'.repeat(33), color: 'blue' }),
    ).rejects.toThrow('最多 32 个字符');
    expect(broadcastChange).toHaveBeenCalledWith('taskTags', 'put');
  });

  it('更新名称和颜色时同步规范名', async () => {
    await putWorkspace();
    const tag = await putTaskTag({ name: '旧标签', normalizedName: '旧标签', color: 'gray' });

    await expect(
      TaskTagService.updateTaskTag(tag.id, { name: '  新标签  ', color: 'violet' }),
    ).resolves.toMatchObject({ name: '新标签', normalizedName: '新标签', color: 'violet' });
  });

  it('同 Workspace 同规范名触发唯一索引时转换中文错误且不部分写入', async () => {
    await putWorkspace();
    await TaskTagService.createTaskTag('workspace-1', { name: '工作', color: 'green' });

    await expect(
      TaskTagService.createTaskTag('workspace-1', { name: ' 工作 ', color: 'pink' }),
    ).rejects.toThrow('该工作区已存在同名标签');
    const db = await getDB();
    expect(await db.count('taskTags')).toBe(1);
  });

  it('删除只删除 Tag 和 Assignment，保留 Task，并只统计未删除关联任务', async () => {
    await putWorkspace();
    const tag = await putTaskTag();
    await putTask('active-task', null);
    await putTask('deleted-task', 10);
    const db = await getDB();
    await db.put('taskTagAssignments', { taskId: 'active-task', tagId: tag.id, createdAt: 1 });
    await db.put('taskTagAssignments', { taskId: 'deleted-task', tagId: tag.id, createdAt: 1 });

    await expect(TaskTagService.getTaskTagDeleteImpact(tag.id)).resolves.toEqual({ affectedTaskCount: 1 });
    await TaskTagService.deleteTaskTag(tag.id);

    expect(await db.get('taskTags', tag.id)).toBeUndefined();
    expect(await db.get('taskTagAssignments', ['active-task', tag.id])).toBeUndefined();
    expect(await db.get('taskTagAssignments', ['deleted-task', tag.id])).toBeUndefined();
    expect(await db.get('tasks', 'active-task')).toMatchObject({ deletedAt: null });
    expect(await db.get('tasks', 'deleted-task')).toMatchObject({ deletedAt: 10 });
    expect(broadcastChange).toHaveBeenCalledWith('taskTags', 'delete');
    expect(broadcastChange).not.toHaveBeenCalledWith('taskTagAssignments', 'delete');
  });

  it('重排只接受该 Workspace 完整集合，非法输入不产生部分写入', async () => {
    await putWorkspace();
    await putTaskTag({ id: 'first', name: '第一', normalizedName: '第一', order: 0 });
    await putTaskTag({ id: 'second', name: '第二', normalizedName: '第二', order: 1 });

    await expect(TaskTagService.reorderTaskTags('workspace-1', ['second'])).rejects.toThrow('数量');
    const db = await getDB();
    expect((await db.get('taskTags', 'first'))?.order).toBe(0);
    expect((await db.get('taskTags', 'second'))?.order).toBe(1);

    await TaskTagService.reorderTaskTags('workspace-1', ['second', 'first']);
    expect((await db.get('taskTags', 'second'))?.order).toBe(0);
    expect((await db.get('taskTags', 'first'))?.order).toBe(1);
  });
});
