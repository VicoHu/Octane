import { describe, expect, it } from 'vitest';
import type { ChecklistItem, Task, TaskList, TaskTag, Workspace } from '@/shared/types';
import {
  buildTaskCounts,
  buildTaskRows,
  filterTasks,
  findTaskSearchMatch,
  sortTasksForView,
  type TaskProjection,
} from '@/shared/tasks/taskQuery';
import { taskContainerKey } from '@/shared/tasks/taskRules';

const today = '2026-08-20';
const workspace: Workspace = { id: 'ws-a', name: '甲', icon: 'A', createdAt: 1, order: 0 };
const otherWorkspace: Workspace = { id: 'ws-b', name: '乙', icon: 'B', createdAt: 1, order: 1 };
const activeList: TaskList = {
  id: 'list-active', workspaceId: 'ws-a', name: '项目', normalizedName: '项目', color: 'green',
  order: 0, archivedAt: null, createdAt: 1, updatedAt: 1,
};
const archivedList: TaskList = { ...activeList, id: 'list-archived', archivedAt: 2, order: 1 };
const tag: TaskTag = {
  id: 'tag-a', workspaceId: 'ws-a', name: '重要', normalizedName: '重要', color: 'red', order: 0, createdAt: 1, updatedAt: 1,
};

function task(id: string, overrides: Partial<Task> = {}): Task {
  const listId = overrides.listId === undefined ? null : overrides.listId;
  return {
    id, workspaceId: 'ws-a', listId, containerKey: taskContainerKey('ws-a', listId), title: id,
    description: '', priority: 'none', dueDate: null, status: 'active', order: 0,
    completedAt: null, deletedAt: null, createdAt: 1, updatedAt: 1, ...overrides,
  };
}

function projection(value: Task, overrides: Partial<TaskProjection> = {}): TaskProjection {
  return {
    task: value,
    workspace: value.workspaceId === 'ws-b' ? otherWorkspace : workspace,
    taskList: value.listId === activeList.id ? activeList : value.listId === archivedList.id ? archivedList : null,
    taskTags: [],
    checklistItems: [],
    ...overrides,
  };
}

const standardOptions = {
  scope: { kind: 'workspace' as const, workspaceId: 'ws-a' },
  view: { kind: 'today' as const },
  status: 'active' as const,
  priority: 'all' as const,
  search: '',
};

describe('taskQuery 过滤', () => {
  it('今天只返回到期或逾期的活跃、未删除且未归档任务', () => {
    const rows = [
      projection(task('overdue', { dueDate: '2026-08-19' })),
      projection(task('today', { dueDate: today })),
      projection(task('future', { dueDate: '2026-08-21' })),
      projection(task('completed', { dueDate: today, status: 'completed', completedAt: 2 })),
      projection(task('trash', { dueDate: today, deletedAt: 2 })),
      projection(task('archived', { listId: archivedList.id, dueDate: today })),
    ];

    expect(filterTasks(rows, standardOptions, today).map((row) => row.task.id)).toEqual(['overdue', 'today']);
  });

  it('未来七天排除逾期，包含第六天且不包含第七天', () => {
    const rows = [
      projection(task('overdue', { dueDate: '2026-08-19' })),
      projection(task('today', { dueDate: today })),
      projection(task('sixth-day', { dueDate: '2026-08-26' })),
      projection(task('seventh-day', { dueDate: '2026-08-27' })),
    ];

    expect(filterTasks(rows, { ...standardOptions, view: { kind: 'next7' } }, today).map((row) => row.task.id))
      .toEqual(['today', 'sixth-day']);
  });

  it('List、Tag、归档和 Trash 各自隔离状态与范围', () => {
    const rows = [
      projection(task('inbox')),
      projection(task('list', { listId: activeList.id })),
      projection(task('archived', { listId: archivedList.id })),
      projection(task('trash', { deletedAt: 2 })),
      projection(task('other', { workspaceId: 'ws-b' })),
      projection(task('tagged'), { taskTags: [tag] }),
    ];

    expect(filterTasks(rows, { ...standardOptions, view: { kind: 'inbox' } }, today).map((row) => row.task.id)).toEqual(['inbox', 'tagged']);
    expect(filterTasks(rows, { ...standardOptions, view: { kind: 'list', listId: activeList.id } }, today).map((row) => row.task.id)).toEqual(['list']);
    expect(filterTasks(rows, { ...standardOptions, view: { kind: 'tag', tagId: tag.id } }, today).map((row) => row.task.id)).toEqual(['tagged']);
    expect(filterTasks(rows, { ...standardOptions, view: { kind: 'archivedList', listId: archivedList.id }, status: 'all' }, today).map((row) => row.task.id)).toEqual(['archived']);
    expect(filterTasks(rows, { ...standardOptions, view: { kind: 'trash' } }, today).map((row) => row.task.id)).toEqual(['trash']);
    expect(filterTasks(rows, { ...standardOptions, scope: { kind: 'all' }, view: { kind: 'inbox' } }, today).map((row) => row.task.id)).toEqual(['inbox', 'other', 'tagged']);
  });

  it('状态、优先级和文本搜索使用 AND，搜索可命中 Checklist', () => {
    const checklist: ChecklistItem = { id: 'check', taskId: 'match', text: '准备演示', isCompleted: false, completedAt: null, order: 0, createdAt: 1, updatedAt: 1 };
    const rows = [
      projection(task('match', { priority: 'high' }), { checklistItems: [checklist] }),
      projection(task('completed', { priority: 'high', status: 'completed', completedAt: 2 })),
      projection(task('low', { priority: 'low', description: '准备演示' })),
    ];
    const options = { ...standardOptions, view: { kind: 'inbox' as const }, priority: 'high' as const, search: '演示' };

    expect(filterTasks(rows, options, today).map((row) => row.task.id)).toEqual(['match']);
    expect(findTaskSearchMatch(rows[0]!, '演示')).toEqual({ source: 'checklist', summary: '准备演示' });
    expect(findTaskSearchMatch(rows[2]!, '演示')).toEqual({ source: 'description', summary: '准备演示' });
  });
});

