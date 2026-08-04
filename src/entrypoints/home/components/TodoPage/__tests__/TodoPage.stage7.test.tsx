import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoNavigation } from '../TodoNavigation';
import { TaskListDialog } from '../TaskListDialog';
import { TaskTagDialog } from '../TaskTagDialog';
import { QuickAddTask } from '../QuickAddTask';
import { TaskListPane } from '../TaskListPane';
import { TaskRow } from '../TaskRow';
import { useTodoData } from '@/store/useTodoData';
import { useTodoView } from '@/store/useTodoView';
import { useWorkspace } from '@/store/useWorkspace';
import type { TaskRow as TaskRowData } from '@/services/TodoQueryService';
import type { Workspace } from '@/shared/types';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ Toast: toast }));

if (!Element.prototype.getAnimations) {
  Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [] });
}

const workspaces: Workspace[] = [
  { id: 'w1', name: '工作', icon: 'Briefcase', order: 0, createdAt: 1 },
  { id: 'w2', name: '个人', icon: 'Home', order: 1, createdAt: 1 },
];

function row(overrides: Partial<TaskRowData> = {}): TaskRowData {
  return {
    id: 't1',
    task: {
      id: 't1', workspaceId: 'w1', listId: null, containerKey: '["w1",null]', title: '整理发布',
      description: '发布说明内容', priority: 'high', dueDate: '2026-08-19', status: 'active', order: 0,
      completedAt: null, deletedAt: null, createdAt: 1, updatedAt: 1,
    },
    workspace: workspaces[0]!, taskList: null, listName: '收集箱', taskTags: [], hiddenTagCount: 0,
    checklistCompletedCount: 1, checklistTotalCount: 2,
    searchMatch: { source: 'description', summary: '发布说明内容' },
    ...overrides,
  };
}

beforeEach(() => {
  useTodoData.getState().reset();
  useTodoView.getState().reset();
  useWorkspace.setState({ workspaces, currentWorkspaceId: 'w1' });
  vi.clearAllMocks();
});

describe('TodoNavigation — 导航和管理入口', () => {
  it('使用导航快照计数，并且零计数不显示', () => {
    useTodoData.setState({
      navigation: {
        counts: { today: 2, next7: 0, inbox: 1, trash: 3, archivedLists: 1, list: { l1: 4 }, tag: { tag1: 2 } },
        groups: [{
          workspace: workspaces[0]!,
          taskLists: [
            { id: 'l1', workspaceId: 'w1', name: '发布', normalizedName: '发布', color: 'green', order: 0, archivedAt: null, createdAt: 1, updatedAt: 1 },
          ],
          taskTags: [
            { id: 'tag1', workspaceId: 'w1', name: '重要', normalizedName: '重要', color: 'red', order: 0, createdAt: 1, updatedAt: 1 },
          ],
          counts: { today: 2, next7: 0, inbox: 1, trash: 3, archivedLists: 1, list: { l1: 4 }, tag: { tag1: 2 } },
        }],
      },
    });

    render(<TodoNavigation activePage="tasks" onNavigate={vi.fn()} open={false} onOpenChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /今天.*2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /未来 7 天/ })).not.toHaveTextContent('0');
    expect(screen.getByRole('button', { name: /发布.*4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重要.*2/ })).toBeInTheDocument();
  });

  it('所有工作区创建清单时显示工作区且默认当前工作区', async () => {
    const user = userEvent.setup();
    const createTaskList = vi.fn().mockResolvedValue(undefined);
    useTodoData.setState({ createTaskList } as never);

    render(<TaskListDialog open onOpenChange={vi.fn()} workspaces={workspaces} currentWorkspaceId="w1" />);

    expect(screen.getByRole('combobox', { name: '工作区' })).toHaveTextContent('工作');
    await user.type(screen.getByLabelText('清单名称'), '项目');
    await user.click(screen.getByRole('button', { name: '创建清单' }));

    await waitFor(() => expect(createTaskList).toHaveBeenCalledWith('w1', expect.objectContaining({ name: '项目' })));
  });

  it('归档清单有未完成任务时要求确认', async () => {
    const user = userEvent.setup();
    const archiveTaskList = vi.fn().mockResolvedValue({ status: 'confirmation-required', incompleteCount: 2 });
    useTodoData.setState({ archiveTaskList } as never);

    render(<TaskListDialog open onOpenChange={vi.fn()} workspaces={workspaces} currentWorkspaceId="w1" taskList={{ id: 'l1', workspaceId: 'w1', name: '项目', normalizedName: '项目', color: 'green', order: 0, archivedAt: null, createdAt: 1, updatedAt: 1 }} action="archive" />);
    await user.click(screen.getByRole('button', { name: '归档清单' }));

    expect(await screen.findByText('其中有 2 条未完成待办')).toBeInTheDocument();
  });

  it('删除标签展示关联任务影响', async () => {
    const getTaskTagDeleteImpact = vi.fn().mockResolvedValue({ affectedTaskCount: 3 });
    useTodoData.setState({ getTaskTagDeleteImpact } as never);

    render(<TaskTagDialog open onOpenChange={vi.fn()} workspaces={workspaces} currentWorkspaceId="w1" taskTag={{ id: 'tag1', workspaceId: 'w1', name: '重要', normalizedName: '重要', color: 'red', order: 0, createdAt: 1, updatedAt: 1 }} action="delete" />);

    expect(await screen.findByText('将从 3 条待办移除此标签')).toBeInTheDocument();
  });
});

