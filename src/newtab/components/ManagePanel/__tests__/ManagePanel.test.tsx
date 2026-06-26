import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { ManagePanel } from '@/newtab/components/ManagePanel';
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
  it('渲染所有 workspace 与 category 名称', () => {
    render(<ManagePanel visible={true} onCancel={() => {}} />);
    expect(screen.getByText('主工作区')).toBeTruthy();
    expect(screen.getByText('副工作区')).toBeTruthy();
    expect(screen.getByText('工作')).toBeTruthy();
  });

  it('点击工作区项进入编辑态，显示名称输入框与图标选择器', () => {
    render(<ManagePanel visible={true} onCancel={() => {}} />);
    // 点击「主工作区」进入编辑
    fireEvent.click(screen.getByText('主工作区'));
    expect(screen.getByTestId('icon-grid')).toBeTruthy();
    expect(screen.getByDisplayValue('主工作区')).toBeTruthy();
  });

  it('编辑名称后点保存调用 updateWorkspace', () => {
    const updateWorkspace = vi.fn();
    useWorkspace.setState({ updateWorkspace });
    render(<ManagePanel visible={true} onCancel={() => {}} />);

    fireEvent.click(screen.getByText('主工作区'));
    const input = screen.getByDisplayValue('主工作区') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '改名后' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(updateWorkspace).toHaveBeenCalledWith('w1', expect.objectContaining({ name: '改名后' }));
  });

  it('点击网格图标后点保存调用 updateWorkspace 带 icon', () => {
    const updateWorkspace = vi.fn();
    useWorkspace.setState({ updateWorkspace });
    render(<ManagePanel visible={true} onCancel={() => {}} />);

    fireEvent.click(screen.getByText('主工作区'));
    const grid = screen.getByTestId('icon-grid');
    fireEvent.click(grid.children[0]! as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(updateWorkspace).toHaveBeenCalledWith('w1', expect.objectContaining({ icon: expect.any(String) }));
  });

  it('编辑分类保存调用 updateCategory', () => {
    const updateCategory = vi.fn();
    useWorkspace.setState({ updateCategory });
    render(<ManagePanel visible={true} onCancel={() => {}} />);

    fireEvent.click(screen.getByText('工作'));
    const input = screen.getByDisplayValue('工作') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '生活' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(updateCategory).toHaveBeenCalledWith('c1', expect.objectContaining({ name: '生活' }));
  });

  it('取消编辑不调用 update', () => {
    const updateWorkspace = vi.fn();
    useWorkspace.setState({ updateWorkspace });
    render(<ManagePanel visible={true} onCancel={() => {}} />);

    fireEvent.click(screen.getByText('主工作区'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(updateWorkspace).not.toHaveBeenCalled();
  });
});
