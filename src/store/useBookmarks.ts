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
  createBookmark: (workspaceId: string, categoryId: string, data: { name: string; url: string; description?: string; tags?: string[] }) => Promise<Bookmark>;
  deleteBookmark: (id: string) => Promise<void>;
  refreshBookmark: (id: string) => Promise<void>;
  /**
   * 移动书签到目标工作区/分类。
   * 切片语义(见设计文档 Premise 1):跨工作区→allBookmarks 移除;同工作区跨分类→allBookmarks 保留更新 categoryId。
   * 不能用 refreshBookmark 处理移动——它的 map 语义无法表达「从当前分类列表移除」,且 ContextEditor 是其第二 caller,重载会破坏上下文保存路径。
   */
  moveBookmark: (id: string, targetWorkspaceId: string, targetCategoryId: string) => Promise<void>;
  /** 重排分类内书签(乐观重排 bookmarks 切片 + 失败回滚;allBookmarks 不动——顺序无关仅去重)。 */
  reorderBookmarks: (categoryId: string, orderedIds: string[]) => Promise<void>;
}

export const useBookmarks = create<BookmarksState>((set, get) => ({
  bookmarks: [],
  allBookmarks: [],
  loading: false,

  loadBookmarks: async (categoryId) => {
    set({ loading: true });
    const bookmarks = await BookmarkService.listBookmarks(categoryId);
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
      // 双切片同步:历史遗漏只 filter bookmarks,导致 TabList 跨分类去重用到已删书签
      bookmarks: s.bookmarks.filter((b) => b.id !== id),
      allBookmarks: s.allBookmarks.filter((b) => b.id !== id),
    }));
  },

  refreshBookmark: async (id) => {
    const updated = await getByKey<Bookmark>('bookmarks', id);
    if (!updated) return;
    set((s) => ({
      // 仅「就地更新单条」语义——用于编辑改名/改URL(归属不变)与 ContextEditor 刷新徽章计数。
      // 不做 filter 移除:ContextEditor 是第二 caller,移除语义会让上下文保存后书签消失(回归)。
      bookmarks: s.bookmarks.map((b) => (b.id === id ? updated : b)),
      allBookmarks: s.allBookmarks.map((b) => (b.id === id ? updated : b)),
    }));
  },

  moveBookmark: async (id, targetWorkspaceId, targetCategoryId) => {
    // T3 切换:调 service moveBookmark(目标分类 maxOrder+1 重分配),替代旧 updateBookmark 保留 order。
    // 切片同步语义保持不变(双切片 ws/cat,见 Content/index.tsx handleBookmarkSubmit 编排)。
    await BookmarkService.moveBookmark(id, targetWorkspaceId, targetCategoryId);
    set((s) => {
      // 原工作区取自现有切片(优先 bookmarks,回退 allBookmarks)
      const existing = s.bookmarks.find((b) => b.id === id) ?? s.allBookmarks.find((b) => b.id === id);
      const isCrossWorkspace = existing ? existing.workspaceId !== targetWorkspaceId : false;
      return {
        // bookmarks(当前分类切片):移动后无论哪种都应移除——它不再属于当前分类列表
        bookmarks: s.bookmarks.filter((b) => b.id !== id),
        // allBookmarks(当前工作区切片):跨工作区→移除;同工作区跨分类→保留并更新归属
        allBookmarks: isCrossWorkspace
          ? s.allBookmarks.filter((b) => b.id !== id)
          : s.allBookmarks.map((b) =>
              b.id === id ? { ...b, workspaceId: targetWorkspaceId, categoryId: targetCategoryId } : b,
            ),
      };
    });
  },

  reorderBookmarks: async (categoryId, orderedIds) => {
    // 乐观重排:按 orderedIds 重建 bookmarks 切片并赋 0..N;allBookmarks 不动(顺序无关仅去重)
    const prev = get().bookmarks;
    const byId = new Map(prev.map((b) => [b.id, b]));
    set({ bookmarks: orderedIds.map((id, i) => ({ ...byId.get(id)!, order: i })) });
    try {
      await BookmarkService.reorderBookmarks(categoryId, orderedIds);
    } catch (e) {
      // 失败回滚到前一快照
      set({ bookmarks: prev });
      throw e;
    }
  },
}));
