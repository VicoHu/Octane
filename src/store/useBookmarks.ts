import { create } from 'zustand';
import type { Bookmark } from '@/shared/types';
import { getByKey } from '@/shared/db/database';
import * as BookmarkService from '@/services/BookmarkService';

interface BookmarksState {
  bookmarks: Bookmark[];
  /** 当前工作区全量书签(跨分类),供 TabList 跨分类去重判定,独立于 bookmarks */
  allBookmarks: Bookmark[];
  loading: boolean;

  loadBookmarks: (categoryId: string) => Promise<void>;
  /** 加载当前工作区全量书签(跨分类),作为 TabList 跨分类去重数据源 */
  loadAllByWorkspace: (workspaceId: string) => Promise<void>;
  createBookmark: (workspaceId: string, categoryId: string, data: { name: string; url: string; description?: string }) => Promise<Bookmark>;
  deleteBookmark: (id: string) => Promise<void>;
  refreshBookmark: (id: string) => Promise<void>;
}

export const useBookmarks = create<BookmarksState>((set) => ({
  bookmarks: [],
  allBookmarks: [],
  loading: false,

  loadBookmarks: async (categoryId) => {
    set({ loading: true });
    const bookmarks = await BookmarkService.listBookmarks(categoryId);
    // 补充/修正 favicon：缺失，或策略过期（如旧 localhost 书签存了 Google 占位 URL）
    for (const b of bookmarks) {
      if (!b.url) continue;
      const expected = BookmarkService.getFaviconUrl(b.url);
      if (expected && b.faviconUrl !== expected) {
        await BookmarkService.updateBookmark(b.id, { faviconUrl: expected });
        b.faviconUrl = expected;
      }
    }
    set({ bookmarks, loading: false });
  },

  loadAllByWorkspace: async (workspaceId) => {
    // 跨分类全量书签:TabList 跨分类去重数据源。不触碰 bookmarks(当前分类切片),
    // 不触发 loading(与当前分类列表加载解耦)。
    const allBookmarks = await BookmarkService.listBookmarksByWorkspace(workspaceId);
    set({ allBookmarks });
  },

  createBookmark: async (workspaceId, categoryId, data) => {
    const bookmark = await BookmarkService.createBookmark(workspaceId, categoryId, data);
    // 补充 favicon
    const faviconUrl = BookmarkService.getFaviconUrl(data.url);
    if (faviconUrl) {
      await BookmarkService.updateBookmark(bookmark.id, { faviconUrl });
      bookmark.faviconUrl = faviconUrl;
    }
    set((s) => ({
      bookmarks: [...s.bookmarks, bookmark],
      // 同步追加到跨分类切片:保存后 TabList 去重即时生效,避免数据陈旧
      allBookmarks: [...s.allBookmarks, bookmark],
    }));
    return bookmark;
  },

  deleteBookmark: async (id) => {
    await BookmarkService.deleteBookmark(id);
    set((s) => ({
      bookmarks: s.bookmarks.filter((b) => b.id !== id),
    }));
  },

  refreshBookmark: async (id) => {
    const updated = await getByKey<Bookmark>('bookmarks', id);
    if (!updated) return;
    set((s) => ({
      bookmarks: s.bookmarks.map((b) => (b.id === id ? updated : b)),
    }));
  },
}));
