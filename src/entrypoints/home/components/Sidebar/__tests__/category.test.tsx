import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

const dndCallbacks = vi.hoisted(() => ({
  onDragEnd: undefined as ((event: unknown) => void | Promise<void>) | undefined,
}));
vi.mock('@dnd-kit/core', async (importActual) => {
  const actual = await importActual<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: (props: Parameters<typeof actual.DndContext>[0]) => {
      dndCallbacks.onDragEnd = props.onDragEnd as typeof dndCallbacks.onDragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});

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
    switching: null,
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

  it('空分类显示「点 + 添加分类」并保留标题行入口', () => {
    render(<Sidebar openTabs={[]} />);

    expect(screen.getByText('点 + 添加分类')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加分类' })).toBeInTheDocument();
  });

  it('添加分类入口 hover 显示 Tooltip', async () => {
    const user = userEvent.setup();
    render(<Sidebar openTabs={[]} />);

    await user.hover(screen.getByRole('button', { name: '添加分类' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('添加分类');
  });

  it('添加分类入口可聚焦并按 Enter 打开 Dialog', async () => {
    const user = userEvent.setup();
    render(<Sidebar openTabs={[]} />);
    const addButton = screen.getByRole('button', { name: '添加分类' });

    addButton.focus();
    expect(addButton).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('点击添加分类入口打开新建分类 Dialog 并创建分类', async () => {
    const user = userEvent.setup();
    const createCategory = vi.fn().mockResolvedValue(undefined);
    useWorkspace.setState({ createCategory });
    render(<Sidebar openTabs={[]} />);

    await user.click(screen.getByRole('button', { name: '添加分类' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('分类名称'), '新分类');
    await user.click(screen.getByRole('button', { name: '确定' }));

    expect(createCategory).toHaveBeenCalledWith('新分类', '📂');
  });

  it('工作区切换期间禁用添加分类入口且不打开 Dialog', async () => {
    const user = userEvent.setup();
    useWorkspace.setState({
      switching: { toId: 'w1', phase: 'dispose', count: 1, total: 2 },
    });
    render(<Sidebar openTabs={[]} />);
    const addButton = screen.getByRole('button', { name: '添加分类' });

    expect(addButton).toBeDisabled();
    await user.click(addButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('移除底部全宽添加入口并保留管理与设置', () => {
    render(<Sidebar openTabs={[]} />);
    const addButton = screen.getByRole('button', { name: '添加分类' });

    expect(addButton).not.toHaveTextContent('添加分类');
    expect(screen.getByRole('button', { name: '管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument();
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

  it('分类重排写入期间禁用添加入口且不打开 Dialog', async () => {
    const user = userEvent.setup();
    let resolveReorder: (() => void) | undefined;
    const reorderPending = new Promise<void>((resolve) => { resolveReorder = resolve; });
    const reorderCategories = vi.fn(() => reorderPending);
    setCats([{ id: 'c1', name: '工作', icon: '💼' }, { id: 'c2', name: '生活', icon: '🏠' }], 'c1');
    useWorkspace.setState({ reorderCategories });
    render(<Sidebar openTabs={[]} />);

    expect(dndCallbacks.onDragEnd).toBeDefined();
    act(() => {
      void dndCallbacks.onDragEnd?.({ active: { id: 'c1' }, over: { id: 'c2' } });
    });

    expect(reorderCategories).toHaveBeenCalledWith('w1', ['c2', 'c1']);
    const addButton = screen.getByRole('button', { name: '添加分类' });
    expect(addButton).toBeDisabled();
    await user.click(addButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      resolveReorder?.();
      await reorderPending;
    });
  });
});
