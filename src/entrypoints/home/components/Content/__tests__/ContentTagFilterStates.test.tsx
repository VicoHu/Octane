import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// 隔离子组件依赖
vi.mock('../../ContextList', () => ({ ContextList: () => null }));
vi.mock('../../BookmarkCard', () => ({
  BookmarkCard: (props: Record<string, unknown>) => {
    const bookmark = props.bookmark as { id: string; name: string };
    return React.createElement('div', { 'data-testid': `card-${bookmark.id}` }, bookmark.name);
  },
  SortableBookmarkCard: (props: Record<string, unknown>) => {
    const bookmark = props.bookmark as { id: string; name: string };
    return React.createElement('div', { 'data-testid': `card-${bookmark.id}` }, bookmark.name);
  },
}));
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), close: vi.fn() },
}));

// 可控状态（测试间重置）
let bookmarksState: Record<string, unknown>;
let pinnedTabsState: Record<string, unknown>;
let searchState: { query: string; setQuery: (v: string) => void };

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
  useSearch: (sel: (s: { query: string; setQuery: (v: string) => void }) => unknown) => sel(searchState),
}));
vi.mock('@/store/usePinnedTabs', () => ({
  usePinnedTabs: (sel: (s: Record<string, unknown>) => unknown) => sel(pinnedTabsState),
}));
vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => null),
}));
vi.mock('@/services/BookmarkService', () => ({
  updateBookmark: vi.fn(async () => {}),
  listBookmarksByWorkspace: vi.fn(async () => [] as import('@/shared/types').Bookmark[]),
}));
vi.mock('@/services/CategoryService', () => ({
  listCategories: vi.fn(async () => []),
}));

import { Content } from '../../Content';
import { useWorkspace } from '@/store/useWorkspace';
import type { Bookmark } from '@/shared/types';

const makeBookmark = (id: string, name: string, tags: string[] = [], extra?: Partial<Bookmark>): Bookmark => ({
  id,
  workspaceId: 'w1',
  categoryId: 'c1',
  name,
  url: 'https://example.com',
  description: '',
  faviconUrl: '',
  contextCount: 0,
  hasEncryptedContext: false,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  tags,
  ...extra,
});

beforeEach(() => {
  searchState = { query: '', setQuery: vi.fn() };
  bookmarksState = {
    loading: false,
    bookmarks: [],
    allBookmarks: [],
    loadBookmarks: vi.fn(),
    loadAllByWorkspace: vi.fn(),
    createBookmark: vi.fn(async () => ({ id: 'b1' })),
    refreshBookmark: vi.fn(async () => {}),
    moveBookmark: vi.fn(async () => {}),
    reorderBookmarks: vi.fn(),
    deleteBookmark: vi.fn(),
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
    createPinnedTab: vi.fn(),
    deletePinnedTab: vi.fn(),
    reorderPinnedTabs: vi.fn(),
  };
});

describe('#53 当前分类无 Tag 时筛选按钮禁用 + Tooltip', () => {
  it('当前分类无任何 Tag 时 → 筛选按钮禁用但保留布局占位', () => {
    bookmarksState.bookmarks = [makeBookmark('b1', '无标签书签', [])];
    render(<Content openTabs={[]} />);

    const filterBtn = screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ });
    expect(filterBtn).toBeDisabled();
  });

  it('悬停禁用筛选按钮 → Tooltip 显示「当前分类暂无 Tag」', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [makeBookmark('b1', '无标签书签', [])];
    render(<Content openTabs={[]} />);

    const filterBtn = screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ });
    await user.hover(filterBtn);

    expect(await screen.findByText('当前分类暂无 Tag')).toBeInTheDocument();
  });

  it('当前分类有 Tag 时 → 筛选按钮启用', () => {
    bookmarksState.bookmarks = [makeBookmark('b1', '有标签书签', ['React'])];
    render(<Content openTabs={[]} />);

    const filterBtn = screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ });
    expect(filterBtn).not.toBeDisabled();
  });
});