describe('QuickAddTask — 上下文继承', () => {
  it('标签视图继承标签所属工作区和当前优先级', async () => {
    const user = userEvent.setup();
    const createTask = vi.fn().mockResolvedValue({ id: 'new' });
    useTodoData.setState({ createTask } as never);

    render(<QuickAddTask view={{ kind: 'tag', tagId: 'tag2' }} scopeMode="all" currentWorkspaceId="w1" today="2026-08-20" priority="high" tagWorkspaceId="w2" />);
    await user.type(screen.getByLabelText('快速添加待办'), '给妈妈打电话{Enter}');

    await waitFor(() => expect(createTask).toHaveBeenCalledWith({ workspaceId: 'w2', listId: null, tagIds: ['tag2'], priority: 'high', title: '给妈妈打电话' }));
  });

  it('未来七天默认今天截止日期且在所有工作区显示工作区选择', async () => {
    const user = userEvent.setup();
    const createTask = vi.fn().mockResolvedValue({ id: 'new' });
    useTodoData.setState({ createTask } as never);

    render(<QuickAddTask view={{ kind: 'next7' }} scopeMode="all" currentWorkspaceId="w1" today="2026-08-20" priority="all" workspaces={workspaces} />);
    expect(screen.getByRole('combobox', { name: '工作区' })).toHaveTextContent('工作');
    expect(screen.getByLabelText('截止日期')).toHaveValue('2026-08-20');
    await user.type(screen.getByLabelText('快速添加待办'), '准备材料{Enter}');

    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w1', listId: null, dueDate: '2026-08-20', title: '准备材料' })));
  });
});

