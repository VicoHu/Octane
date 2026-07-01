import { create } from 'zustand';
import type { Workspace, Category } from '@/shared/types';
import * as WorkspaceService from '@/services/WorkspaceService';
import * as CategoryService from '@/services/CategoryService';
import {
  LAST_WS_KEY,
  LAST_CAT_BY_WS_KEY,
  resolveLastWs,
  resolveLastCat,
  type LastCatMap,
} from '@/shared/lastSelection';

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  categories: Category[];
  currentCategoryId: string | null;
  loading: boolean;

  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string, icon: string) => Promise<void>;
  updateWorkspace: (id: string, updates: Partial<Pick<Workspace, 'name' | 'icon' | 'order'>>) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  selectWorkspace: (id: string) => Promise<void>;

  loadCategories: () => Promise<void>;
  createCategory: (name: string, icon: string) => Promise<void>;
  updateCategory: (id: string, updates: Partial<Pick<Category, 'name' | 'icon' | 'order'>>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  selectCategory: (id: string) => void;
}

// ── chrome.storage.local 容错读写（newtab 首屏关键路径，不能因 storage 异常白屏）──
// workspace 全局共享一份；category per-workspace map（分类是工作区作用域）。

/** 读 last-selected；storage 异常时返回空（静默回退到第一个）。 */
async function readLastSelection(): Promise<{ ws: string | undefined; catMap: LastCatMap }> {
  try {
    const stored = await chrome.storage.local.get([LAST_WS_KEY, LAST_CAT_BY_WS_KEY]);
    return {
      ws: stored[LAST_WS_KEY] as string | undefined,
      catMap: (stored[LAST_CAT_BY_WS_KEY] as LastCatMap | undefined) ?? {},
    };
  } catch {
    return { ws: undefined, catMap: {} };
  }
}

/** persist 上次的工作区；写失败静默吞（内存选中态仍生效，只是本次未落盘）。 */
async function persistWs(wsId: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [LAST_WS_KEY]: wsId });
  } catch {
    // 静默：选中态已在内存，落盘失败不影响本次使用
  }
}

/** persist 指定工作区上次的分类（per-workspace map）。 */
async function persistCat(wsId: string, catId: string): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(LAST_CAT_BY_WS_KEY);
    const map: LastCatMap = (stored[LAST_CAT_BY_WS_KEY] as LastCatMap | undefined) ?? {};
    map[wsId] = catId;
    await chrome.storage.local.set({ [LAST_CAT_BY_WS_KEY]: map });
  } catch {
    // 静默
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  currentWorkspaceId: null,
  categories: [],
  currentCategoryId: null,
  loading: false,

  loadWorkspaces: async () => {
    set({ loading: true });
    const workspaces = await WorkspaceService.listWorkspaces();
    const { ws: lastWs, catMap } = await readLastSelection();
    const currentWorkspaceId = resolveLastWs(lastWs, workspaces);
    set({ workspaces, currentWorkspaceId, loading: false });

    if (currentWorkspaceId) {
      const categories = await CategoryService.listCategories(currentWorkspaceId);
      const currentCategoryId = resolveLastCat(currentWorkspaceId, categories, catMap);
      set({ categories, currentCategoryId });
    } else {
      set({ categories: [], currentCategoryId: null });
    }
  },

  createWorkspace: async (name, icon) => {
    const workspace = await WorkspaceService.createWorkspace(name, icon);
    set((s) => ({ workspaces: [...s.workspaces, workspace] }));
    if (!get().currentWorkspaceId) {
      await get().selectWorkspace(workspace.id);
    }
  },

  updateWorkspace: async (id, updates) => {
    await WorkspaceService.updateWorkspace(id, updates);
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...updates } : w)),
    }));
  },

  deleteWorkspace: async (id) => {
    await WorkspaceService.deleteWorkspace(id);
    const workspaces = await WorkspaceService.listWorkspaces();
    set({ workspaces });
    const wasCurrent = get().currentWorkspaceId === id;
    if (wasCurrent) {
      // 复用 selectWorkspace：persist 新 ws + 加载分类 + 恢复该 ws 的 last-cat
      const fallback = workspaces[0]?.id;
      if (fallback) {
        await get().selectWorkspace(fallback);
      } else {
        set({ currentWorkspaceId: null, categories: [], currentCategoryId: null });
      }
    }
  },

  selectWorkspace: async (id) => {
    set({ currentWorkspaceId: id, currentCategoryId: null });
    await persistWs(id);
    const categories = await CategoryService.listCategories(id);
    const { catMap } = await readLastSelection();
    // 读该工作区上次的分类（不 persist：cat 来自历史/回退，非本次显式选择，避免污染偏好）
    const currentCategoryId = resolveLastCat(id, categories, catMap);
    set({ categories, currentCategoryId });
  },

  loadCategories: async () => {
    const workspaceId = get().currentWorkspaceId;
    if (!workspaceId) return;
    const categories = await CategoryService.listCategories(workspaceId);
    set({ categories });
  },

  createCategory: async (name, icon) => {
    const workspaceId = get().currentWorkspaceId;
    if (!workspaceId) return;
    const category = await CategoryService.createCategory(workspaceId, name, icon);
    set((s) => ({ categories: [...s.categories, category] }));
  },

  updateCategory: async (id, updates) => {
    await CategoryService.updateCategory(id, updates);
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
  },

  deleteCategory: async (id) => {
    await CategoryService.deleteCategory(id);
    const categories = get().categories.filter((c) => c.id !== id);
    const wasCurrent = get().currentCategoryId === id;
    const currentCategoryId = wasCurrent
      ? (categories[0]?.id ?? null)
      : get().currentCategoryId;
    set({ categories, currentCategoryId });
    // 删除当前分类后回退的新分类要 persist（保持落盘一致）
    if (wasCurrent && currentCategoryId) {
      const wsId = get().currentWorkspaceId;
      if (wsId) await persistCat(wsId, currentCategoryId);
    }
  },

  selectCategory: (id) => {
    set({ currentCategoryId: id });
    // 唯一 persist category 的入口：显式选择才落盘（T2）
    const wsId = get().currentWorkspaceId;
    if (wsId) void persistCat(wsId, id);
  },
}));
