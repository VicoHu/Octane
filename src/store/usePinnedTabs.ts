import { create } from 'zustand';
import type { PinnedTab } from '@/shared/types';
import * as PinnedTabService from '@/services/PinnedTabService';

/**
 * loadPinnedTabs 请求序列号：快速切工作区（A→B）时，A 的旧响应可能晚于 B 返回，
 * 若不guard 会用 A 的常驻标签覆盖 B 的切片（用户以为在看 B，实际点到 A 的链接）。
 * 仅最新请求的结果才落切片。
 */
let loadSeq = 0;

interface PinnedTabsState {
  pinnedTabs: PinnedTab[];
  loading: boolean;

  /** 加载指定工作区的常驻标签（跨分类，per-workspace）。 */
  loadPinnedTabs: (workspaceId: string) => Promise<void>;
  /** 创建常驻标签；cap/dedup 错误向上抛，由 UI 层 Toast。 */
  createPinnedTab: (
    workspaceId: string,
    data: { name: string; url: string },
  ) => Promise<PinnedTab>;
  /** 删除常驻标签。 */
  deletePinnedTab: (id: string) => Promise<void>;
  /** 重排工作区内常驻标签(乐观重排 pinnedTabs 切片 + 失败回滚)。 */
  reorderPinnedTabs: (workspaceId: string, orderedIds: string[]) => Promise<void>;
}

export const usePinnedTabs = create<PinnedTabsState>((set, get) => ({
  pinnedTabs: [],
  loading: false,

  loadPinnedTabs: async (workspaceId) => {
    const mySeq = ++loadSeq;
    set({ loading: true });
    try {
      const pinnedTabs = await PinnedTabService.listByWorkspace(workspaceId);
      // 丢弃过期响应：切工作区后旧请求晚返回时不覆盖最新切片
      if (mySeq !== loadSeq) return;
      set({ pinnedTabs });
    } finally {
      if (mySeq === loadSeq) set({ loading: false });
    }
  },

  createPinnedTab: async (workspaceId, data) => {
    // 不吞错：cap/dedup 错误向上抛，UI 层据 message Toast；切片保持不变
    const pin = await PinnedTabService.createPinnedTab(workspaceId, data);
    set((s) => ({ pinnedTabs: [...s.pinnedTabs, pin] }));
    return pin;
  },

  deletePinnedTab: async (id) => {
    await PinnedTabService.deletePinnedTab(id);
    set((s) => ({ pinnedTabs: s.pinnedTabs.filter((p) => p.id !== id) }));
  },

  reorderPinnedTabs: async (workspaceId, orderedIds) => {
    // 乐观重排:按 orderedIds 重建 pinnedTabs 切片并赋 0..N
    const prev = get().pinnedTabs;
    const byId = new Map(prev.map((p) => [p.id, p]));
    set({ pinnedTabs: orderedIds.map((id, i) => ({ ...byId.get(id)!, order: i })) });
    try {
      await PinnedTabService.reorderPinnedTabs(workspaceId, orderedIds);
    } catch (e) {
      set({ pinnedTabs: prev });
      throw e;
    }
  },
}));
