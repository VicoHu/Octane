import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({
  loadNavigation: vi.fn(),
  queryTasks: vi.fn(),
  getTaskDetail: vi.fn(),
}));
const task = vi.hoisted(() => ({
  createTask: vi.fn(),
  patchTask: vi.fn(),
  setTaskCompletion: vi.fn(),
  replaceTaskTags: vi.fn(),
  moveTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  deleteTaskPermanently: vi.fn(),
  emptyTrash: vi.fn(),
  reorderTasks: vi.fn(),
}));
const taskList = vi.hoisted(() => ({
  createTaskList: vi.fn(),
  updateTaskList: vi.fn(),
  archiveTaskList: vi.fn(),
  restoreTaskList: vi.fn(),
  getTaskListDeleteImpact: vi.fn(),
  deleteTaskListPermanently: vi.fn(),
  reorderTaskLists: vi.fn(),
}));
const taskTag = vi.hoisted(() => ({
  createTaskTag: vi.fn(),
  updateTaskTag: vi.fn(),
  getTaskTagDeleteImpact: vi.fn(),
  deleteTaskTag: vi.fn(),
  reorderTaskTags: vi.fn(),
}));

vi.mock('@/services/TodoQueryService', () => query);
vi.mock('@/services/TaskService', () => task);
vi.mock('@/services/TaskListService', () => taskList);
vi.mock('@/services/TaskTagService', () => taskTag);

import { useTodoData } from '@/store/useTodoData';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const navigationOf = (id: string) => ({ id }) as never;
const detailOf = (id: string) => ({ task: { id } }) as never;
const queryOf = (...ids: string[]) => ({
  active: ids.map((id, order) => ({ id, task: { id, order } })),
  completed: [],
  total: ids.length,
  effectiveSort: 'manual',
}) as never;

beforeEach(() => {
  useTodoData.getState().reset();
  vi.clearAllMocks();
});

describe('useTodoData — 请求序列 guard', () => {
  it('旧 Workspace、View 与 Task 请求晚返回时不覆盖当前快照', async () => {
    const oldNavigation = deferred<never>();
    const newNavigation = deferred<never>();
    const oldQuery = deferred<never>();
    const newQuery = deferred<never>();
    const oldDetail = deferred<never>();
    const newDetail = deferred<never>();
    query.loadNavigation.mockReturnValueOnce(oldNavigation.promise).mockReturnValueOnce(newNavigation.promise);
    query.queryTasks.mockReturnValueOnce(oldQuery.promise).mockReturnValueOnce(newQuery.promise);
    query.getTaskDetail.mockReturnValueOnce(oldDetail.promise).mockReturnValueOnce(newDetail.promise);
    const { result } = renderHook(() => useTodoData());

    let oldLoads!: Promise<void>[];
    let newLoads!: Promise<void>[];
    await act(async () => {
      oldLoads = [
        result.current.loadNavigation({ kind: 'workspace', workspaceId: 'old' }, '2026-08-20'),
        result.current.loadQuery({ scope: { kind: 'workspace', workspaceId: 'old' }, view: { kind: 'today' }, status: 'active', priority: 'all', search: '', sort: 'manual', today: '2026-08-20' }),
        result.current.loadDetail('old-task'),
      ];
      newLoads = [
        result.current.loadNavigation({ kind: 'workspace', workspaceId: 'new' }, '2026-08-20'),
        result.current.loadQuery({ scope: { kind: 'workspace', workspaceId: 'new' }, view: { kind: 'inbox' }, status: 'active', priority: 'all', search: '', sort: 'manual', today: '2026-08-20' }),
        result.current.loadDetail('new-task'),
      ];
    });

    await act(async () => {
      newNavigation.resolve(navigationOf('new-navigation'));
      newQuery.resolve(queryOf('new-query'));
      newDetail.resolve(detailOf('new-detail'));
      await Promise.all(newLoads);
    });
    await act(async () => {
      oldNavigation.resolve(navigationOf('old-navigation'));
      oldQuery.resolve(queryOf('old-query'));
      oldDetail.resolve(detailOf('old-detail'));
      await Promise.all(oldLoads);
    });

    expect(result.current.navigation).toEqual(navigationOf('new-navigation'));
    expect(result.current.queryResult?.active[0]?.id).toBe('new-query');
    expect(result.current.detail?.task.id).toBe('new-detail');
  });
});

