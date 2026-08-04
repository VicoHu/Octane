import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/db/database', async (importActual) => {
  const actual = await importActual<typeof import('@/shared/db/database')>();
  return { ...actual, broadcastChange: vi.fn() };
});

import * as TaskService from '@/services/TaskService';
import { broadcastChange, getDB, resetDB } from '@/shared/db/database';
import { taskContainerKey } from '@/shared/tasks/taskRules';
import type { ChecklistItem, Task, TaskList, TaskTag, TaskTagAssignment, Workspace } from '@/shared/types';

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
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

async function putWorkspace(id = 'workspace-1'): Promise<Workspace> {
  const workspace: Workspace = { id, name: id, icon: 'W', createdAt: 1, order: 0 };
  const db = await getDB();
  await db.put('workspaces', workspace);
  return workspace;
}

async function putList(overrides: Partial<TaskList> = {}): Promise<TaskList> {
  const taskList: TaskList = {
    id: overrides.id ?? 'list-1', workspaceId: overrides.workspaceId ?? 'workspace-1',
    name: overrides.name ?? '清单', normalizedName: overrides.normalizedName ?? '清单', color: overrides.color ?? 'green',
    order: overrides.order ?? 0, archivedAt: overrides.archivedAt ?? null, createdAt: 1, updatedAt: 1,
  };
  const db = await getDB();
  await db.put('taskLists', taskList);
  return taskList;
}

async function putTag(overrides: Partial<TaskTag> = {}): Promise<TaskTag> {
  const taskTag: TaskTag = {
    id: overrides.id ?? 'tag-1', workspaceId: overrides.workspaceId ?? 'workspace-1', name: overrides.name ?? '标签',
    normalizedName: overrides.normalizedName ?? '标签', color: overrides.color ?? 'green', order: overrides.order ?? 0,
    createdAt: 1, updatedAt: 1,
  };
  const db = await getDB();
  await db.put('taskTags', taskTag);
  return taskTag;
}

async function putTask(overrides: Partial<Task> = {}): Promise<Task> {
  const workspaceId = overrides.workspaceId ?? 'workspace-1';
  const listId = overrides.listId === undefined ? null : overrides.listId;
  const task: Task = {
    id: overrides.id ?? 'task-1', workspaceId, listId,
    containerKey: overrides.containerKey ?? taskContainerKey(workspaceId, listId), title: overrides.title ?? '任务',
    description: overrides.description ?? '', priority: overrides.priority ?? 'none', dueDate: overrides.dueDate ?? null,
    status: overrides.status ?? 'active', order: overrides.order ?? 0, completedAt: overrides.completedAt ?? null,
    deletedAt: overrides.deletedAt ?? null, createdAt: overrides.createdAt ?? 1, updatedAt: overrides.updatedAt ?? 1,
  };
  const db = await getDB();
  await db.put('tasks', task);
  return task;
}

async function putChecklistItem(overrides: Partial<ChecklistItem> = {}): Promise<ChecklistItem> {
  const item: ChecklistItem = {
    id: overrides.id ?? 'item-1', taskId: overrides.taskId ?? 'task-1', text: overrides.text ?? '步骤',
    isCompleted: overrides.isCompleted ?? false, completedAt: overrides.completedAt ?? null, order: overrides.order ?? 0,
    createdAt: 1, updatedAt: 1,
  };
  const db = await getDB();
  await db.put('checklistItems', item);
  return item;
}

async function putAssignment(taskId: string, tagId: string): Promise<TaskTagAssignment> {
  const assignment = { taskId, tagId, createdAt: 1 };
  const db = await getDB();
  await db.put('taskTagAssignments', assignment);
  return assignment;
}

beforeEach(() => vi.mocked(broadcastChange).mockReset());
afterEach(resetDatabase);

