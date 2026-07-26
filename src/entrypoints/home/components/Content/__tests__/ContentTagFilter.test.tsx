import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// 隔离子组件依赖
vi.mock('../../ContextList', () => ({ ContextList: () => null }));
vi.mock('../../BookmarkCard', () => ({
  BookmarkCard: (props: Record<string, unknown>) => {
    const bookmark = props.bookmark as { id: string; name: string };
    return React.createElement('article', { role: 'article', 'aria-label': bookmark.name }, bookmark.name);
  },
  SortableBookmarkCard: (props: Record<string, unknown>) => {
    const bookmark = props.bookmark as { id: string; name: string };
    return React.createElement('article', { role: 'article', 'aria-label': bookmark.name }, bookmark.name);
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

describe('Content Tag 筛选器（#52）', () => {
  describe('筛选按钮与打开 Popover', () => {
    it('书签视图摘要行展示带 Tag 图标的筛选按钮', () => {
      render(<Content openTabs={[]} />);
      expect(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ })).toBeInTheDocument();
    });

    it('点击筛选按钮 → 打开 Popover，显示可搜索输入框', async () => {
      const user = userEvent.setup();
      bookmarksState.bookmarks = [makeBookmark('b1', '带标签', ['React'])];
      render(<Content openTabs={[]} />);
      await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
      expect(await screen.findByPlaceholderText(/搜索.*[Tt]ag/i)).toBeInTheDocument();
    });
  });

  describe('选项显示 Tag 名称与使用数量', () => {
    it('每个选项显示 Tag 名称及当前 Category 内使用数量', async () => {
      const user = userEvent.setup();
      bookmarksState.bookmarks = [
        makeBookmark('b1', 'React Docs', ['React']),
        makeBookmark('b2', 'React Blog', ['React', 'CSS']),
        makeBookmark('b3', 'CSS Guide', ['CSS']),
      ];
      render(<Content openTabs={[]} />);
      await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));

      // React 出现在 2 个书签，CSS 出现在 2 个书签
      // 使用 role=checkbox 定位选项行，验证内含计数文本
      const reactCheckbox = await screen.findByRole('checkbox', { name: /React/ });
      expect(reactCheckbox).toBeInTheDocument();
      // checkbox label 文本应包含计数 "2"
      const reactRow = reactCheckbox.closest('label') ?? reactCheckbox.parentElement;
      expect(reactRow).toHaveTextContent('2');

      const cssCheckbox = screen.getByRole('checkbox', { name: /CSS/ });
      const cssRow = cssCheckbox.closest('label') ?? cssCheckbox.parentElement;
      expect(cssRow).toHaveTextContent('2');
    });
  });

  describe('多 Tag 使用 AND', () => {
    it('选中两个 Tag → 仅显示同时包含两者的书签', async () => {
      const user = userEvent.setup();
      bookmarksState.bookmarks = [
        makeBookmark('b1', 'ReactCSS', ['React', 'CSS']),
        makeBookmark('b2', 'ReactOnly', ['React']),
        makeBookmark('b3', 'CSSOnly', ['CSS']),
      ];
      render(<Content openTabs={[]} />);
      await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));

      const reactCheckbox = await screen.findByRole('checkbox', { name: /React/ });
      const cssCheckbox = screen.getByRole('checkbox', { name: /CSS/ });
      await user.click(reactCheckbox);
      await user.click(cssCheckbox);

      // 只有 b1 同时有 React 和 CSS
      await waitFor(() => {
        expect(screen.getByRole('article', { name: 'ReactCSS' })).toBeInTheDocument();
        expect(screen.queryByRole('article', { name: 'ReactOnly' })).not.toBeInTheDocument();
        expect(screen.queryByRole('article', { name: 'CSSOnly' })).not.toBeInTheDocument();
      });
    });
  });

  describe('文本搜索扩展匹配 Tag 名称', () => {
    it('搜索框输入 Tag 名称 → 匹配包含该 Tag 的书签', async () => {
      searchState.query = 'React';
      bookmarksState.bookmarks = [
        makeBookmark('b1', 'Documentation', ['React']),
        makeBookmark('b2', 'NotMatch', ['Vue']),
      ];
      render(<Content openTabs={[]} />);

      await waitFor(() => {
        expect(screen.getByRole('article', { name: 'Documentation' })).toBeInTheDocument();
        expect(screen.queryByRole('article', { name: 'NotMatch' })).not.toBeInTheDocument();
      });
    });
  });

  describe('文本搜索与 Tag 条件使用 AND', () => {
    it('文本搜索 + Tag 筛选 → 同时满足两个条件的书签', async () => {
      const user = userEvent.setup();
      searchState.query = 'Doc';
      bookmarksState.bookmarks = [
        makeBookmark('b1', 'React Docs', ['React']),
        makeBookmark('b2', 'Vue Docs', ['Vue']),
        makeBookmark('b3', 'React Blog', ['React']),
      ];
      render(<Content openTabs={[]} />);

      // 先验证文本搜索匹配含 Doc 的
      await waitFor(() => {
        expect(screen.getByRole('article', { name: 'React Docs' })).toBeInTheDocument();
        expect(screen.getByRole('article', { name: 'Vue Docs' })).toBeInTheDocument();
        expect(screen.queryByRole('article', { name: 'React Blog' })).not.toBeInTheDocument();
      });

      // 打开筛选器选中 React
      await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
      const reactCheckbox = await screen.findByRole('checkbox', { name: /React/ });
      await user.click(reactCheckbox);

      // 只有 b1 同时满足 Doc + React
      await waitFor(() => {
        expect(screen.getByRole('article', { name: 'React Docs' })).toBeInTheDocument();
        expect(screen.queryByRole('article', { name: 'Vue Docs' })).not.toBeInTheDocument();
        expect(screen.queryByRole('article', { name: 'React Blog' })).not.toBeInTheDocument();
      });
    });
  });

  describe('已选 Tag Badge', () => {
    it('选中 Tag 后摘要行显示对应 Badge，可单独移除', async () => {
      const user = userEvent.setup();
      bookmarksState.bookmarks = [makeBookmark('b1', 'Test', ['React'])];
      render(<Content openTabs={[]} />);
      await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
      const checkbox = await screen.findByRole('checkbox', { name: /React/ });
      await user.click(checkbox);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /移除.*React/ })).toBeInTheDocument();
      });

      // 点击移除
      await user.click(screen.getByRole('button', { name: /移除.*React/ }));
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /移除.*React/ })).not.toBeInTheDocument();
      });
    });

    it('超过 3 个已选 Tag 时显示 +N', async () => {
      const user = userEvent.setup();
      bookmarksState.bookmarks = [makeBookmark('b1', 'Multi', ['A', 'B', 'C', 'D', 'E'])];
      render(<Content openTabs={[]} />);
      await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));

      for (const tag of ['A', 'B', 'C', 'D', 'E']) {
        const cb = await screen.findByRole('checkbox', { name: new RegExp(tag) });
        await user.click(cb);
      }

      await waitFor(() => {
        expect(screen.getByText(/\+2/)).toBeInTheDocument();
      });
    });
  });

  describe('清除全部', () => {
    it('Popover 内提供清除全部操作，清除后无已选 Tag', async () => {
      const user = userEvent.setup();
      bookmarksState.bookmarks = [makeBookmark('b1', 'Test', ['React', 'CSS'])];
      render(<Content openTabs={[]} />);
      await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));

      await user.click(await screen.findByRole('checkbox', { name: /React/ }));
      await user.click(screen.getByRole('checkbox', { name: /CSS/ }));

      // 清除全部
      await user.click(screen.getByRole('button', { name: /清除全部/ }));
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /移除.*React/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /移除.*CSS/ })).not.toBeInTheDocument();
      });
    });
  });

  describe('Tab 隔离', () => {
    it('切到标签页视图时筛选状态不影响标签页列表', async () => {
      const user = userEvent.setup();
      bookmarksState.bookmarks = [makeBookmark('b1', 'React', ['React'])];
      bookmarksState.allBookmarks = [makeBookmark('b1', 'React', ['React'])];
      const openTabs = [{ url: 'https://other.com', tabId: 1, lastAccessed: 0, title: 'Other' }];
      render(<Content openTabs={openTabs as never} />);

      // 在书签视图选中 React 筛选
      await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
      const checkbox = await screen.findByRole('checkbox', { name: /React/ });
      await user.click(checkbox);

      // 切到标签页视图
      await user.click(screen.getByRole('tab', { name: /标签页/ }));
      // 标签页视图的 openTabs 内容应正常显示（不被 Tag 筛选过滤）
      expect(screen.getByText('Other')).toBeInTheDocument();
    });
  });
});