describe('useTodoData — 失效与写后刷新', () => {
  it('invalidate 标记数据失效', () => {
    const { result } = renderHook(() => useTodoData());

    act(() => result.current.invalidate());

    expect(result.current.invalidated).toBe(true);
  });

  it('创建任务成功后只刷新导航和当前查询', async () => {
    query.loadNavigation.mockResolvedValue(navigationOf('navigation'));
    query.queryTasks.mockResolvedValue(queryOf('task-1'));
    task.createTask.mockResolvedValue({ id: 'created' });
    const { result } = renderHook(() => useTodoData());
    const scope = { kind: 'workspace', workspaceId: 'workspace-1' } as const;
    const taskQuery = { scope, view: { kind: 'today' } as const, status: 'active' as const, priority: 'all' as const, search: '', sort: 'manual' as const, today: '2026-08-20' };

    await act(async () => {
      await result.current.loadNavigation(scope, '2026-08-20');
      await result.current.loadQuery(taskQuery);
      await result.current.createTask({ workspaceId: 'workspace-1', listId: null, title: '新任务' });
    });

    expect(task.createTask).toHaveBeenCalledWith({ workspaceId: 'workspace-1', listId: null, title: '新任务' });
    expect(query.loadNavigation).toHaveBeenCalledTimes(2);
    expect(query.queryTasks).toHaveBeenCalledTimes(2);
    expect(query.getTaskDetail).not.toHaveBeenCalled();
  });

  it('完成任务需要确认时不刷新任何快照', async () => {
    query.loadNavigation.mockResolvedValue(navigationOf('navigation'));
    query.queryTasks.mockResolvedValue(queryOf('task-1'));
    query.getTaskDetail.mockResolvedValue(detailOf('task-1'));
    task.setTaskCompletion.mockResolvedValue({ status: 'confirmation-required', incompleteChecklistCount: 1 });
    const { result } = renderHook(() => useTodoData());
    const scope = { kind: 'workspace', workspaceId: 'workspace-1' } as const;
    const taskQuery = { scope, view: { kind: 'today' } as const, status: 'active' as const, priority: 'all' as const, search: '', sort: 'manual' as const, today: '2026-08-20' };

    await act(async () => {
      await result.current.loadNavigation(scope, '2026-08-20');
      await result.current.loadQuery(taskQuery);
      await result.current.loadDetail('task-1');
      await result.current.setTaskCompletion('task-1', true);
    });

    expect(query.loadNavigation).toHaveBeenCalledTimes(1);
    expect(query.queryTasks).toHaveBeenCalledTimes(1);
    expect(query.getTaskDetail).toHaveBeenCalledTimes(1);
  });
});

describe('useTodoData — 拖拽重排', () => {
  it('持久化失败时回滚到拖拽前的完整 queryResult 快照', async () => {
    const reorder = deferred<void>();
    task.reorderTasks.mockReturnValue(reorder.promise);
    const { result } = renderHook(() => useTodoData());
    const original = queryOf('task-1', 'task-2');
    useTodoData.setState({ queryResult: original });

    let mutation!: Promise<void>;
    act(() => {
      mutation = result.current.reorderTasks('workspace-1', null, ['task-2', 'task-1']);
    });

    expect(result.current.queryResult?.active.map((row) => row.id)).toEqual(['task-2', 'task-1']);

    await act(async () => {
      reorder.reject(new Error('重排失败'));
      await expect(mutation).rejects.toThrow('重排失败');
    });

    expect(result.current.queryResult).toBe(original);
    expect(result.current.queryResult?.active.map((row) => row.id)).toEqual(['task-1', 'task-2']);
  });
});

describe('useTodoData — 清单和标签命令', () => {
  it('创建清单成功后刷新导航和当前查询', async () => {
    query.loadNavigation.mockResolvedValue(navigationOf('navigation'));
    query.queryTasks.mockResolvedValue(queryOf('task-1'));
    taskList.createTaskList.mockResolvedValue({ id: 'list-1' });
    const { result } = renderHook(() => useTodoData());
    const scope = { kind: 'workspace', workspaceId: 'workspace-1' } as const;
    const taskQuery = { scope, view: { kind: 'inbox' } as const, status: 'active' as const, priority: 'all' as const, search: '', sort: 'manual' as const, today: '2026-08-20' };

    await act(async () => {
      await result.current.loadNavigation(scope, '2026-08-20');
      await result.current.loadQuery(taskQuery);
      await result.current.createTaskList('workspace-1', { name: '项目', color: 'green' });
    });

    expect(taskList.createTaskList).toHaveBeenCalledWith('workspace-1', { name: '项目', color: 'green' });
    expect(query.loadNavigation).toHaveBeenCalledTimes(2);
    expect(query.queryTasks).toHaveBeenCalledTimes(2);
  });

  it('归档清单需要确认时不刷新快照', async () => {
    taskList.archiveTaskList.mockResolvedValue({ status: 'confirmation-required', incompleteCount: 2 });
    const { result } = renderHook(() => useTodoData());

    const archiveResult = await act(async () => result.current.archiveTaskList('list-1'));

    expect(archiveResult).toEqual({ status: 'confirmation-required', incompleteCount: 2 });
    expect(query.loadNavigation).not.toHaveBeenCalled();
    expect(query.queryTasks).not.toHaveBeenCalled();
  });

  it('标签删除影响查询直接转发给服务层', async () => {
    taskTag.getTaskTagDeleteImpact.mockResolvedValue({ affectedTaskCount: 3 });
    const { result } = renderHook(() => useTodoData());

    await expect(result.current.getTaskTagDeleteImpact('tag-1')).resolves.toEqual({ affectedTaskCount: 3 });

    expect(taskTag.getTaskTagDeleteImpact).toHaveBeenCalledWith('tag-1');
  });
});