describe('taskQuery 排序与投影', () => {
  it('今天先排逾期，再按优先级与稳定容器顺序', () => {
    const rows = [
      projection(task('none', { dueDate: today, priority: 'none', order: 2 })),
      projection(task('high', { dueDate: today, priority: 'high', order: 1 })),
      projection(task('overdue-low', { dueDate: '2026-08-19', priority: 'low', order: 3 })),
      projection(task('overdue-high', { dueDate: '2026-08-18', priority: 'high', order: 4 })),
    ];

    expect(sortTasksForView(rows, { kind: 'today' }, 'manual', today).map((row) => row.task.id))
      .toEqual(['overdue-high', 'overdue-low', 'high', 'none']);
  });

  it('未来七天按日期、优先级与稳定顺序，完成任务按 completedAt 倒序', () => {
    const rows = [
      projection(task('later', { dueDate: '2026-08-22', priority: 'high' })),
      projection(task('same-low', { dueDate: today, priority: 'low', order: 1 })),
      projection(task('same-high', { dueDate: today, priority: 'high', order: 2 })),
      projection(task('completed-old', { status: 'completed', completedAt: 1 })),
      projection(task('completed-new', { status: 'completed', completedAt: 2 })),
    ];

    expect(sortTasksForView(rows.slice(0, 3), { kind: 'next7' }, 'manual', today).map((row) => row.task.id))
      .toEqual(['same-high', 'same-low', 'later']);
    expect(sortTasksForView(rows.slice(3), { kind: 'inbox' }, 'manual', today, 'completed').map((row) => row.task.id))
      .toEqual(['completed-new', 'completed-old']);
  });

  it('Tag 聚合按截止日期（无日期在后）、优先级、创建时间和 ID 排序', () => {
    const rows = [
      projection(task('none', { dueDate: null, priority: 'high', createdAt: 1 })),
      projection(task('later', { dueDate: '2026-08-22', priority: 'high', createdAt: 1 })),
      projection(task('same-low', { dueDate: today, priority: 'low', createdAt: 1 })),
      projection(task('same-high-b', { dueDate: today, priority: 'high', createdAt: 2 })),
      projection(task('same-high-a', { dueDate: today, priority: 'high', createdAt: 1 })),
    ];

    expect(sortTasksForView(rows, { kind: 'tag', tagId: tag.id }, 'manual', today).map((row) => row.task.id))
      .toEqual(['same-high-a', 'same-high-b', 'same-low', 'later', 'none']);
  });

  it('任务行聚合 Checklist、最多两个标签和搜索摘要', () => {
    const rows = buildTaskRows([projection(task('row', { description: '说明文字' }), {
      taskTags: [tag, { ...tag, id: 'tag-b', name: 'B' }, { ...tag, id: 'tag-c', name: 'C' }],
      checklistItems: [
        { id: 'a', taskId: 'row', text: '一', isCompleted: true, completedAt: 1, order: 0, createdAt: 1, updatedAt: 1 },
        { id: 'b', taskId: 'row', text: '二', isCompleted: false, completedAt: null, order: 1, createdAt: 1, updatedAt: 1 },
      ],
    })], '说明');

    expect(rows[0]).toMatchObject({ id: 'row', checklistCompletedCount: 1, checklistTotalCount: 2, hiddenTagCount: 1, listName: '收集箱', searchMatch: { source: 'description', summary: '说明文字' } });
    expect(rows[0]?.taskTags.map((taskTag) => taskTag.id)).toEqual(['tag-a', 'tag-b']);
  });
});

describe('taskQuery 导航计数', () => {
  it('计数忽略搜索、筛选与已完成项，归档任务不进入活跃入口', () => {
    const rows = [
      projection(task('overdue', { dueDate: '2026-08-19' }), { taskTags: [tag] }),
      projection(task('today', { dueDate: today, listId: activeList.id }), { taskTags: [tag] }),
      projection(task('next', { dueDate: '2026-08-26' })),
      projection(task('completed', { dueDate: today, status: 'completed', completedAt: 2 })),
      projection(task('archived', { listId: archivedList.id, dueDate: today })),
      projection(task('trash', { deletedAt: 3 })),
    ];

    expect(buildTaskCounts(rows, [activeList, archivedList], today)).toEqual({
      today: 2,
      next7: 2,
      inbox: 2,
      trash: 1,
      archivedLists: 1,
      list: { [activeList.id]: 1 },
      tag: { [tag.id]: 2 },
    });
  });
});
