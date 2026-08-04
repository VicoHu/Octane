import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskMoveDialog } from '../TaskMoveDialog';

const workspaces = [{ id: 'w1', name: '工作', icon: 'Briefcase', order: 0, createdAt: 1 }, { id: 'w2', name: '个人', icon: 'Home', order: 1, createdAt: 1 }];
const task = { id: 't1', workspaceId: 'w1', listId: null, containerKey: '["w1",null]', title: '迁移任务', description: '', priority: 'none' as const, dueDate: null, status: 'active' as const, order: 0, completedAt: null, deletedAt: null, createdAt: 1, updatedAt: 1 };
const tag = { id: 'old', workspaceId: 'w1', name: '来源标签', normalizedName: '来源标签', color: 'red' as const, order: 0, createdAt: 1, updatedAt: 1 };

describe('TaskMoveDialog', () => {
  it('跨工作区只提交用户明确选择的目标清单与标签', async () => {
    const user = userEvent.setup(); const moveTask = vi.fn().mockResolvedValue({});
    render(<TaskMoveDialog open onOpenChange={vi.fn()} task={task} sourceTags={[tag]} workspaces={workspaces} groups={[{ workspace: workspaces[1]!, taskLists: [{ id: 'l2', workspaceId: 'w2', name: '个人项目', normalizedName: '个人项目', color: 'green', order: 0, archivedAt: null, createdAt: 1, updatedAt: 1 }], taskTags: [{ id: 'new', workspaceId: 'w2', name: '家庭', normalizedName: '家庭', color: 'blue', order: 0, createdAt: 1, updatedAt: 1 }], counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: {} } }]} moveTask={moveTask} />);
    await user.click(screen.getByRole('combobox', { name: '目标工作区' }));
    await user.click(await screen.findByRole('option', { name: '个人' }));
    await user.click(screen.getByRole('combobox', { name: '目标清单' }));
    await user.click(await screen.findByRole('option', { name: '个人项目' }));
    await user.click(screen.getByRole('checkbox', { name: '家庭' }));
    await user.click(screen.getByRole('button', { name: '移动待办' }));
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith({ taskId: 't1', workspaceId: 'w2', listId: 'l2', tagIds: ['new'] }));
  });

  it('归档来源清单打开时默认目标为收集箱', async () => {
    const user = userEvent.setup();
    const moveTask = vi.fn().mockResolvedValue({});
    const archivedTask = { ...task, listId: 'archived' };
    render(<TaskMoveDialog open onOpenChange={vi.fn()} task={archivedTask} sourceTags={[tag]} workspaces={workspaces} groups={[{ workspace: workspaces[0]!, taskLists: [{ id: 'archived', workspaceId: 'w1', name: '归档清单', normalizedName: '归档清单', color: 'gray', order: 0, archivedAt: 1, createdAt: 1, updatedAt: 1 }], taskTags: [tag], counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 1, list: {}, tag: {} } }]} moveTask={moveTask} />);
    expect(screen.getByRole('combobox', { name: '目标清单' })).toHaveTextContent('收集箱');
    await user.click(screen.getByRole('button', { name: '移动待办' }));
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith(expect.objectContaining({ listId: null })));
  });

  it('Service 失败时保留 dialog 与用户选择', async () => {
    const user = userEvent.setup(); const moveTask = vi.fn().mockRejectedValue(new Error('移动失败'));
    render(<TaskMoveDialog open onOpenChange={vi.fn()} task={task} sourceTags={[tag]} workspaces={workspaces} groups={[]} moveTask={moveTask} />);
    await user.click(screen.getByRole('button', { name: '移动待办' }));
    expect(await screen.findByText('移动失败')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
