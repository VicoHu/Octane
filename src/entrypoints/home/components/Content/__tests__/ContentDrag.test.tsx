import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Bookmark } from '@/shared/types';

// 可控状态(测试间重置)
let bookmarksState: Record<string, unknown>;
let pinnedTabsState: Record<string, unknown>;
let searchState: { query: string; setQuery: (v: string) => void };

vi.mock('@/store/useBookmarks', () => ({
  useBookmarks: (sel: (s: Record<string, unknown>) => unknown) => sel(bookmarksState),
}));
vi.mock('@/store/useSearch', () => ({
  useSearch: (sel: (s: { query: string; setQuery: (v: string) => void }) => unknown) => sel(searchState),
}));
vi.mock('@/store/usePinnedTabs', () => ({
  usePinnedTabs: (sel: (s: Record<string, unknown>) => unknown) => sel(pinnedTabsState),
}));
vi.mock('@/hooks/useFavicon', () => ({ useFavicon: vi.fn(() => null) }));
vi.mock('../../hooks/useOpenTabs', () => ({ useOpenTabs: () => [] }));
vi.mock('../../ContextList', () => ({ ContextList: () => null }));
// 不 mock BookmarkCard:真实渲染,验证 grid 拖拽接线

import { Content } from '../../Content';
import { useWorkspace } from '@/store/useWorkspace';

const makeBookmark = (id: string, name: string): Bookmark => ({
  id,
  workspaceId: 'w1',
  categoryId: 'c1',
  name,
  url: 'https://x.com',
  description: '',
  faviconUrl: '',
  contextCount: 0,
  hasEncryptedContext: false,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
});

/** 定位所有 grip 手柄(aria-roledescription=可拖拽项) */
const gripButtons = () =>
  screen
    .getAllByRole('button')
    .filter((el) => el.getAttribute('aria-roledescription') === '可拖拽项');

beforeEach(() => {
  searchState = { query: '', setQuery: vi.fn() };
  bookmarksState = {
    loading: false,
    bookmarks: [],
    allBookmarks: [],
    loadBookmarks: vi.fn(),
    loadAllByWorkspace: vi.fn(),
    createBookmark: vi.fn(),
    refreshBookmark: vi.fn(),
    reorderBookmarks: vi.fn(),
  };
  pinnedTabsState = {
    pinnedTabs: [],
    loading: false,
    loadPinnedTabs: vi.fn(),
    createPinnedTab: vi.fn(),
    deletePinnedTab: vi.fn(),
    reorderPinnedTabs: vi.fn(),
  };
  useWorkspace.setState({
    categories: [{ id: 'c1', workspaceId: 'w1', name: '工作', icon: '💼', order: 0, createdAt: 0 }],
    currentCategoryId: 'c1',
    currentWorkspaceId: 'w1',
    workspaces: [],
  });
});

describe('Content grid 拖拽(T4)', () => {
  it('>1 书签:渲染 sortable grip(每卡一个)', () => {
    bookmarksState.bookmarks = [makeBookmark('1', 'GitHub'), makeBookmark('2', 'GitLab')];
    render(<Content openTabs={[]} />);
    expect(gripButtons()).toHaveLength(2);
  });

  it('搜索态(query 非空且匹配>1):grip 禁用置灰', () => {
    searchState.query = 'Git';
    bookmarksState.bookmarks = [makeBookmark('1', 'GitHub'), makeBookmark('2', 'GitLab')];
    render(<Content openTabs={[]} />);
    const grips = gripButtons();
    expect(grips).toHaveLength(2);
    expect(grips.every((g) => (g as HTMLButtonElement).disabled)).toBe(true);
  });

  it('≤1 书签:不渲染 grip(纯 BookmarkCard,无 Sortable)', () => {
    bookmarksState.bookmarks = [makeBookmark('1', 'GitHub')];
    render(<Content openTabs={[]} />);
    expect(gripButtons()).toHaveLength(0);
  });
});

describe('Content 首启 coachmark(T9)', () => {
  beforeEach(() => {
    localStorage.removeItem('dragSortCoachSeen');
  });

  it('首启(coachSeen 未存):首个 grip 显示「拖动手柄可排序」Popover', () => {
    bookmarksState.bookmarks = [makeBookmark('1', 'GitHub'), makeBookmark('2', 'GitLab')];
    render(<Content openTabs={[]} />);
    expect(screen.getByText('拖动手柄可排序')).toBeInTheDocument();
  });

  it('已知(localStorage flag 已存):不显示 coachmark', () => {
    localStorage.setItem('dragSortCoachSeen', 'true');
    bookmarksState.bookmarks = [makeBookmark('1', 'GitHub'), makeBookmark('2', 'GitLab')];
    render(<Content openTabs={[]} />);
    expect(screen.queryByText('拖动手柄可排序')).not.toBeInTheDocument();
  });

  it('搜索态(query 非空):不显示 coachmark', () => {
    searchState.query = 'Git';
    bookmarksState.bookmarks = [makeBookmark('1', 'GitHub'), makeBookmark('2', 'GitLab')];
    render(<Content openTabs={[]} />);
    expect(screen.queryByText('拖动手柄可排序')).not.toBeInTheDocument();
  });
});
