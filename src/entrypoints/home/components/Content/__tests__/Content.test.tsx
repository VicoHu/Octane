import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { type ReactNode } from 'react';
const contentMocks = vi.hoisted(() => ({ bookmarkCardSpy: vi.fn() }));
// 隔离子组件依赖
vi.mock('../../ContextList', () => ({ ContextList: () => null }));
vi.mock('../../BookmarkCard', () => ({
  BookmarkCard: (props: Record<string, unknown>) => {
    contentMocks.bookmarkCardSpy(props);
    const bookmark = props.bookmark as { id: string; name: string };
    return React.createElement('button', {
      'data-testid': `card-${bookmark.id}`,
      onClick: () => (props.onEditBookmark as (b: unknown) => void)(bookmark),
    }, `编辑-${bookmark.name}`);
  },
}));
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), close: vi.fn() },
}));

// 可控 useBookmarks 状态(测试间重置)
let bookmarksState: Record<string, unknown>;
let pinnedTabsState: Record<string, unknown>;
const useBookmarksMock = vi.hoisted(() => ({
  fn: (sel: (s: Record<string, unknown>) => unknown) => sel(bookmarksState),
  getState: () => bookmarksState,
}));
vi.mock('@/store/useBookmarks', () => ({
  useBookmarks: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => useBookmarksMock.fn(sel),
    { getState: () => useBookmarksMock.getState() },
  ),
}));
vi.mock('@/store/useSearch', () => ({
  useSearch: (sel: (s: Record<string, unknown>) => unknown) => sel({ query: '', setQuery: vi.fn() }),
}));
vi.mock('@/store/usePinnedTabs', () => ({
  usePinnedTabs: (sel: (s: Record<string, unknown>) => unknown) => sel(pinnedTabsState),
}));
vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => ({ kind: 'third-party', src: 'blob:test', onError: vi.fn() })),
}));

// BookmarkService mock：编辑流程（#49）需捕获 updateBookmark / listBookmarksByWorkspace
const bookmarkServiceMocks = vi.hoisted(() => ({
  updateBookmark: vi.fn(async () => {}),
  listBookmarksByWorkspace: vi.fn(async () => [] as import('@/shared/types').Bookmark[]),
}));
vi.mock('@/services/BookmarkService', () => ({
  updateBookmark: bookmarkServiceMocks.updateBookmark,
  listBookmarksByWorkspace: bookmarkServiceMocks.listBookmarksByWorkspace,
}));

// CategoryService mock：编辑面板级联 Select 的 categoriesLoader
const categoryServiceMocks = vi.hoisted(() => ({
  listCategories: vi.fn(async (_wsId: string): Promise<import('@/shared/types').Category[]> => []),
}));
vi.mock('@/services/CategoryService', () => ({
  listCategories: categoryServiceMocks.listCategories,
}));

import { Content } from '../../Content';
import { Toast } from '@/components/ui/toast';
import type { OpenTab } from '../../../hooks/useOpenTabs';
import type { Bookmark } from '@/shared/types';
import { useWorkspace } from '@/store/useWorkspace';

beforeEach(() => {
  contentMocks.bookmarkCardSpy.mockClear();
  bookmarkServiceMocks.updateBookmark.mockClear();
  bookmarkServiceMocks.updateBookmark.mockResolvedValue(undefined);
  bookmarkServiceMocks.listBookmarksByWorkspace.mockClear();
  bookmarkServiceMocks.listBookmarksByWorkspace.mockResolvedValue([]);
  categoryServiceMocks.listCategories.mockClear();
  categoryServiceMocks.listCategories.mockImplementation(async (wsId: string) =>
    wsId === 'w1'
      ? [{ id: 'c1', workspaceId: 'w1', name: '分类1', icon: '📁', order: 0, createdAt: 0 }]
      : [{ id: 'c2', workspaceId: 'w2', name: '分类2', icon: '📂', order: 0, createdAt: 0 }],
  );
  bookmarksState = {
    loading: false,
    bookmarks: [],
    allBookmarks: [],
    loadBookmarks: vi.fn(),
    loadAllByWorkspace: vi.fn(),
    createBookmark: vi.fn(async () => ({ id: 'b1' })),
    refreshBookmark: vi.fn(async () => {}),
    moveBookmark: vi.fn(async () => {}),
  };
  useWorkspace.setState({
    categories: [{ id: 'c1', workspaceId: 'w1', name: '工作', icon: '💼', order: 0, createdAt: 0 }],
    currentCategoryId: 'c1',
    currentWorkspaceId: 'w1',
    workspaces: [],
  });
  pinnedTabsState = {
    pinnedTabs: [],
    loading: false,
    loadPinnedTabs: vi.fn(),
    createPinnedTab: vi.fn(async (_ws: string, data: { name: string; url: string }) =>
      ({ id: 'p1', workspaceId: _ws, name: data.name, url: data.url, order: 0, createdAt: 0 }) as never),
    deletePinnedTab: vi.fn(),
    reorderPinnedTabs: vi.fn(),
  };

});