describe('TaskService', () => {
  it('创建验证归属、标题、截止日期和标签限制，合法任务追加到容器末尾且提交后广播', async () => {
    await putWorkspace();
    await putWorkspace('workspace-2');
    await putList({ id: 'other-list', workspaceId: 'workspace-2' });
    await putTag({ id: 'other-tag', workspaceId: 'workspace-2' });
    await putTask({ id: 'existing', order: 3 });

    await expect(TaskService.createTask({ workspaceId: 'missing', listId: null, title: '任务' })).rejects.toThrow('工作区不存在');
    await expect(TaskService.createTask({ workspaceId: 'workspace-1', listId: 'other-list', title: '任务' })).rejects.toThrow('清单');
    await expect(TaskService.createTask({ workspaceId: 'workspace-1', listId: null, title: '任务', tagIds: ['other-tag'] })).rejects.toThrow('标签');
    await expect(TaskService.createTask({ workspaceId: 'workspace-1', listId: null, title: '  ' })).rejects.toThrow('标题不能为空');
    await expect(TaskService.createTask({ workspaceId: 'workspace-1', listId: null, title: '任务', dueDate: '2026-02-30' })).rejects.toThrow('截止日期');
    await expect(TaskService.createTask({ workspaceId: 'workspace-1', listId: null, title: '任务', tagIds: Array.from({ length: 21 }, (_, index) => `tag-${index}`) })).rejects.toThrow('最多');
    await expect(TaskService.createTask({ workspaceId: 'workspace-1', listId: null, title: '任务', tagIds: ['other-tag', 'other-tag'] })).rejects.toThrow('重复');

    const snapshots: Promise<Task[]>[] = [];
    vi.mocked(broadcastChange).mockImplementation((store) => {
      if (store === 'tasks') snapshots.push(getDB().then((db) => db.getAll('tasks')));
    });
    const task = await TaskService.createTask({ workspaceId: 'workspace-1', listId: null, title: '  新任务  ', description: '说明', priority: 'high', dueDate: '2026-02-28' });

    expect(task).toMatchObject({ title: '新任务', description: '说明', priority: 'high', dueDate: '2026-02-28', order: 4, status: 'active', completedAt: null, deletedAt: null });
    expect(await snapshots[0]).toEqual(expect.arrayContaining([task]));
    expect(broadcastChange).toHaveBeenCalledWith('tasks', 'put');
  });

  it('创建拒绝归档清单且不留下任务或关联记录', async () => {
    await putWorkspace();
    await putList({ archivedAt: 10 });
    await putTag();

    await expect(TaskService.createTask({ workspaceId: 'workspace-1', listId: 'list-1', title: '任务', tagIds: ['tag-1'] })).rejects.toThrow('已归档');
    const db = await getDB();
    expect(await db.count('tasks')).toBe(0);
    expect(await db.count('taskTagAssignments')).toBe(0);
  });

  it('仅更新允许字段并校验截止日期', async () => {
    const task = await putTask();
    const updated = await TaskService.patchTask(task.id, { title: '  新标题 ', description: '新说明', priority: 'low', dueDate: '2028-02-29' });
    expect(updated).toMatchObject({ title: '新标题', description: '新说明', priority: 'low', dueDate: '2028-02-29', listId: null });
    await expect(TaskService.patchTask(task.id, { dueDate: '2027-02-29' })).rejects.toThrow('截止日期');
  });

  it('完成含未完成检查项的任务先要求确认，确认后完成；取消完成追加到 active 容器末尾', async () => {
    const task = await putTask({ order: 0 });
    await putTask({ id: 'existing', order: 5 });
    await putChecklistItem({ taskId: task.id, isCompleted: false });

    await expect(TaskService.setTaskCompletion(task.id, true)).resolves.toEqual({ status: 'confirmation-required', incompleteChecklistCount: 1 });
    const db = await getDB();
    expect((await db.get('tasks', task.id))?.status).toBe('active');

    const completed = await TaskService.setTaskCompletion(task.id, true, { allowIncompleteChecklist: true });
    expect(completed).toMatchObject({ status: 'updated', task: { status: 'completed', completedAt: expect.any(Number), order: 0 } });
    const restored = await TaskService.setTaskCompletion(task.id, false);
    expect(restored).toMatchObject({ status: 'updated', task: { status: 'active', completedAt: null, order: 6 } });
  });

  it('替换标签拒绝重复、跨工作区和超限，并删除旧关联后建立新关联', async () => {
    const task = await putTask();
    await putTag({ id: 'old', name: '旧标签', normalizedName: '旧标签' });
    await putTag({ id: 'new', name: '新标签', normalizedName: '新标签' });
    await putTag({ id: 'other', workspaceId: 'workspace-2' });
    await putAssignment(task.id, 'old');

    await expect(TaskService.replaceTaskTags(task.id, ['new', 'new'])).rejects.toThrow('重复');
    await expect(TaskService.replaceTaskTags(task.id, ['other'])).rejects.toThrow('标签');
    await expect(TaskService.replaceTaskTags(task.id, Array.from({ length: 21 }, (_, index) => `tag-${index}`))).rejects.toThrow('最多');
    await TaskService.replaceTaskTags(task.id, ['new']);

    const db = await getDB();
    expect(await db.getAllFromIndex('taskTagAssignments', 'by-taskId', task.id)).toEqual([{ taskId: task.id, tagId: 'new', createdAt: expect.any(Number) }]);
  });

  it('移动跨工作区时原子更新归属并仅使用明确给定的目标标签', async () => {
    const task = await putTask();
    await putWorkspace('workspace-2');
    await putList({ id: 'list-2', workspaceId: 'workspace-2' });
    await putTag({ id: 'source-tag', name: '同名' });
    await putTag({ id: 'target-tag', workspaceId: 'workspace-2', name: '同名' });
    await putAssignment(task.id, 'source-tag');

    const moved = await TaskService.moveTask({ taskId: task.id, workspaceId: 'workspace-2', listId: 'list-2', tagIds: ['target-tag'] });
    expect(moved).toMatchObject({ workspaceId: 'workspace-2', listId: 'list-2', containerKey: taskContainerKey('workspace-2', 'list-2'), order: 0 });
    const db = await getDB();
    expect(await db.getAllFromIndex('taskTagAssignments', 'by-taskId', task.id)).toEqual([{ taskId: task.id, tagId: 'target-tag', createdAt: expect.any(Number) }]);
    await expect(TaskService.moveTask({ taskId: task.id, workspaceId: 'workspace-2', listId: 'list-2', tagIds: ['source-tag'] })).rejects.toThrow('标签');
  });

  it('软删除保留归属、顺序和关联；恢复时清理失效标签且原清单不存在时进入 Inbox', async () => {
    await putWorkspace();
    const list = await putList();
    const task = await putTask({ listId: list.id, order: 2 });
    await putTag();
    await putAssignment(task.id, 'tag-1');

    await TaskService.softDeleteTask(task.id);
    const db = await getDB();
    expect(await db.get('tasks', task.id)).toMatchObject({ deletedAt: expect.any(Number), listId: list.id, order: 2 });
    expect(await db.get('taskTagAssignments', [task.id, 'tag-1'])).toBeDefined();

    await db.delete('taskLists', list.id);
    await db.delete('taskTags', 'tag-1');
    const restored = await TaskService.restoreTask(task.id);
    expect(restored).toMatchObject({ deletedAt: null, listId: null, containerKey: taskContainerKey('workspace-1', null), order: 0 });
    expect(await db.getAllFromIndex('taskTagAssignments', 'by-taskId', task.id)).toEqual([]);
  });

  it('恢复时原清单仍存在则恢复原归属并追加到该容器末尾', async () => {
    await putWorkspace();
    const list = await putList();
    const task = await putTask({ listId: list.id, deletedAt: 10, order: 0 });
    await putTask({ id: 'existing', listId: list.id, order: 4 });

    const restored = await TaskService.restoreTask(task.id);
    expect(restored).toMatchObject({ listId: list.id, containerKey: taskContainerKey('workspace-1', list.id), order: 5, deletedAt: null });
  });

  it('永久删除与清空回收站级联删除检查项和标签关联，并按范围返回数量', async () => {
    const permanent = await putTask({ id: 'permanent' });
    await putChecklistItem({ taskId: permanent.id });
    await putTag();
    await putAssignment(permanent.id, 'tag-1');
    await TaskService.deleteTaskPermanently(permanent.id);
    const db = await getDB();
    expect(await db.get('tasks', permanent.id)).toBeUndefined();
    expect(await db.getAllFromIndex('checklistItems', 'by-taskId', permanent.id)).toEqual([]);
    expect(await db.getAllFromIndex('taskTagAssignments', 'by-taskId', permanent.id)).toEqual([]);

    await putTask({ id: 'trash-one', deletedAt: 10 });
    await putChecklistItem({ id: 'trash-item', taskId: 'trash-one' });
    await putAssignment('trash-one', 'tag-1');
    await putWorkspace('workspace-2');
    await putTask({ id: 'trash-two', workspaceId: 'workspace-2', deletedAt: 11 });
    expect(await TaskService.emptyTrash({ kind: 'workspace', workspaceId: 'workspace-1' })).toBe(1);
    expect(await db.get('tasks', 'trash-two')).toBeDefined();
    expect(await TaskService.emptyTrash({ kind: 'all' })).toBe(1);
    expect(await db.count('tasks')).toBe(0);
  });

  it('重排仅接受容器全部未删除 active 任务，失败不部分写入，成功后按 0 起编号', async () => {
    await putTask({ id: 'first', order: 4 });
    await putTask({ id: 'second', order: 8 });
    await putTask({ id: 'completed', order: 1, status: 'completed', completedAt: 2 });
    await putTask({ id: 'deleted', order: 2, deletedAt: 3 });

    await expect(TaskService.reorderTasks('workspace-1', null, ['second'])).rejects.toThrow('数量');
    const db = await getDB();
    expect((await db.get('tasks', 'first'))?.order).toBe(4);
    expect((await db.get('tasks', 'second'))?.order).toBe(8);
    await TaskService.reorderTasks('workspace-1', null, ['second', 'first']);
    expect((await db.get('tasks', 'second'))?.order).toBe(0);
    expect((await db.get('tasks', 'first'))?.order).toBe(1);
    expect((await db.get('tasks', 'completed'))?.order).toBe(1);
    expect((await db.get('tasks', 'deleted'))?.order).toBe(2);
  });
});
