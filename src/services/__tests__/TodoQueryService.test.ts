import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDB, resetDB } from '@/shared/db/database';
import {
  getTaskDetail,
  getWorkspaceImpact,
  loadNavigation,
  queryTasks,
  type TaskQuery,
} from '@/services/TodoQueryService';
import { taskContainerKey } from '@/shared/tasks/taskRules';

const today = '2026-08-20';
const taskStores = ['workspaces', 'taskLists', 'tasks', 'checklistItems', 'taskTags', 'taskTagAssignments'] as const;

async function clearTaskStores(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([...taskStores], 'readwrite');
  for (const store of taskStores) await tx.objectStore(store).clear();
  await tx.done;
}

async function seed(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([...taskStores], 'readwrite');
  await tx.objectStore('workspaces').put({ id: 'ws-a', name: '甲', icon: 'A', createdAt: 1, order: 0 });
  await tx.objectStore('workspaces').put({ id: 'ws-b', name: '乙', icon: 'B', createdAt: 1, order: 1 });
  await tx.objectStore('taskLists').put({ id: 'list-a', workspaceId: 'ws-a', name: '活动', normalizedName: '活动', color: 'green', order: 0, archivedAt: null, createdAt: 1, updatedAt: 1 });
  await tx.objectStore('taskLists').put({ id: 'list-archived', workspaceId: 'ws-a', name: '归档', normalizedName: '归档', color: 'gray', order: 1, archivedAt: 2, createdAt: 1, updatedAt: 1 });
  await tx.objectStore('taskTags').put({ id: 'tag-a', workspaceId: 'ws-a', name: '重要', normalizedName: '重要', color: 'red', order: 0, createdAt: 1, updatedAt: 1 });
  const putTask = async (id: string, values: Partial<{ workspaceId: string; listId: string | null; title: string; description: string; priority: 'high' | 'medium' | 'low' | 'none'; dueDate: string | null; status: 'active' | 'completed'; order: number; completedAt: number | null; deletedAt: number | null; createdAt: number }>) => {
    const workspaceId = values.workspaceId ?? 'ws-a';
    const listId = values.listId ?? null;
    await tx.objectStore('tasks').put({ id, workspaceId, listId, containerKey: taskContainerKey(workspaceId, listId), title: values.title ?? id, description: values.description ?? '', priority: values.priority ?? 'none', dueDate: values.dueDate ?? null, status: values.status ?? 'active', order: values.order ?? 0, completedAt: values.completedAt ?? null, deletedAt: values.deletedAt ?? null, createdAt: values.createdAt ?? 1, updatedAt: 1 });
  };
  await putTask('overdue', { dueDate: '2026-08-19', priority: 'low' });
  await putTask('today-high', { dueDate: today, priority: 'high', listId: 'list-a' });
  await putTask('next', { dueDate: '2026-08-26' });
  await putTask('completed', { dueDate: today, status: 'completed', completedAt: 5 });
  await putTask('archived', { dueDate: today, listId: 'list-archived' });
  await putTask('trash', { deletedAt: 3 });
  await putTask('other-workspace', { workspaceId: 'ws-b', dueDate: today });
  await putTask('search', { description: '描述不匹配' });
  await tx.objectStore('checklistItems').put({ id: 'check-a', taskId: 'search', text: '检查命中内容', isCompleted: false, completedAt: null, order: 0, createdAt: 1, updatedAt: 1 });
  await tx.objectStore('taskTagAssignments').put({ taskId: 'today-high', tagId: 'tag-a', createdAt: 1 });
  await tx.done;
}

const baseQuery: TaskQuery = {
  scope: { kind: 'workspace', workspaceId: 'ws-a' }, view: { kind: 'today' }, status: 'active', priority: 'all', search: '', sort: 'manual', today,
};

beforeEach(async () => {
  resetDB();
  await clearTaskStores();
  await seed();
});

afterAll(resetDB);

describe('TodoQueryService 查询快照', () => {
  it('当前工作区与所有工作区的 Today 结果和导航分组不串数据', async () => {
    expect((await queryTasks(baseQuery)).active.map((row) => row.id)).toEqual(['overdue', 'today-high']);
    expect((await queryTasks({ ...baseQuery, scope: { kind: 'all' } })).active.map((row) => row.id)).toEqual(['overdue', 'today-high', 'other-workspace']);

    const navigation = await loadNavigation({ kind: 'all' }, today);
    expect(navigation.groups.map((group) => group.workspace.id)).toEqual(['ws-a', 'ws-b']);
    expect(navigation.counts.today).toBe(3);
  });

  it('视图通过正确索引语义返回 Inbox、List、Tag、归档和 Trash', async () => {
    expect((await queryTasks({ ...baseQuery, view: { kind: 'inbox' } })).active.map((row) => row.id)).toContain('overdue');
    expect((await queryTasks({ ...baseQuery, view: { kind: 'list', listId: 'list-a' } })).active.map((row) => row.id)).toEqual(['today-high']);
    expect((await queryTasks({ ...baseQuery, view: { kind: 'tag', tagId: 'tag-a' } })).active.map((row) => row.id)).toEqual(['today-high']);
    expect((await queryTasks({ ...baseQuery, view: { kind: 'archivedList', listId: 'list-archived' }, status: 'all' })).active.map((row) => row.id)).toEqual(['archived']);
    expect((await queryTasks({ ...baseQuery, view: { kind: 'trash' } })).active.map((row) => row.id)).toEqual(['trash']);
  });

  it('Checklist 搜索提供父任务摘要，完成项按完成时间倒序', async () => {
    const searched = await queryTasks({ ...baseQuery, view: { kind: 'inbox' }, search: '命中内容' });
    expect(searched.active).toHaveLength(1);
    expect(searched.active[0]?.searchMatch).toEqual({ source: 'checklist', summary: '检查命中内容' });

    const completed = await queryTasks({ ...baseQuery, view: { kind: 'inbox' }, status: 'completed' });
    expect(completed.completed.map((row) => row.id)).toEqual(['completed']);
  });

  it('详情和 Workspace impact 返回完整关系且不写入任何 store', async () => {
    const db = await getDB();
    const before = await Promise.all(taskStores.map((store) => db.count(store)));
    const detail = await getTaskDetail('today-high');
    const impact = await getWorkspaceImpact('ws-a');
    const after = await Promise.all(taskStores.map((store) => db.count(store)));

    expect(detail?.taskTags.map((taskTag) => taskTag.id)).toEqual(['tag-a']);
    expect(detail?.taskList?.id).toBe('list-a');
    expect(impact).toMatchObject({ taskCount: 7, taskListCount: 2, taskTagCount: 1, checklistItemCount: 1, taskTagAssignmentCount: 1 });
    expect(after).toEqual(before);
  });
});
