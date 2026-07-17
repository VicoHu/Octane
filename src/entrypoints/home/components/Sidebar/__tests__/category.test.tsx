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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../../Sidebar';
import { useWorkspace } from '@/store/useWorkspace';

const setCats = (cats: Array<{ id: string; name: string; icon: string }>, currentCategoryId: string | null = null) => {
  useWorkspace.setState({
    categories: cats as never,
    currentCategoryId,
    currentWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }] as never,
  });
};

const gripButtons = () =>
  screen.getAllByRole('button').filter((b) => b.getAttribute('aria-roledescription') === '可拖拽项');

beforeEach(() => {
  useWorkspace.setState({
    workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }] as never,
    categories: [],
    currentWorkspaceId: 'w1',
    currentCategoryId: null,
  });
});

describe('Sidebar 分类列表（Semi List 迁移）', () => {
  it.each(['{Enter}', ' '])('聚焦分类主操作后按 %s 选择分类', async (key) => {
    const user = userEvent.setup();
    setCats([{ id: 'c2', name: '生活', icon: '🏠' }]);
    const selectCategory = vi.fn();
    useWorkspace.setState({ selectCategory });
    render(<Sidebar openTabs={[]} />);
    const categoryButton = screen.getByRole('button', { name: '选择分类 生活' });

    categoryButton.focus();
    await user.keyboard(key);

    expect(selectCategory).toHaveBeenCalledWith('c2');
  });

  it('空分类显示「暂无分类」', () => {
    render(<Sidebar openTabs={[]} />);
    expect(screen.getByText('暂无分类')).toBeInTheDocument();
  });

  it('渲染分类项（List.Item main）', () => {
    useWorkspace.setState({
      categories: [{ id: 'c1', name: '工作', icon: '💼' }] as never,
      currentCategoryId: 'c1',
      currentWorkspaceId: 'w1',
      workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }] as never,
    });
    render(<Sidebar openTabs={[]} />);
    expect(screen.getByText('💼 工作')).toBeInTheDocument();
  });

  it('点击分类项联动 selectCategory', async () => {
    const user = userEvent.setup();
    useWorkspace.setState({
      categories: [{ id: 'c2', name: '生活', icon: '🏠' }] as never,
      currentCategoryId: null,
      currentWorkspaceId: 'w1',
      workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }] as never,
    });
    const selectCategory = vi.fn();
    useWorkspace.setState({ selectCategory });
    render(<Sidebar openTabs={[]} />);
    await user.click(screen.getByRole('button', { name: '选择分类 生活' }));
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
  const getOkButton = () => screen.getByRole('button', { name: '删除' });
  const openConfirm = async (user: ReturnType<typeof userEvent.setup>, name = '工作') =>
    user.click(screen.getByRole('button', { name: `删除分类 ${name}` }));

  it('点击删除图标不立即删除，而是弹出二次确认', async () => {
    const user = userEvent.setup();
    const { deleteCategory } = setupWithCategory();
    const selectCategory = vi.fn();
    useWorkspace.setState({ selectCategory });
    render(<Sidebar openTabs={[]} />);
    await openConfirm(user);
    expect(deleteCategory).not.toHaveBeenCalled();
    expect(selectCategory).not.toHaveBeenCalled();
    // 警示文案：级联删除书签 + 上下文 + 不可恢复
    expect(screen.getByText(/同时删除该分类下的所有书签及其上下文/)).toBeInTheDocument();
    expect(screen.getByText(/不可恢复/)).toBeInTheDocument();
  });

  it('未输入正确短语时删除按钮禁用', async () => {
    const user = userEvent.setup();
    setupWithCategory();
    render(<Sidebar openTabs={[]} />);
    await openConfirm(user);
    expect(getOkButton()).toBeDisabled();
  });

  it('输入正确短语后启用删除并执行级联删除', async () => {
    const user = userEvent.setup();
    const { deleteCategory } = setupWithCategory();
    render(<Sidebar openTabs={[]} />);
    await openConfirm(user);
    await user.type(screen.getByLabelText('确认删除短语'), '我确认删除工作 分类');
    expect(getOkButton()).toBeEnabled();
    await user.click(getOkButton());
    expect(deleteCategory).toHaveBeenCalledWith('c1');
  });

  it('短语匹配忽略空格差异', async () => {
    const user = userEvent.setup();
    setupWithCategory();
    render(<Sidebar openTabs={[]} />);
    await openConfirm(user);
    // 故意不输入中间空格
    await user.type(screen.getByLabelText('确认删除短语'), '我确认删除工作分类');
    expect(getOkButton()).toBeEnabled();
  });

  it('短语错误时删除按钮保持禁用', async () => {
    const user = userEvent.setup();
    setupWithCategory();
    render(<Sidebar openTabs={[]} />);
    await openConfirm(user);
    await user.type(screen.getByLabelText('确认删除短语'), '我确认删除');
    expect(getOkButton()).toBeDisabled();
  });
});

describe('Sidebar 分类拖拽(T6)', () => {
  it('>1 分类:每分类渲染 grip 手柄', () => {
    setCats([{ id: 'c1', name: '工作', icon: '💼' }, { id: 'c2', name: '生活', icon: '🏠' }], 'c1');
    render(<Sidebar openTabs={[]} />);
    expect(gripButtons()).toHaveLength(2);
  });

  it('≤1 分类:不渲染 grip(纯 List.Item 无 Sortable)', () => {
    setCats([{ id: 'c1', name: '工作', icon: '💼' }], 'c1');
    render(<Sidebar openTabs={[]} />);
    expect(gripButtons()).toHaveLength(0);
  });

  it('IconDelete 带 data-no-dnd(防拖拽冒泡)', () => {
    setCats([{ id: 'c1', name: '工作', icon: '💼' }, { id: 'c2', name: '生活', icon: '🏠' }], 'c1');
    render(<Sidebar openTabs={[]} />);
    expect(screen.getByRole('button', { name: '删除分类 工作' })).toHaveAttribute('data-no-dnd');
  });
});