describe('Content 全局快捷键门控', () => {
  it('inactive 时 Ctrl/Cmd + K 不聚焦搜索，重新激活后恢复响应', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Content openTabs={[]} active={false} />);
    const searchInput = screen.getByPlaceholderText('搜索书签、分类或已打开页面...');
    const anotherButton = screen.getAllByRole('button', { name: '添加书签' })[0]!;
    await user.click(anotherButton);
    await user.keyboard('{Control>}k{/Control}');

    expect(searchInput).not.toHaveFocus();

    rerender(<Content openTabs={[]} active />);
    await user.keyboard('{Control>}k{/Control}');
    expect(searchInput).toHaveFocus();
  });
});

describe('Content runtime favicon 分发', () => {
  it('匹配打开 Tab 后把 runtime favicon 传给 BookmarkCard', () => {
    bookmarksState.bookmarks = [{
      id: 'b1', workspaceId: 'w1', categoryId: 'c1', name: 'GitHub',
      url: 'https://github.com', description: '', faviconUrl: '', contextCount: 0,
      hasEncryptedContext: false, createdAt: 1, updatedAt: 1,
    }];
    const openTabs: OpenTab[] = [{
      url: 'https://github.com/settings', tabId: 7, lastAccessed: 100,
      favIconUrl: 'https://github.com/runtime.svg',
    }];

    render(<Content openTabs={openTabs} />);

    expect(contentMocks.bookmarkCardSpy).toHaveBeenCalledWith(expect.objectContaining({
      hasOpenTab: true,
      runtimeFavIconUrl: 'https://github.com/runtime.svg',
    }));
  });

});

describe('Content 骨架屏（T2）', () => {
  it('loading=true 且书签视图时渲染 Semi Skeleton 骨架', () => {
    bookmarksState.loading = true;
    render(<Content openTabs={[]} />);
    expect(screen.getAllByText((_, element) => element?.getAttribute('data-slot') === 'skeleton').length)
      .toBeGreaterThan(0);
  });
});

describe('Content 视图切换状态机(Tabs type=card)', () => {
  // Semi Tabs:每个切换项 role="tab";[0]=书签 [1]=标签页
  it('默认书签视图:Tabs 含「书签」与「标签页(N)」两项', () => {
    render(<Content openTabs={[]} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    // jsdom 无 chrome → useOpenTabs 返回 [] → 标签页计数 0
    expect(screen.getByRole('tab', { name: '标签页 0' })).toBeInTheDocument();
    // 默认书签视图:不应出现 tabs 视图的空状态文案(keepDOM=false 仅渲染活动面板)
    expect(screen.queryByText('当前窗口没有其他标签页')).not.toBeInTheDocument();
  });

  it('切到标签页视图:点击 标签页 tab → 渲染 TabList 空状态 + 保存至提示', async () => {
    const user = userEvent.setup();
    render(<Content openTabs={[]} />);
    await user.click(screen.getByRole('tab', { name: '标签页 0' }));

    expect(screen.getByText('当前窗口没有其他标签页')).toBeInTheDocument();
    expect(screen.getByText(/保存至/)).toBeInTheDocument();
  });

  it('切回书签视图:不再渲染 TabList', async () => {
    const user = userEvent.setup();
    render(<Content openTabs={[]} />);
    await user.click(screen.getByRole('tab', { name: '标签页 0' }));
    expect(screen.getByText('当前窗口没有其他标签页')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '书签 0' }));
    expect(screen.queryByText('当前窗口没有其他标签页')).not.toBeInTheDocument();
  });

  it('标签页 Cmd/Ctrl + 左键 → 在当前窗口最右侧后台创建 URL', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ index: 0 }, { index: 4 }]);
    const create = vi.fn().mockResolvedValue(undefined);
    (globalThis as unknown as { chrome: unknown }).chrome = { tabs: { query, create } };
    const openTabs: OpenTab[] = [{ url: 'https://github.com', tabId: 7, lastAccessed: 0, title: 'GitHub' }];

    render(<Content openTabs={openTabs} />);
    await user.click(screen.getByRole('tab', { name: '标签页 1' }));
    const openButton = screen.getByRole('button', { name: '打开标签页 GitHub' });
    await user.keyboard('[MetaLeft>]');
    await user.click(openButton);
    await user.keyboard('[/MetaLeft]');

    expect(query).toHaveBeenCalledWith({ currentWindow: true });
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      url: 'https://github.com',
      active: false,
      index: 5,
    }));
  });
});

