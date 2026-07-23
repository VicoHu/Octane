import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagePanel } from '../../ManagePanel';
import { useWorkspace } from '@/store/useWorkspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaces: [
      { id: 'w1', name: '主工作区', icon: '📁', createdAt: 1, order: 0 },
      { id: 'w2', name: '副工作区', icon: '💼', createdAt: 2, order: 1 },
    ],
    currentWorkspaceId: 'w1',
    categories: [
      { id: 'c1', workspaceId: 'w1', name: '工作', icon: '📂', order: 0, createdAt: 1 },
    ],
    currentCategoryId: 'c1',
  });
});

describe('ManagePanel — 工作区与分类管理', () => {
  it.each(['{enter}', ' '])('聚焦工作区主操作后按 %s 进入编辑态', async (key) => {
    const user = userEvent.setup();
    useWorkspace.setState({
      workspaces: [{ id: 'w1', name: '主工作区', icon: '📁', createdAt: 1, order: 0 }],
    });
    render(<ManagePanel visible={true} onCancel={() => {}} />);
    const editButton = screen.getByRole('button', { name: '编辑 主工作区' });

    editButton.focus();
    expect(editButton).toHaveFocus();
    await user.keyboard(key);

    expect(await screen.findByDisplayValue('主工作区')).toBeInTheDocument();
  });

  it('渲染所有 workspace 与 category 名称', () => {
    render(<ManagePanel visible={true} onCancel={() => {}} />);
    expect(screen.getByText('主工作区')).toBeInTheDocument();
    expect(screen.getByText('副工作区')).toBeInTheDocument();
    expect(screen.getByText('工作')).toBeInTheDocument();
  });

  it('点击工作区项进入编辑态，显示名称输入框与图标选择器', async () => {
    const user = userEvent.setup();
    render(<ManagePanel visible={true} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: '编辑 主工作区' }));
    expect(screen.getAllByRole('button', { name: /选择图标/ }).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('主工作区')).toBeInTheDocument();
  });

  it('编辑名称后点保存调用 updateWorkspace', async () => {
    const user = userEvent.setup();
    const updateWorkspace = vi.fn();
    useWorkspace.setState({ updateWorkspace });
    render(<ManagePanel visible={true} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: '编辑 主工作区' }));
    const input = screen.getByDisplayValue('主工作区');
    await user.clear(input);
    await user.type(input, '改名后');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(updateWorkspace).toHaveBeenCalledWith('w1', expect.objectContaining({ name: '改名后' }));
  });

  it('点击网格图标后点保存调用 updateWorkspace 带 icon', async () => {
    const user = userEvent.setup();
    const updateWorkspace = vi.fn();
    useWorkspace.setState({ updateWorkspace });
    render(<ManagePanel visible={true} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: '编辑 主工作区' }));
    await user.click(screen.getAllByRole('button', { name: /选择图标/ })[0]!);
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(updateWorkspace).toHaveBeenCalledWith('w1', expect.objectContaining({ icon: expect.any(String) }));
  });

  it('编辑分类保存调用 updateCategory', async () => {
    const user = userEvent.setup();
    const updateCategory = vi.fn();
    useWorkspace.setState({ updateCategory });
    render(<ManagePanel visible={true} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: '编辑 工作' }));
    const input = screen.getByDisplayValue('工作');
    await user.clear(input);
    await user.type(input, '生活');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(updateCategory).toHaveBeenCalledWith('c1', expect.objectContaining({ name: '生活' }));
  });

  it('取消编辑不调用 update', async () => {
    const user = userEvent.setup();
    const updateWorkspace = vi.fn();
    useWorkspace.setState({ updateWorkspace });
    render(<ManagePanel visible={true} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: '编辑 主工作区' }));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(updateWorkspace).not.toHaveBeenCalled();
  });

  it('删除工作区前显示永久删除确认，取消不删除', async () => {
    const user = userEvent.setup();
    const deleteWorkspace = vi.fn().mockResolvedValue(undefined);
    useWorkspace.setState({ deleteWorkspace });
    render(<ManagePanel visible={true} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: '删除工作区 主工作区' }));
    expect(await screen.findByText(/永久删除工作区「主工作区」及其全部内容/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(deleteWorkspace).not.toHaveBeenCalled();
    expect(screen.getByText('主工作区')).toBeInTheDocument();
  });

  it('确认删除工作区 → 调用级联删除并保留管理弹窗', async () => {
    const user = userEvent.setup();
    const deleteWorkspace = vi.fn().mockResolvedValue(undefined);
    useWorkspace.setState({ deleteWorkspace });
    render(<ManagePanel visible={true} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: '删除工作区 主工作区' }));
    await user.click(screen.getByRole('button', { name: '删除工作区' }));

    await waitFor(() => expect(deleteWorkspace).toHaveBeenCalledWith('w1'));
    expect(await screen.findByText('管理工作区与分类')).toBeInTheDocument();
  });
});

describe('ManagePanel workspace 拖拽(T8)', () => {
  const gripButtons = () =>
    screen.getAllByRole('button').filter((b) => b.getAttribute('aria-roledescription') === '可拖拽项');

  it('workspace 列表(>1):每 workspace 渲染常驻 grip(category 不排序)', () => {
    render(<ManagePanel visible={true} onCancel={() => {}} />);
    // beforeEach 2 workspaces + 1 category;grip 仅 workspace → 2(category 波3 不排序)
    expect(gripButtons()).toHaveLength(2);
  });

  it('workspace ≤1:不渲染 grip(纯 EntityEditRow)', () => {
    useWorkspace.setState({
      workspaces: [{ id: 'w1', name: '主工作区', icon: '📁', createdAt: 1, order: 0 }],
      currentWorkspaceId: 'w1',
      categories: [{ id: 'c1', workspaceId: 'w1', name: '工作', icon: '📂', order: 0, createdAt: 1 }],
      currentCategoryId: 'c1',
    });
    render(<ManagePanel visible={true} onCancel={() => {}} />);
    expect(gripButtons()).toHaveLength(0);
  });

  it('编辑态 Input 带 data-no-dnd(防拖拽时输入冲突)', async () => {
    const user = userEvent.setup();
    render(<ManagePanel visible={true} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: '编辑 主工作区' }));
    const input = screen.getByDisplayValue('主工作区');
    expect(input.hasAttribute('data-no-dnd')).toBe(true);
  });
});
