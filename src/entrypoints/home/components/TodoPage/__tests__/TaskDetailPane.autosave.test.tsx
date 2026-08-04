import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({ loadNavigation: vi.fn(), queryTasks: vi.fn(), getTaskDetail: vi.fn() }));
const taskService = vi.hoisted(() => ({ patchTask: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/services/TodoQueryService', () => query);
vi.mock('@/services/TaskService', () => taskService);
vi.mock('@/components/ui/toast', () => ({ Toast: toast }));

import { TaskDetailPane, type TaskDetailPaneHandle } from '../TaskDetailPane';
import { TodoPage, type TodoLeaveGuard } from '..';
import { useTodoData } from '@/store/useTodoData';
import { useTodoView } from '@/store/useTodoView';
import { useWorkspace } from '@/store/useWorkspace';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const task = { id: 't1', workspaceId: 'w1', listId: null, containerKey: '["w1",null]', title: '原始标题', description: '', priority: 'none' as const, dueDate: null, status: 'active' as const, order: 0, completedAt: null, deletedAt: null, createdAt: 1, updatedAt: 1 };
const workspace = { id: 'w1', name: '工作', icon: 'Briefcase', order: 0, createdAt: 1 };
const detail = { task, workspace, taskList: null, taskTags: [], checklistItems: [] } as never;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  useTodoData.getState().reset(); useTodoView.getState().reset(); vi.clearAllMocks();
  if (!window.matchMedia) Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  if (!Element.prototype.getAnimations) Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
  useWorkspace.setState({ workspaces: [workspace], currentWorkspaceId: 'w1' }); useTodoView.setState({ selectedTaskId: 't1' }); useTodoData.setState({ detail });
  query.getTaskDetail.mockResolvedValue(detail); query.loadNavigation.mockResolvedValue({ groups: [], counts: {} }); taskService.patchTask.mockResolvedValue(task);
});

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
});