describe('Content 添加书签反馈', () => {
  it('保存成功后的「添加上下文」为真实按钮', async () => {
    const user = userEvent.setup();
    render(<Content openTabs={[]} />);
    await user.click(screen.getAllByRole('button', { name: '添加书签' })[0]!);
    await user.type(await screen.findByPlaceholderText('https://example.com'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => expect(Toast.success).toHaveBeenCalledTimes(1));
    const toast = vi.mocked(Toast.success).mock.calls[0]![0] as { content: ReactNode };
    render(toast.content);

    expect(screen.getByRole('button', { name: '添加上下文' })).toBeInTheDocument();
  });
});

describe('Content 添加书签 Tag 录入（#48）', () => {
  it('添加书签时输入 Tag → createBookmark 携带规范化 tags', async () => {
    const user = userEvent.setup();
    const createBookmark = vi.fn(async () => ({ id: 'b1', tags: [] }));
    bookmarksState.createBookmark = createBookmark;
    render(<Content openTabs={[]} />);

    await user.click(screen.getAllByRole('button', { name: '添加书签' })[0]!);
    await user.type(await screen.findByPlaceholderText('https://example.com'), 'https://example.com');
    // 输入 Tag 并回车添加
    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加.*[Tt]ag/), 'React{Enter}');
    await user.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => expect(createBookmark).toHaveBeenCalledTimes(1));
    expect(createBookmark).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ tags: ['React'] }),
    );
  });

  it('从标签页保存时同样可录入 Tag', async () => {
    const user = userEvent.setup();
    const createBookmark = vi.fn(async () => ({ id: 'b2', tags: [] }));
    bookmarksState.createBookmark = createBookmark;
    bookmarksState.allBookmarks = [{ id: 'exist', tags: ['Vue'] }];

    const openTabs: OpenTab[] = [{
      url: 'https://vuejs.org', tabId: 1, lastAccessed: 0, title: 'Vue',
    }];
    render(<Content openTabs={openTabs} />);

    // 切到标签页视图
    await user.click(screen.getByRole('tab', { name: '标签页 1' }));
    // 点「存为书签」（TabList 渲染的保存按钮）
    await user.click(screen.getByRole('button', { name: /保存.*书签|存为书签/ }));

    await user.type(await screen.findByPlaceholderText('https://example.com'), 'https://vuejs.org');
    // 从建议中点击复用已有 Tag
    await user.click(screen.getByRole('button', { name: 'Vue' }));
    await user.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => expect(createBookmark).toHaveBeenCalledTimes(1));
    expect(createBookmark).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ tags: ['Vue'] }),
    );
  });
});

describe('Content 存为常驻标签', () => {
  it('标签页视图点「存为常驻标签」→ 弹 Dialog 预填 tab.url/title', async () => {
    const user = userEvent.setup();
    const openTabs: OpenTab[] = [{
      url: 'https://github.com', tabId: 1, lastAccessed: 0, title: 'GitHub',
    }];
    render(<Content openTabs={openTabs} />);
    await user.click(screen.getByRole('tab', { name: '标签页 1' }));
    await user.click(screen.getByRole('button', { name: '存为常驻标签' }));

    expect(screen.getByPlaceholderText(/url|链接/i)).toHaveValue('https://github.com');
    expect(screen.getByPlaceholderText(/名称/)).toHaveValue('GitHub');
  });
});

