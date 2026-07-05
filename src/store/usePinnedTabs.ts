import { create } from 'zustand';
import type { PinnedTab } from '@/shared/types';
import * as PinnedTabService from '@/services/PinnedTabService';

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
}

export const usePinnedTabs = create<PinnedTabsState>((set) => ({
  pinnedTabs: [],
  loading: false,

  loadPinnedTabs: async (workspaceId) => {
    set({ loading: true });
    try {
      const pinnedTabs = await PinnedTabService.listByWorkspace(workspaceId);
      set({ pinnedTabs });
    } finally {
      // 失败也必须复位 loading，否则 UI 永久 spinner
      set({ loading: false });
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
}));
