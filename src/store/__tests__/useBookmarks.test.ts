import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Bookmark } from '@/shared/types';

// 打桩 service 层:仅验证 store 状态机,不触真实 IndexedDB
vi.mock('@/services/BookmarkService', () => ({
  listBookmarks: vi.fn(async () => [] as Bookmark[]),
  listBookmarksByWorkspace: vi.fn(async () => [] as Bookmark[]),
  createBookmark: vi.fn(async (_ws: string, _cat: string, data: { name: string; url: string }) =>
    makeBookmark('new-1', data.name, data.url),
  ),
  updateBookmark: vi.fn(async () => undefined),
  getFaviconUrl: vi.fn(() => ''),
}));
vi.mock('@/shared/db/database', () => ({ getByKey: vi.fn(async () => null) }));

import { useBookmarks } from '../useBookmarks';
import * as BookmarkService from '@/services/BookmarkService';

function makeBookmark(id: string, name: string, url: string, categoryId = 'cat-1'): Bookmark {
  return {
    id,
    workspaceId: 'ws-1',
    categoryId,
    name,
    url,
    description: '',
    faviconUrl: '',
    contextCount: 0,
    hasEncryptedContext: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('useBookmarks — R1 allBookmarks slice(跨分类去重数据源)', () => {
  beforeEach(() => {
    // 重置 store 状态与 mock 调用记录
    useBookmarks.setState({ bookmarks: [], allBookmarks: [], loading: false });
    vi.clearAllMocks();
  });

  it('loadAllByWorkspace 调用 listBookmarksByWorkspace 并填充 allBookmarks', async () => {
    const wsBookmarks = [makeBookmark('a', 'A', 'https://a.com', 'cat-1')];
    vi.mocked(BookmarkService.listBookmarksByWorkspace).mockResolvedValue(wsBookmarks);

    await useBookmarks.getState().loadAllByWorkspace('ws-1');

    expect(BookmarkService.listBookmarksByWorkspace).toHaveBeenCalledWith('ws-1');
    expect(useBookmarks.getState().allBookmarks).toEqual(wsBookmarks);
  });

  it('allBookmarks 与 bookmarks 相互独立:loadBookmarks(categoryId) 不污染 allBookmarks', async () => {
    const catBookmarks = [makeBookmark('a', 'A', 'https://a.com', 'cat-1')];
    vi.mocked(BookmarkService.listBookmarks).mockResolvedValue(catBookmarks);

    await useBookmarks.getState().loadBookmarks('cat-1');

    expect(useBookmarks.getState().bookmarks).toEqual(catBookmarks);
    // allBookmarks 不应被单分类加载触及(避免破坏跨分类去重数据源)
    expect(useBookmarks.getState().allBookmarks).toEqual([]);
  });

  it('createBookmark 同时追加到 bookmarks 与 allBookmarks(保存后去重即时生效)', async () => {
    // 预置 allBookmarks 已加载
    useBookmarks.setState({
      bookmarks: [],
      allBookmarks: [makeBookmark('a', 'A', 'https://a.com')],
    });

    const created = await useBookmarks
      .getState()
      .createBookmark('ws-1', 'cat-1', { name: 'New', url: 'https://new.com' });

    expect(created.url).toBe('https://new.com');
    // 两个 slice 都要包含新书签,否则保存后 TabList 去重数据陈旧
    expect(useBookmarks.getState().bookmarks.some((b) => b.id === created.id)).toBe(true);
    expect(useBookmarks.getState().allBookmarks.some((b) => b.id === created.id)).toBe(true);
  });
});
