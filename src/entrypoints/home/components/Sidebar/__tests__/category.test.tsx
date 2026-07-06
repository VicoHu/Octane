import { describe, it, expect, vi, beforeEach } from 'vitest';
// lottie-web 由 vitest.config.ts 全局 alias 处理（见 docs/standards/testing.md §4.4.1），无需 vi.mock
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ passwordSet: false, unlocked: false, openUnlockModal: vi.fn(), lockSession: vi.fn() }),
}));
vi.mock('@/services/cloud/providers', () => {
  const providers = {
    s3: { id: 's3', label: 'S3', configFields: [] },
    webdav: { id: 'webdav', label: 'WebDAV', configFields: [] },
  };
  return {
    cloudProviders: providers,
    getCloudProvider: (id: 's3' | 'webdav') => providers[id],
  };
});
vi.mock('@/services/CloudStorageService', () => ({ getLastBackupAt: () => Promise.resolve(null) }));
// PinnedArea 子组件有专属测试；这里 mock 掉避免触发 IndexedDB（本测试无 fake-indexeddb）
vi.mock('../../PinnedArea', () => ({ PinnedArea: () => null }));

import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../../Sidebar';
import { useWorkspace } from '@/store/useWorkspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }] as never,
    categories: [],
    currentWorkspaceId: 'w1',
    currentCategoryId: null,
  });
});

describe('Sidebar 分类列表（Semi List 迁移）', () => {
  it('空分类显示「暂无分类」', () => {
    render(<Sidebar />);
    expect(screen.getByText('暂无分类')).toBeTruthy();
  });

  it('渲染分类项（List.Item main）', () => {
    useWorkspace.setState({
      categories: [{ id: 'c1', name: '工作', icon: '💼' }] as never,
      currentCategoryId: 'c1',
      currentWorkspaceId: 'w1',
      workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }] as never,
    });
    render(<Sidebar />);
    expect(screen.getByText('💼 工作')).toBeTruthy();
  });

  it('点击分类项联动 selectCategory', () => {
    useWorkspace.setState({
      categories: [{ id: 'c2', name: '生活', icon: '🏠' }] as never,
      currentCategoryId: null,
      currentWorkspaceId: 'w1',
      workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }] as never,
    });
    const selectCategory = vi.fn();
    useWorkspace.setState({ selectCategory });
    render(<Sidebar />);
    fireEvent.click(screen.getByText('🏠 生活'));
    expect(selectCategory).toHaveBeenCalledWith('c2');
  });
});

describe('Sidebar 删除分类二次确认', () => {
  const setupWithCategory = (name = '工作', icon = '💼') => {
    useWorkspace.setState({
      categories: [{ id: 'c1', name, icon }] as never,
      currentCategoryId: 'c1',
      currentWorkspaceId: 'w1',
      workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }] as never,
    });
    const deleteCategory = vi.fn();
    useWorkspace.setState({ deleteCategory });
    return { deleteCategory };
  };

  // Semi Modal OK 按钮带 aria-label="confirm"，按可见文本「删除」定位
  const getOkButton = () => screen.getByText('删除').closest('button') as HTMLButtonElement;
  const openConfirm = (container: HTMLElement, name = '工作') =>
    fireEvent.click(container.querySelector(`[aria-label="删除分类 ${name}"]`)!);

  it('点击删除图标不立即删除，而是弹出二次确认', () => {
    const { deleteCategory } = setupWithCategory();
    const { container } = render(<Sidebar />);
    openConfirm(container);
    expect(deleteCategory).not.toHaveBeenCalled();
    // 警示文案：级联删除书签 + 上下文 + 不可恢复
    expect(screen.getByText(/同时删除该分类下的所有书签及其上下文/)).toBeTruthy();
    expect(screen.getByText(/不可恢复/)).toBeTruthy();
  });

  it('未输入正确短语时删除按钮禁用', () => {
    setupWithCategory();
    const { container } = render(<Sidebar />);
    openConfirm(container);
    expect(getOkButton().disabled).toBe(true);
  });

  it('输入正确短语后启用删除并执行级联删除', () => {
    const { deleteCategory } = setupWithCategory();
    const { container } = render(<Sidebar />);
    openConfirm(container);
    const input = screen.getByLabelText('确认删除短语') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '我确认删除工作 分类' } });
    expect(getOkButton().disabled).toBe(false);
    fireEvent.click(getOkButton());
    expect(deleteCategory).toHaveBeenCalledWith('c1');
  });

  it('短语匹配忽略空格差异', () => {
    setupWithCategory();
    const { container } = render(<Sidebar />);
    openConfirm(container);
    const input = screen.getByLabelText('确认删除短语') as HTMLInputElement;
    // 故意不输入中间空格
    fireEvent.change(input, { target: { value: '我确认删除工作分类' } });
    expect(getOkButton().disabled).toBe(false);
  });

  it('短语错误时删除按钮保持禁用', () => {
    setupWithCategory();
    const { container } = render(<Sidebar />);
    openConfirm(container);
    const input = screen.getByLabelText('确认删除短语') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '我确认删除' } });
    expect(getOkButton().disabled).toBe(true);
  });
});
