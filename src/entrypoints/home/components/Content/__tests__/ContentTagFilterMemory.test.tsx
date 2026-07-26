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
import { installChromeStorageLocal } from '@/test/storageMock';

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

function setCategories(cs: { id: string; name: string; workspaceId?: string }[]) {
  useWorkspace.setState({
    categories: cs.map((c, i) => ({
      id: c.id,
      workspaceId: c.workspaceId ?? 'w1',
      name: c.name,
      icon: '📁',
      order: i,
      createdAt: 0,
    })),
  });
}

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
  installChromeStorageLocal({});
  useWorkspace.setState({
    categories: [{ id: 'c1', workspaceId: 'w1', name: '工作', icon: '💼', order: 0, createdAt: 0 }],
    currentCategoryId: 'c1',
    currentWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: '工作区1', icon: '🗂️', order: 0, createdAt: 0 }],
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

async function selectTag(tag: RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /筛选.*[Tt]ag|[Tt]ag.*筛选/ }));
  await user.click(await screen.findByRole('checkbox', { name: tag }));
}

// 选中 Badge 是否存在（作为「筛选是否生效」的代理）
function tagSelected(tag: RegExp): boolean {
  return !!screen.queryByRole('button', { name: new RegExp(`移除.*${tag.source}`) });
}

describe('#54 仅当前分类（默认 scope=category）', () => {
  it('切换分类 → 清除旧分类的筛选（不把 A 的选择应用到 B）', async () => {
    setCategories([{ id: 'c1', name: '分类A' }, { id: 'c2', name: '分类B' }]);
    bookmarksState.bookmarks = [
      makeBookmark('b1', 'React 书签', ['React'], { categoryId: 'c1' }),
      makeBookmark('b2', 'React 书签B', ['React'], { categoryId: 'c2' }),
    ];
    render(<Content openTabs={[]} />);

    await selectTag(/React/);
    await waitFor(() => expect(tagSelected(/React/)).toBe(true));

    // 切到分类 B
    useWorkspace.setState({ currentCategoryId: 'c2' });

    // 分类 B 不应继承 A 的筛选
    await waitFor(() => expect(tagSelected(/React/)).toBe(false));
  });
});

describe('#54 当前工作区（scope=workspace）', () => {
  it('同工作区切分类再切回 → 恢复该分类筛选；离开工作区清除全部', async () => {
    installChromeStorageLocal({ initial: { tagFilterMemoryScope: 'workspace' } });
    setCategories([{ id: 'c1', name: '分类A' }, { id: 'c2', name: '分类B' }]);
    bookmarksState.bookmarks = [
      makeBookmark('b1', 'React 书签A', ['React'], { categoryId: 'c1' }),
      makeBookmark('b2', 'Vue 书签B', ['Vue'], { categoryId: 'c2' }),
    ];
    useWorkspace.setState({
      workspaces: [
        { id: 'w1', name: '工作区1', icon: '🗂️', order: 0, createdAt: 0 },
        { id: 'w2', name: '工作区2', icon: '🗂️', order: 1, createdAt: 0 },
      ],
    });
    render(<Content openTabs={[]} />);

    // c1 选 React
    await selectTag(/React/);
    await waitFor(() => expect(tagSelected(/React/)).toBe(true));

    // 切到 c2（同工作区）→ c2 无筛选
    useWorkspace.setState({ currentCategoryId: 'c2' });
    await waitFor(() => expect(tagSelected(/React/)).toBe(false));

    // 切回 c1 → 恢复 React
    useWorkspace.setState({ currentCategoryId: 'c1' });
    await waitFor(() => expect(tagSelected(/React/)).toBe(true));

    // 离开工作区 → 切到 w2，清空 w1 全部记忆
    useWorkspace.setState({ currentWorkspaceId: 'w2', currentCategoryId: 'c1', categories: [] });
    // 等 w2 切换生效（effect 执行清空逻辑）
    await waitFor(() => expect(useWorkspace.getState().currentWorkspaceId).toBe('w2'));
    // 回到 w1/c1 → 不应恢复（记忆已被清）
    useWorkspace.setState({
      currentWorkspaceId: 'w1',
      currentCategoryId: 'c1',
      categories: [
        { id: 'c1', workspaceId: 'w1', name: '分类A', icon: '📁', order: 0, createdAt: 0 },
      ],
    });
    await waitFor(() => expect(tagSelected(/React/)).toBe(false));
  });
});

