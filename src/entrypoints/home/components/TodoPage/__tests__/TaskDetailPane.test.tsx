import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({ loadNavigation: vi.fn(), queryTasks: vi.fn(), getTaskDetail: vi.fn() }));
const taskService = vi.hoisted(() => ({ patchTask: vi.fn(), replaceTaskTags: vi.fn(), moveTask: vi.fn(), setTaskCompletion: vi.fn(), softDeleteTask: vi.fn(), restoreTask: vi.fn(), deleteTaskPermanently: vi.fn() }));
const checklist = vi.hoisted(() => ({ createChecklistItem: vi.fn(), updateChecklistItem: vi.fn(), setChecklistItemCompletion: vi.fn(), reorderChecklistItems: vi.fn(), deleteChecklistItem: vi.fn() }));
const taskListService = vi.hoisted(() => ({ restoreTaskList: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/services/TodoQueryService', () => query);
vi.mock('@/services/TaskService', () => taskService);
vi.mock('@/services/ChecklistItemService', () => checklist);
vi.mock('@/services/TaskListService', () => taskListService);
vi.mock('@/components/ui/toast', () => ({ Toast: toast }));

import { TaskDetailPane } from '../TaskDetailPane';
import { useTodoData } from '@/store/useTodoData';
import { useTodoView } from '@/store/useTodoView';
import { useWorkspace } from '@/store/useWorkspace';

const workspaces = [{ id: 'w1', name: '工作', icon: 'Briefcase', order: 0, createdAt: 1 }, { id: 'w2', name: '个人', icon: 'Home', order: 1, createdAt: 1 }];
const task = { id: 't1', workspaceId: 'w1', listId: null, containerKey: '["w1",null]', title: '整理发布', description: '初始描述', priority: 'none' as const, dueDate: null, status: 'active' as const, order: 0, completedAt: null, deletedAt: null, createdAt: 1, updatedAt: 1 };
function detail(overrides: Record<string, unknown> = {}) { return { task, workspace: workspaces[0], taskList: null, taskTags: [{ id: 'tag1', workspaceId: 'w1', name: '重要', normalizedName: '重要', color: 'red' as const, order: 0, createdAt: 1, updatedAt: 1 }], checklistItems: [{ id: 'c1', taskId: 't1', text: '检查发布内容', isCompleted: false, completedAt: null, order: 0, createdAt: 1, updatedAt: 1 }], ...overrides } as never; }

beforeEach(() => {
  useTodoData.getState().reset(); useTodoView.getState().reset(); vi.clearAllMocks();
  const snapshot = detail();
  useWorkspace.setState({ workspaces, currentWorkspaceId: 'w1' });
  useTodoView.setState({ selectedTaskId: 't1' });
  useTodoData.setState({ detail: snapshot });
  query.getTaskDetail.mockResolvedValue(snapshot);
  query.loadNavigation.mockResolvedValue({ groups: [], counts: {} });
  taskService.patchTask.mockResolvedValue(task);
  taskService.replaceTaskTags.mockResolvedValue(undefined);
  taskService.moveTask.mockResolvedValue(task);
  taskService.setTaskCompletion.mockResolvedValue({ status: 'updated', task });
  checklist.createChecklistItem.mockResolvedValue({ id: 'new' });
  checklist.updateChecklistItem.mockResolvedValue({});
  checklist.setChecklistItemCompletion.mockResolvedValue({});
  checklist.reorderChecklistItems.mockResolvedValue(undefined);
  checklist.deleteChecklistItem.mockResolvedValue(undefined);
  taskListService.restoreTaskList.mockResolvedValue(undefined);
});

describe('TaskDetailPane', () => {
  it('标题失焦经真实 store action 调用 TaskService', async () => {
    const user = userEvent.setup(); render(<TaskDetailPane mobile={false} onBack={vi.fn()} />);
    const title = screen.getByLabelText('标题'); await user.clear(title); await user.type(title, '更新发布'); await user.tab();
    await waitFor(() => expect(taskService.patchTask).toHaveBeenCalledWith('t1', { title: '更新发布', description: '初始描述' }));
  });

  it('current-scope 导航只含 w1 时，Move 读取 all-scope 后可选 w2 List/Tag', async () => {
    const user = userEvent.setup();
    useTodoData.setState({ navigation: { groups: [{ workspace: workspaces[0], taskLists: [], taskTags: [], counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: {} } }], counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: {} } } as never });
    query.loadNavigation.mockResolvedValue({ groups: [{ workspace: workspaces[0], taskLists: [], taskTags: [], counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: {} } }, { workspace: workspaces[1], taskLists: [{ id: 'l2', workspaceId: 'w2', name: '个人清单', normalizedName: '个人清单', color: 'green', order: 0, archivedAt: null, createdAt: 1, updatedAt: 1 }], taskTags: [{ id: 'tag2', workspaceId: 'w2', name: '家庭', normalizedName: '家庭', color: 'blue', order: 0, createdAt: 1, updatedAt: 1 }], counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: {} } }], counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: {} } } as never);
    render(<TaskDetailPane mobile={false} onBack={vi.fn()} />); await user.click(screen.getByRole('button', { name: '移动待办' }));
    await user.click(await screen.findByRole('combobox', { name: '目标工作区' })); await user.click(await screen.findByRole('option', { name: '个人' }));
    await user.click(screen.getByRole('combobox', { name: '目标清单' })); await user.click(await screen.findByRole('option', { name: '个人清单' }));
    await user.click(screen.getByRole('checkbox', { name: '家庭' })); await user.click(screen.getByRole('button', { name: '移动待办' }));
    await waitFor(() => expect(taskService.moveTask).toHaveBeenCalledWith({ taskId: 't1', workspaceId: 'w2', listId: 'l2', tagIds: ['tag2'] }));
    expect(query.loadNavigation).toHaveBeenCalledWith({ kind: 'all' }, expect.any(String));
  });

  it('Checklist 创建失败保留输入，编辑失败回滚并显示 Toast', async () => {
    const user = userEvent.setup(); checklist.createChecklistItem.mockRejectedValue(new Error('创建失败')); checklist.updateChecklistItem.mockRejectedValue(new Error('更新失败'));
    render(<TaskDetailPane mobile={false} onBack={vi.fn()} />); const add = screen.getByLabelText('添加检查项'); await user.type(add, '不丢失'); await user.click(screen.getByRole('button', { name: '添加' }));
    expect(await screen.findByDisplayValue('不丢失')).toBeInTheDocument(); const item = screen.getByLabelText('检查项检查发布内容'); await user.clear(item); await user.type(item, '失败编辑'); await user.tab();
    await waitFor(() => expect(screen.getByLabelText('检查项检查发布内容')).toHaveValue('检查发布内容')); expect(toast.error).toHaveBeenCalledWith('更新失败');
  });

  it('完成待办要求确认，确认时不修改 Checklist', async () => {
    const user = userEvent.setup();
    taskService.setTaskCompletion.mockResolvedValueOnce({ status: 'confirmation-required', incompleteChecklistCount: 1 }).mockResolvedValueOnce({ status: 'updated', task });
    render(<TaskDetailPane mobile={false} onBack={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: /完成待办/ }));
    expect(await screen.findByText('还有 1 个未完成检查项。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '仍然完成' }));
    await waitFor(() => expect(taskService.setTaskCompletion).toHaveBeenLastCalledWith('t1', true, { allowIncompleteChecklist: true }));
    expect(checklist.setChecklistItemCompletion).not.toHaveBeenCalled();
  });

  it('Checklist 成功完成、撤销、编辑、重排、删除和创建均调用 Service', async () => {
    const user = userEvent.setup();
    const second = { id: 'c2', taskId: 't1', text: '第二项', isCompleted: false, completedAt: null, order: 1, createdAt: 1, updatedAt: 1 };
    const initial = detail({ checklistItems: [{ id: 'c1', taskId: 't1', text: '第一项', isCompleted: false, completedAt: null, order: 0, createdAt: 1, updatedAt: 1 }, second] });
    const completed = detail({ checklistItems: [{ id: 'c1', taskId: 't1', text: '第一项', isCompleted: true, completedAt: 2, order: 0, createdAt: 1, updatedAt: 2 }, second] });
    act(() => useTodoData.setState({ detail: initial })); query.getTaskDetail.mockResolvedValue(initial);
    render(<TaskDetailPane mobile={false} onBack={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: '完成第一项' }));
    await waitFor(() => expect(checklist.setChecklistItemCompletion).toHaveBeenCalledWith('c1', true));
    act(() => useTodoData.setState({ detail: completed })); query.getTaskDetail.mockResolvedValue(completed);
    await user.click(screen.getByRole('checkbox', { name: '完成第一项' }));
    await waitFor(() => expect(checklist.setChecklistItemCompletion).toHaveBeenLastCalledWith('c1', false));
    const first = screen.getByLabelText('检查项第一项'); await user.clear(first); await user.type(first, '更新第一项'); await user.tab();
    await user.click(screen.getByRole('button', { name: '下移「第一项」' })); await user.click(screen.getByRole('button', { name: '删除「第二项」' }));
    const add = screen.getByLabelText('添加检查项'); await user.type(add, '新增项'); await user.click(screen.getByRole('button', { name: '添加' }));
    await waitFor(() => expect(checklist.updateChecklistItem).toHaveBeenCalledWith('c1', '更新第一项'));
    expect(checklist.reorderChecklistItems).toHaveBeenCalledWith('t1', ['c2', 'c1']); expect(checklist.deleteChecklistItem).toHaveBeenCalledWith('c2'); expect(checklist.createChecklistItem).toHaveBeenCalledWith('t1', '新增项');
  });

  it('Priority 写入失败时恢复旧值并显示 Toast', async () => {
    const user = userEvent.setup(); taskService.patchTask.mockRejectedValue(new Error('优先级失败'));
    render(<TaskDetailPane mobile={false} onBack={vi.fn()} />);
    await user.click(screen.getByRole('combobox', { name: '优先级' })); await user.click(await screen.findByRole('option', { name: '高优先级' }));
    await waitFor(() => expect(taskService.patchTask).toHaveBeenCalledWith('t1', { priority: 'high' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: '优先级' })).toHaveTextContent('无优先级'));
    expect(toast.error).toHaveBeenCalledWith('优先级失败');
  });

  it('Priority pending 期间只提交一次并禁用控件，完成后恢复', async () => {
    const user = userEvent.setup();
    let resolve!: (value: typeof task) => void;
    const pending = new Promise<typeof task>((done) => { resolve = done; });
    taskService.patchTask.mockReturnValue(pending);
    render(<TaskDetailPane mobile={false} onBack={vi.fn()} />);
    await user.click(screen.getByRole('combobox', { name: '优先级' }));
    const high = await screen.findByRole('option', { name: '高优先级' });
    await user.dblClick(high);
    await waitFor(() => expect(taskService.patchTask).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('combobox', { name: '优先级' })).toBeDisabled();
    resolve(task);
    await waitFor(() => expect(screen.getByRole('combobox', { name: '优先级' })).not.toBeDisabled());
  });

  it('恢复归档清单刷新 detail 并解除只读', async () => {
    const user = userEvent.setup();
    const archivedList = { id: 'l1', workspaceId: 'w1', name: '归档清单', normalizedName: '归档清单', color: 'gray' as const, order: 0, archivedAt: 2, createdAt: 1, updatedAt: 2 };
    const archived = detail({ taskList: archivedList });
    const active = detail({ taskList: { ...archivedList, archivedAt: null, updatedAt: 3 } });
    act(() => useTodoData.setState({ detail: archived }));
    query.getTaskDetail.mockResolvedValueOnce(archived).mockResolvedValueOnce(active);
    render(<TaskDetailPane mobile={false} onBack={vi.fn()} />);
    expect(screen.getByLabelText('标题')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '恢复清单' }));
    await waitFor(() => expect(taskListService.restoreTaskList).toHaveBeenCalledWith('l1'));
    await waitFor(() => expect(screen.getByLabelText('标题')).not.toBeDisabled());
    expect(screen.queryByRole('button', { name: '恢复清单' })).not.toBeInTheDocument();
  });

  it('Trash 显示完整只读详情和恢复/永久删除命令', () => {
    useTodoData.setState({ detail: detail({ task: { ...task, deletedAt: 3 } }) }); render(<TaskDetailPane mobile={false} onBack={vi.fn()} />);
    expect(screen.getByLabelText('标题')).toBeDisabled(); expect(screen.getByText('收集箱')).toBeInTheDocument(); expect(screen.getByText('重要')).toBeInTheDocument(); expect(screen.getByText(/创建：/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: '恢复待办' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: '永久删除' })).toBeInTheDocument();
  });
});