describe('TaskRow — 搜索、完成与选择', () => {
  it('描述命中显示父待办及摘要，Checkbox 不触发行选择', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(<TaskRow row={row()} selected={false} scopeMode="all" onSelect={onSelect} onToggleCompletion={onToggle} onDelete={vi.fn()} />);

    expect(screen.getByText('发布说明内容')).toBeInTheDocument();
    expect(screen.getByText('工作')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: '完成整理发布' }));

    expect(onToggle).toHaveBeenCalledWith(row().task, true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('TaskListPane — 完成、删除与快捷创建', () => {
  it('未完成检查项要求确认后才完成待办', async () => {
    const user = userEvent.setup();
    const setTaskCompletion = vi.fn()
      .mockResolvedValueOnce({ status: 'confirmation-required', incompleteChecklistCount: 2 })
      .mockResolvedValueOnce({ status: 'updated', task: { ...row().task, status: 'completed' } });
    useTodoData.setState({ queryResult: { active: [row()], completed: [], total: 1, effectiveSort: 'manual' }, setTaskCompletion } as never);
    useTodoView.setState({ selectedTaskId: 't1', statusFilter: 'active', view: { kind: 'inbox' } });

    render(<TaskListPane onOpenNavigation={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: '完成整理发布' }));
    expect(await screen.findByText('还有 2 个未完成检查项')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '仍然完成' }));

    await waitFor(() => expect(setTaskCompletion).toHaveBeenLastCalledWith('t1', true, { allowIncompleteChecklist: true }));
  });

  it('完成选中任务后 active-only 移除行并提供撤销', async () => {
    const user = userEvent.setup();
    const setTaskCompletion = vi.fn().mockResolvedValue({ status: 'updated', task: { ...row().task, status: 'completed' } });
    useTodoData.setState({ queryResult: { active: [row()], completed: [], total: 1, effectiveSort: 'manual' }, setTaskCompletion } as never);
    useTodoView.setState({ selectedTaskId: 't1', statusFilter: 'active', view: { kind: 'inbox' } });

    render(<TaskListPane onOpenNavigation={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: '完成整理发布' }));

    await waitFor(() => expect(screen.queryByText('整理发布')).not.toBeInTheDocument());
    expect(useTodoView.getState().selectedTaskId).toBe('t1');
    expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ label: '撤销' }) }));
  });

  it('删除选中任务后优先选择下一行并提供恢复', async () => {
    const user = userEvent.setup();
    const softDeleteTask = vi.fn().mockResolvedValue(undefined);
    useTodoData.setState({ queryResult: { active: [row(), row({ id: 't2', task: { ...row().task, id: 't2', title: '下一条' } })], completed: [], total: 2, effectiveSort: 'manual' }, softDeleteTask } as never);
    useTodoView.setState({ selectedTaskId: 't1', statusFilter: 'active', view: { kind: 'inbox' } });

    render(<TaskListPane onOpenNavigation={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '整理发布更多操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '删除待办' }));

    await waitFor(() => expect(useTodoView.getState().selectedTaskId).toBe('t2'));
    expect(toast.success).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ label: '恢复' }) }));
  });

  it('删除后切到废纸篓能看到该待办（hiddenIds 不跨视图泄漏）', async () => {
    const user = userEvent.setup();
    const softDeleteTask = vi.fn().mockResolvedValue(undefined);
    useTodoData.setState({ queryResult: { active: [row()], completed: [], total: 1, effectiveSort: 'manual' }, softDeleteTask } as never);
    useTodoView.setState({ selectedTaskId: 't1', statusFilter: 'active', view: { kind: 'inbox' } });

    render(<TaskListPane onOpenNavigation={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '整理发布更多操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '删除待办' }));

    // 乐观隐藏生效：收集箱中暂时不可见
    await waitFor(() => expect(screen.queryByText('整理发布')).not.toBeInTheDocument());

    // 切到废纸篓，新查询结果已含刚删除的待办
    const deletedRow = row({ task: { ...row().task, deletedAt: 100 } });
    useTodoData.setState({ queryResult: { active: [deletedRow], completed: [], total: 1, effectiveSort: 'manual' } } as never);
    useTodoView.setState({ view: { kind: 'trash' } });

    expect(await screen.findByText('整理发布')).toBeInTheDocument();
  });

  it('废纸篓行菜单为「恢复待办 / 永久删除」，永久删除需二次确认', async () => {
    const user = userEvent.setup();
    const deleteTaskPermanently = vi.fn().mockResolvedValue(undefined);
    const restoreTask = vi.fn().mockResolvedValue({ ...row().task, deletedAt: null });
    useTodoData.setState({
      queryResult: { active: [row({ task: { ...row().task, deletedAt: 100 } })], completed: [], total: 1, effectiveSort: 'manual' },
      deleteTaskPermanently, restoreTask,
    } as never);
    useTodoView.setState({ selectedTaskId: 't1', view: { kind: 'trash' } });

    render(<TaskListPane onOpenNavigation={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '整理发布更多操作' }));
    // 废纸篓菜单不再出现误导性的「删除待办」，而是「恢复待办 / 永久删除」
    expect(await screen.findByRole('menuitem', { name: '恢复待办' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '删除待办' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '永久删除' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: '永久删除' }));
    expect(await screen.findByRole('heading', { name: '永久删除待办' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '永久删除' }));

    await waitFor(() => expect(deleteTaskPermanently).toHaveBeenCalledWith('t1'));
  });
});
