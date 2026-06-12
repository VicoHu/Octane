import { create } from 'zustand';
import type { Bookmark, Context } from '@/shared/types';
import { getByKey, getAll } from '@/shared/db/database';
import * as BookmarkService from '@/services/BookmarkService';

interface BookmarksState {
  bookmarks: Bookmark[];
  /** 每个书签的上下文预览（最新一条非加密上下文的 title） */
  contextPreviews: Record<string, string>;
  loading: boolean;

  loadBookmarks: (categoryId: string) => Promise<void>;
  createBookmark: (workspaceId: string, categoryId: string, data: { name: string; url: string; description?: string }) => Promise<Bookmark>;
  deleteBookmark: (id: string) => Promise<void>;
  refreshBookmark: (id: string) => Promise<void>;
}

export const useBookmarks = create<BookmarksState>((set) => ({
  bookmarks: [],
  contextPreviews: {},
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
    // 批量加载上下文预览：一次 getAll + 内存分组
    let contextPreviews: Record<string, string> = {};
    try {
      const allContexts: Context[] = await getAll('contexts');
      // 按 bookmarkId 分组，取每个书签最新的非加密上下文 title
      const grouped: Record<string, Context[]> = {};
      for (const ctx of allContexts) {
        const arr = grouped[ctx.bookmarkId];
        if (arr) { arr.push(ctx); } else { grouped[ctx.bookmarkId] = [ctx]; }
      }
      const bookmarkIds = new Set(bookmarks.map((b) => b.id));
      for (const [bid, ctxs] of Object.entries(grouped)) {
        if (!bookmarkIds.has(bid)) continue;
        // 按 createdAt 降序取第一条非加密上下文
        const sorted = ctxs.sort((a, b) => b.createdAt - a.createdAt);
        const first = sorted.find((c) => !c.isEncrypted);
        if (first) {
          contextPreviews[bid] = first.title;
        }
      }
    } catch {
      // 预览加载失败不影响主流程
    }
    set({ bookmarks, contextPreviews, loading: false });
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
    set((s) => ({
      bookmarks: s.bookmarks.filter((b) => b.id !== id),
      contextPreviews: Object.fromEntries(
        Object.entries(s.contextPreviews).filter(([bid]) => bid !== id),
      ),
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