describe('Content 编辑书签 Tag 维护（#49）', () => {
  const makeTaggedBookmark = (id: string, tags: string[]): Bookmark => ({
    id,
    workspaceId: 'w1',
    categoryId: 'c1',
    name: 'GitHub',
    url: 'https://github.com',
    description: '',
    faviconUrl: '',
    contextCount: 0,
    hasEncryptedContext: false,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    tags,
  });

  beforeEach(() => {
    useWorkspace.setState({
      categories: [{ id: 'c1', workspaceId: 'w1', name: '工作', icon: '💼', order: 0, createdAt: 0 }],
      currentCategoryId: 'c1',
      currentWorkspaceId: 'w1',
      workspaces: [
        { id: 'w1', name: '工作区A', icon: '💼', order: 0, createdAt: 0 },
        { id: 'w2', name: '工作区B', icon: '📚', order: 1, createdAt: 0 },
      ],
    });
  });

  it('编辑面板加载书签当前 Tag', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [makeTaggedBookmark('b1', ['React', 'Frontend'])];
    render(<Content openTabs={[]} />);

    // 点卡片编辑按钮打开编辑面板
    await user.click(screen.getByRole('button', { name: '编辑-GitHub' }));

    // 当前 Tag 应作为已选徽标渲染
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '移除 React' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '移除 Frontend' })).toBeInTheDocument();
    });
  });

  it('编辑添加 Tag 后保存 → updateBookmark 携带 tags', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [makeTaggedBookmark('b1', ['React'])];
    render(<Content openTabs={[]} />);

    await user.click(screen.getByRole('button', { name: '编辑-GitHub' }));

    // 在编辑面板输入新 Tag
    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag/), 'Go{Enter}');
    // 保存
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(bookmarkServiceMocks.updateBookmark).toHaveBeenCalledTimes(1));
    expect(bookmarkServiceMocks.updateBookmark).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ tags: ['React', 'Go'] }),
    );
  });

  it('仅改变分类（移动）时不调用 updateBookmark，Tag 由 moveBookmark 保留', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [makeTaggedBookmark('b1', ['React', 'CSS'])];
    bookmarksState.allBookmarks = [makeTaggedBookmark('b1', ['React', 'CSS'])];
    render(<Content openTabs={[]} />);

    await user.click(screen.getByRole('button', { name: '编辑-GitHub' }));

    // 切换工作区到 w2（跨工作区移动）
    const wsSelect = screen.getByRole('combobox', { name: '工作区' });
    await user.click(wsSelect);
    await user.click(screen.getByText('📚 工作区B'));

    // 保存
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(bookmarksState.moveBookmark).toHaveBeenCalledTimes(1));
    // 仅改变归属位置、未改属性/Tag → 不调 updateBookmark
    expect(bookmarkServiceMocks.updateBookmark).not.toHaveBeenCalled();
  });

  it('同时修改属性 + 移动时，Tag 不会丢失', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [makeTaggedBookmark('b1', ['React'])];
    bookmarksState.allBookmarks = [makeTaggedBookmark('b1', ['React'])];
    render(<Content openTabs={[]} />);

    await user.click(screen.getByRole('button', { name: '编辑-GitHub' }));

    // 修改名称
    const nameInput = screen.getByPlaceholderText('留空则使用域名');
    await user.clear(nameInput);
    await user.type(nameInput, 'GitHub New');

    // 切换工作区到 w2
    const wsSelect = screen.getByRole('combobox', { name: '工作区' });
    await user.click(wsSelect);
    await user.click(screen.getByText('📚 工作区B'));

    // 保存
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(bookmarkServiceMocks.updateBookmark).toHaveBeenCalledTimes(1));
    // updateBookmark 先于 moveBookmark 写库，确保移动保留最新 Tag
    expect(bookmarkServiceMocks.updateBookmark).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ tags: ['React'] }),
    );
    await waitFor(() => expect(bookmarksState.moveBookmark).toHaveBeenCalledTimes(1));
  });

  it('移动后 Tag 进入目标工作区的建议集合', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [makeTaggedBookmark('b1', ['React'])];
    bookmarksState.allBookmarks = [makeTaggedBookmark('b1', ['React'])];
    // 目标工作区 w2 已有书签的 Tag 建议
    bookmarkServiceMocks.listBookmarksByWorkspace.mockResolvedValue([
      makeTaggedBookmark('b2', ['Go']),
    ]);
    render(<Content openTabs={[]} />);

    await user.click(screen.getByRole('button', { name: '编辑-GitHub' }));

    // 切换工作区到 w2 → Tag 建议源切换
    const wsSelect = screen.getByRole('combobox', { name: '工作区' });
    await user.click(wsSelect);
    await user.click(screen.getByText('📚 工作区B'));

    // w2 的建议 'Go' 应出现
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    });
  });
});