describe('#54 当前会话（scope=session）', () => {
  it('跨工作区切换仍保留所有分类筛选（页面生命周期内）', async () => {
    installChromeStorageLocal({ initial: { tagFilterMemoryScope: 'session' } });
    setCategories([{ id: 'c1', name: '分类A' }, { id: 'c2', name: '分类B' }]);
    bookmarksState.bookmarks = [
      makeBookmark('b1', 'React 书签A', ['React'], { categoryId: 'c1' }),
      makeBookmark('b2', 'Vue 书签B', ['Vue'], { categoryId: 'c2' }),
    ];
    useWorkspace.setState({
      workspaces: [
        { id: 'w1', name: '工作区1', icon: '🗂️', order: 0, createdAt: 0 },
        { id: 'w2', name: '工作区2', icon: '🗂️', order: 1, createdAt: 0 },
      ],
    });
    render(<Content openTabs={[]} />);

    // c1/w1 选 React
    await selectTag(/React/);
    await waitFor(() => expect(tagSelected(/React/)).toBe(true));

    // 切到 w2 → 离开工作区，但 session 保留 w1 的记忆
    useWorkspace.setState({ currentWorkspaceId: 'w2', currentCategoryId: 'c1', categories: [] });
    // 等 w2 切换生效（让 effect 看到 w2 过渡）
    await waitFor(() => expect(useWorkspace.getState().currentWorkspaceId).toBe('w2'));

    // 回到 w1/c1 → 仍恢复 React（session 未清）
    useWorkspace.setState({
      currentWorkspaceId: 'w1',
      currentCategoryId: 'c1',
      categories: [
        { id: 'c1', workspaceId: 'w1', name: '分类A', icon: '📁', order: 0, createdAt: 0 },
      ],
    });
    await waitFor(() => expect(tagSelected(/React/)).toBe(true));
  });
});

describe('#54 配置变更不追溯', () => {
  it('已选筛选存在时切换配置 → 不清除当前筛选', async () => {
    installChromeStorageLocal({ initial: { tagFilterMemoryScope: 'category' } });
    setCategories([{ id: 'c1', name: '分类A' }, { id: 'c2', name: '分类B' }]);
    bookmarksState.bookmarks = [makeBookmark('b1', 'React 书签', ['React'], { categoryId: 'c1' })];
    render(<Content openTabs={[]} />);

    await selectTag(/React/);
    await waitFor(() => expect(tagSelected(/React/)).toBe(true));

    // 配置改为 workspace（模拟设置变更）
    const store = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const local = (store.storage as Record<string, unknown>).local as { get: (k: string[]) => Promise<Record<string, unknown>>; set: (d: Record<string, unknown>) => Promise<void> };
    await local.set({ tagFilterMemoryScope: 'workspace' });

    // 当前筛选仍在（配置变更不追溯清理）
    await waitFor(() => expect(tagSelected(/React/)).toBe(true));
  });
});

describe('#54 刷新初始状态', () => {
  it('组件挂载 → 当前分类筛选为空（未筛选初始态）', async () => {
    setCategories([{ id: 'c1', name: '分类A' }]);
    bookmarksState.bookmarks = [makeBookmark('b1', 'React 书签', ['React'], { categoryId: 'c1' })];
    render(<Content openTabs={[]} />);

    // 挂载后无任何已选 Badge（筛选记忆只存内存，刷新天然清空）
    expect(await screen.findByTestId('card-b1')).toBeInTheDocument();
    expect(tagSelected(/React/)).toBe(false);
  });
});
