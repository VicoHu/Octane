import { create } from 'zustand';
import type { Bookmark } from '@/shared/types';
import { getByKey } from '@/shared/db/database';
import * as BookmarkService from '@/services/BookmarkService';

interface BookmarksState {
  bookmarks: Bookmark[];
  loading: boolean;

  loadBookmarks: (categoryId: string) => Promise<void>;
  createBookmark: (workspaceId: string, categoryId: string, data: { name: string; url: string; description?: string }) => Promise<Bookmark>;
  deleteBookmark: (id: string) => Promise<void>;
  refreshBookmark: (id: string) => Promise<void>;
}

export const useBookmarks = create<BookmarksState>((set) => ({
  bookmarks: [],
  loading: false,

  loadBookmarks: async (categoryId) => {
    set({ loading: true });
    const bookmarks = await BookmarkService.listBookmarks(categoryId);
    // 为缺少 favicon 的书签补充 URL
    for (const b of bookmarks) {
      if (!b.faviconUrl && b.url) {
        const faviconUrl = BookmarkService.getFaviconUrl(b.url);
        if (faviconUrl) {
          await BookmarkService.updateBookmark(b.id, { faviconUrl });
          b.faviconUrl = faviconUrl;
        }
      }
    }
    set({ bookmarks, loading: false });
  },

  createBookmark: async (workspaceId, categoryId, data) => {
    const bookmark = await BookmarkService.createBookmark(workspaceId, categoryId, data);
    // 补充 favicon
    const faviconUrl = BookmarkService.getFaviconUrl(data.url);
    if (faviconUrl) {
      await BookmarkService.updateBookmark(bookmark.id, { faviconUrl });
      bookmark.faviconUrl = faviconUrl;
    }
    set((s) => ({ bookmarks: [...s.bookmarks, bookmark] }));
    return bookmark;
  },

  deleteBookmark: async (id) => {
    await BookmarkService.deleteBookmark(id);
    set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) }));
  },

  refreshBookmark: async (id) => {
    const updated = await getByKey<Bookmark>('bookmarks', id);
    if (!updated) return;
    set((s) => ({
      bookmarks: s.bookmarks.map((b) => (b.id === id ? updated : b)),
    }));
  },
}));