describe('TaskDetailPane 草稿保护', () => {
  it('保存中的最新 revision 会通过真实 TaskService 串行提交', async () => {
    const user = userEvent.setup(); const pending = deferred<typeof task>(); taskService.patchTask.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(task);
    const ref = { current: null as TaskDetailPaneHandle | null }; render(<TaskDetailPane ref={ref} mobile={false} onBack={vi.fn()} />); const title = screen.getByLabelText('标题'); await user.clear(title); await user.type(title, '第一版'); const save = ref.current!.commitDraft(); await user.type(title, '最终版'); pending.resolve(task);
    await expect(save).resolves.toBe(true); expect(taskService.patchTask).toHaveBeenNthCalledWith(1, 't1', { title: '第一版', description: '' }); expect(taskService.patchTask).toHaveBeenNthCalledWith(2, 't1', { title: '第一版最终版', description: '' });
  });

  it('空标题保存失败后输入合法标题仍可经失焦保存', async () => {
    const user = userEvent.setup(); render(<TaskDetailPane mobile={false} onBack={vi.fn()} />);
    const title = screen.getByLabelText('标题'); await user.clear(title); await user.tab();
    expect(await screen.findByText('标题不能为空')).toBeInTheDocument();
    await user.type(title, '恢复可保存'); await user.tab();
    await waitFor(() => expect(taskService.patchTask).toHaveBeenCalledWith('t1', { title: '恢复可保存', description: '' }));
  });

  it('快速成功和 Ctrl+Enter 不显示 Spinner', async () => {
    const user = userEvent.setup(); render(<TaskDetailPane mobile={false} onBack={vi.fn()} />); const title = screen.getByLabelText('标题'); await user.clear(title); await user.type(title, '快捷保存'); await user.keyboard('{Control>}{Enter}{/Control}'); await waitFor(() => expect(taskService.patchTask).toHaveBeenCalledWith('t1', { title: '快捷保存', description: '' })); expect(screen.queryByRole('status', { name: '保存中' })).not.toBeInTheDocument();
  });

  it('切换 view 在保存失败时保持原 view', async () => {
    const user = userEvent.setup(); taskService.patchTask.mockRejectedValue(new Error('写入失败')); useTodoView.setState({ view: { kind: 'inbox' } }); useTodoData.setState({ navigation: { groups: [], counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: {} } } as never });
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />); await user.clear(screen.getByLabelText('标题')); await user.type(screen.getByLabelText('标题'), '未保存'); await user.click(screen.getByRole('button', { name: '今天' }));
    expect(await screen.findByText('未保存的修改')).toBeInTheDocument(); expect(useTodoView.getState().view).toEqual({ kind: 'inbox' });
  });

  it('切换 scope 在保存失败时保持 current', async () => {
    const user = userEvent.setup(); taskService.patchTask.mockRejectedValue(new Error('写入失败')); useTodoData.setState({ navigation: { groups: [], counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: {} } } as never });
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />); await user.clear(screen.getByLabelText('标题')); await user.type(screen.getByLabelText('标题'), '未保存'); await user.click(screen.getByRole('button', { name: '所有工作区' }));
    expect(await screen.findByText('未保存的修改')).toBeInTheDocument(); expect(useTodoView.getState().scopeMode).toBe('current');
  });

  it('桌面关闭详情在保存失败时被阻断', async () => {
    const user = userEvent.setup(); taskService.patchTask.mockRejectedValue(new Error('写入失败'));
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />); await user.clear(screen.getByLabelText('标题')); await user.type(screen.getByLabelText('标题'), '未保存');
    await user.click(screen.getByRole('button', { name: '关闭详情' })); expect(await screen.findByText('未保存的修改')).toBeInTheDocument(); expect(useTodoView.getState().selectedTaskId).toBe('t1');
    await user.click(screen.getByRole('button', { name: '留在当前待办' }));
  });

  it('选择另一 Task 时保存失败保持原选择，放弃后才切换', async () => {
    const user = userEvent.setup(); taskService.patchTask.mockRejectedValue(new Error('写入失败'));
    const next = { ...task, id: 't2', title: '下一条' };
    const rows = { active: [
      { id: 't1', task, workspace, taskList: null, listName: '收集箱', taskTags: [], hiddenTagCount: 0, checklistCompletedCount: 0, checklistTotalCount: 0, searchMatch: null },
      { id: 't2', task: next, workspace, taskList: null, listName: '收集箱', taskTags: [], hiddenTagCount: 0, checklistCompletedCount: 0, checklistTotalCount: 0, searchMatch: null },
    ], completed: [], total: 2, effectiveSort: 'manual' } as never;
    useTodoData.setState({ queryResult: rows }); query.queryTasks.mockResolvedValue(rows);
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />); await user.clear(screen.getByLabelText('标题')); await user.type(screen.getByLabelText('标题'), '未保存'); await user.click(screen.getByRole('button', { name: '下一条' }));
    expect(await screen.findByText('未保存的修改')).toBeInTheDocument(); expect(useTodoView.getState().selectedTaskId).toBe('t1');
    await user.click(screen.getByRole('button', { name: '放弃修改' })); await waitFor(() => expect(useTodoView.getState().selectedTaskId).toBe('t2'));
  });

  it('移动端返回保存失败时保留详情，放弃后才回列表', async () => {
    const user = userEvent.setup(); taskService.patchTask.mockRejectedValue(new Error('写入失败'));
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (value: string) => ({ matches: value === 'max-width:760px', addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    useTodoView.setState({ mobileDetailOpen: true });
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />); await user.clear(screen.getByLabelText('标题')); await user.type(screen.getByLabelText('标题'), '未保存'); await user.click(screen.getByRole('button', { name: '返回列表' }));
    expect(await screen.findByText('未保存的修改')).toBeInTheDocument(); expect(useTodoView.getState().mobileDetailOpen).toBe(true); expect(screen.getByLabelText('标题')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '放弃修改' })); await waitFor(() => expect(useTodoView.getState().mobileDetailOpen).toBe(false));
  });

  it('注册给 App 的离开 gate 在失败时阻止动作，放弃后继续', async () => {
    const user = userEvent.setup(); taskService.patchTask.mockRejectedValue(new Error('写入失败')); const leave = vi.fn(); let guard: TodoLeaveGuard | null = null;
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} onRegisterLeaveGuard={(next) => { guard = next; }} />); await user.clear(screen.getByLabelText('标题')); await user.type(screen.getByLabelText('标题'), '阻止离开'); await guard!(leave);
    expect(leave).not.toHaveBeenCalled(); expect(await screen.findByText('未保存的修改')).toBeInTheDocument(); await user.click(screen.getByRole('button', { name: '放弃修改' })); expect(leave).toHaveBeenCalledOnce();
  });
});
