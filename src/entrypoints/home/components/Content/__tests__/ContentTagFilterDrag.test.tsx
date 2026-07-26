import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
vi.mock('../../ContextList', () => ({ ContextList: () => null }));
// 不 mock BookmarkCard:真实渲染 SortableBookmarkCard + GripButton，验证拖拽门控（#53）

import { Content } from '../../Content';
import { useWorkspace } from '@/store/useWorkspace';

const makeBookmark = (id: string, name: string, tags: string[] = []): Bookmark => ({
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
  tags,
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
    deleteBookmark: vi.fn(),
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

describe('#53 搜索或 Tag 筛选时禁用拖拽（真实 GripButton）', () => {
  it('存在 Tag 筛选时 → grip 手柄禁用', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [
      makeBookmark('b1', '书签A', ['React']),
      makeBookmark('b2', '书签B', ['React']),
    ];
    render(<Content openTabs={[]} />);

    const filterBtn = screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ });
    await user.click(filterBtn);
    await user.click(await screen.findByRole('checkbox', { name: /React/ }));
    // 关闭 Popover 以恢复 grid 可访问性
    await user.click(filterBtn);

    await waitFor(() => {
      const grips = gripButtons();
      expect(grips).toHaveLength(2);
      expect(grips.every((g) => (g as HTMLButtonElement).disabled)).toBe(true);
    });
  });

  it('清除全部 Tag 筛选后 → grip 手柄恢复启用', async () => {
    const user = userEvent.setup();
    bookmarksState.bookmarks = [
      makeBookmark('b1', '书签A', ['React']),
      makeBookmark('b2', '书签B', ['React']),
    ];
    render(<Content openTabs={[]} />);

    const filterBtn = screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ });
    await user.click(filterBtn);
    await user.click(await screen.findByRole('checkbox', { name: /React/ }));
    await user.click(filterBtn);

    // 确认禁用
    await waitFor(() => {
      expect(gripButtons().every((g) => (g as HTMLButtonElement).disabled)).toBe(true);
    });

    // 移除 Tag（清除筛选）
    await user.click(screen.getByRole('button', { name: /移除.*React/ }));

    await waitFor(() => {
      const grips = gripButtons();
      expect(grips).toHaveLength(2);
      expect(grips.every((g) => (g as HTMLButtonElement).disabled)).toBe(false);
    });
  });
});