describe('#53 零结果时筛选条件保留 + 计数为 0', () => {
  it('删除最后一个匹配书签后 → 已选 Tag 保留，书签计数为 0，显示零结果', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [makeBookmark('b1', 'React 书签', ['React'])];
    const { rerender } = render(<Content openTabs={[]} />);

    // 选中 React 筛选
    await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
    await user.click(await screen.findByRole('checkbox', { name: /React/ }));

    // 验证筛选生效（书签 Tab 计数=1）
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /书签/ })).toHaveTextContent('1');
    });

    // 模拟删除该书签（同一实例内 state 变更 + rerender，保留已选筛选）
    bookmarksState.bookmarks = [];
    rerender(<Content openTabs={[]} />);

    // 筛选条件保留（已选 Badge 仍在）+ 计数为 0 + 零结果空状态
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /书签/ })).toHaveTextContent('0');
      expect(screen.getByText(/没有找到匹配的书签/)).toBeInTheDocument();
    });
    // 已选 Tag Badge 仍显示（筛选未静默取消）
    expect(screen.getByRole('button', { name: /移除.*React/ })).toBeInTheDocument();
  });

  it('筛选后无匹配书签 → 显示零结果空状态', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [makeBookmark('b1', '书签A', ['React']), makeBookmark('b2', '书签B', ['Vue'])];
    render(<Content openTabs={[]} />);

    // 选中 React + Vue（AND 语义，无书签同时拥有两者）
    await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
    await user.click(await screen.findByRole('checkbox', { name: /React/ }));
    await user.click(screen.getByRole('checkbox', { name: /Vue/ }));

    await waitFor(() => {
      expect(screen.getByText(/没有找到匹配的书签/)).toBeInTheDocument();
    });
  });
});

describe('#53 组合空状态 + 清除入口', () => {
  it('文本搜索 + Tag 筛选均无结果 → 显示组合空状态与清除入口', async () => {
    const user = userEvent.setup();
    const setQuery = vi.fn();
    searchState = { query: 'XYZ', setQuery };
    bookmarksState.bookmarks = [makeBookmark('b1', '书签A', ['React'])];
    render(<Content openTabs={[]} />);

    // 选中一个 Tag，与搜索词组合后无结果
    await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
    await user.click(await screen.findByRole('checkbox', { name: /React/ }));

    // 组合空状态出现 + 清除入口
    await waitFor(() => {
      expect(screen.getByText(/没有找到匹配的书签/)).toBeInTheDocument();
    });
    // 提供清除搜索和清除全部 Tag 的操作
    expect(screen.getByRole('button', { name: /清空搜索/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /清除.*[Tt]ag.*筛选|清除全部.*[Tt]ag/ })).toBeInTheDocument();
  });

  it('点击「清空搜索」→ 调用 setQuery 清空文本', async () => {
    const user = userEvent.setup();
    const setQuery = vi.fn();
    searchState = { query: 'XYZ', setQuery };
    bookmarksState.bookmarks = [makeBookmark('b1', '书签A', ['React'])];
    render(<Content openTabs={[]} />);

    await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
    await user.click(await screen.findByRole('checkbox', { name: /React/ }));

    await user.click(screen.getByRole('button', { name: /清空搜索/ }));
    expect(setQuery).toHaveBeenCalledWith('');
  });

  it('点击「清除全部 Tag 筛选」→ 清空已选 Tag', async () => {
    const user = userEvent.setup();
    searchState = { query: 'XYZ', setQuery: vi.fn() };
    bookmarksState.bookmarks = [makeBookmark('b1', '书签A', ['React'])];
    render(<Content openTabs={[]} />);

    await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
    await user.click(await screen.findByRole('checkbox', { name: /React/ }));

    await user.click(screen.getByRole('button', { name: /清除.*[Tt]ag.*筛选|清除全部.*[Tt]ag/ }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /移除.*React/ })).not.toBeInTheDocument();
    });
  });
});

describe('#53 Bookmark 与标签页 Tab 往返保留筛选', () => {
  it('选中 Tag 筛选 → 切到标签页 Tab → 切回书签 Tab → 筛选仍生效', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [
      makeBookmark('b1', 'React 书签', ['React']),
      makeBookmark('b2', 'Vue 书签', ['Vue']),
    ];
    const openTabs = [{ url: 'https://other.com', tabId: 1, lastAccessed: 0, title: 'Other' }];
    render(<Content openTabs={openTabs as never} />);

    // 书签视图选中 React
    await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
    await user.click(await screen.findByRole('checkbox', { name: /React/ }));

    await waitFor(() => {
      expect(screen.getByTestId('card-b1')).toBeInTheDocument();
      expect(screen.queryByTestId('card-b2')).not.toBeInTheDocument();
    });

    // 切到标签页视图（标签页不受筛选影响）
    await user.click(screen.getByRole('tab', { name: /标签页/ }));
    expect(screen.getByText('Other')).toBeInTheDocument();

    // 切回书签视图 → 筛选仍生效
    await user.click(screen.getByRole('tab', { name: /书签/ }));
    await waitFor(() => {
      expect(screen.getByTestId('card-b1')).toBeInTheDocument();
      expect(screen.queryByTestId('card-b2')).not.toBeInTheDocument();
    });
    // 已选 Tag 保留
    expect(screen.getByRole('button', { name: /移除.*React/ })).toBeInTheDocument();
  });
});
