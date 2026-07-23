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
import {
  getWorkspaceBinding,
  setWorkspaceBinding,
  clearWorkspaceBinding,
  listAllBindings,
} from '@/shared/windowWorkspaceBinding';
import { clearTabSession } from '@/services/TabSessionService';
import type { SwitchPhase } from '@/shared/tabs/workspaceSwitch';

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  categories: Category[];
  currentCategoryId: string | null;
  loading: boolean;
  /** 切换中的工作区进度（T8 进度反馈：入口 aria-disabled + 目标项 Spinner + loading Toast/Progress）；null=空闲。 */
  switching: { toId: string; phase: SwitchPhase; count: number; total: number } | null;

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
  /** 重排工作区内分类(乐观重排 categories 切片 + 失败回滚)。 */
  reorderCategories: (workspaceId: string, orderedIds: string[]) => Promise<void>;
  /** 重排全部工作区(乐观重排 workspaces 切片 + 失败回滚)。 */
  reorderWorkspaces: (orderedIds: string[]) => Promise<void>;
}

// ── chrome.storage.local 容错读写（home 首屏关键路径，不能因 storage 异常白屏）──
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

/** 取本窗 id（chrome.windows.getCurrent）；非扩展环境/异常 → null（binding 逻辑跳过）。 */
export async function getCurrentWindowId(): Promise<number | null> {
  try {
    const chrome = (globalThis as Record<string, unknown>)['chrome'];
    if (chrome && typeof chrome === 'object') {
      const windows = (chrome as Record<string, unknown>)['windows'];
      if (windows && typeof windows === 'object') {
        const getCurrent = (windows as Record<string, unknown>)['getCurrent'];
        if (typeof getCurrent === 'function') {
          const win = await (getCurrent as () => Promise<{ id?: number }>)();
          return win?.id ?? null;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── 窗口生命周期 listener（onCreated 默认绑定 / onRemoved 清 binding；loadWorkspaces 首次注册）──
// onWindowCreated 运行期读 useWorkspace（store 已初始化），不触模块加载期 TDZ。
const onWindowCreated = async (win: { id: number }) => {
  const ws = useWorkspace.getState().currentWorkspaceId;
  if (ws) await setWorkspaceBinding(win.id, ws);
};
const onWindowRemoved = async (winId: number) => {
  await clearWorkspaceBinding(winId);
};

/** 注册窗口生命周期 listener（loadWorkspaces 调；先 remove 再 add 幂等，避免重复注册）。 */
function registerWindowListeners(): void {
  const chrome = (globalThis as Record<string, unknown>)['chrome'];
  if (!chrome || typeof chrome !== 'object') return;
  const windows = (chrome as Record<string, unknown>)['windows'];
  if (!windows || typeof windows !== 'object') return;
  const onCreated = (windows as Record<string, unknown>)['onCreated'] as
    | {
        addListener?: (cb: (w: { id: number }) => void) => void;
        removeListener?: (cb: (w: { id: number }) => void) => void;
      }
    | undefined;
  const onRemoved = (windows as Record<string, unknown>)['onRemoved'] as
    | {
        addListener?: (cb: (id: number) => void) => void;
        removeListener?: (cb: (id: number) => void) => void;
      }
    | undefined;
  if (onCreated?.addListener) {
    onCreated.removeListener?.(onWindowCreated);
    onCreated.addListener(onWindowCreated);
  }
  if (onRemoved?.addListener) {
    onRemoved.removeListener?.(onWindowRemoved);
    onRemoved.addListener(onWindowRemoved);
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  currentWorkspaceId: null,
  categories: [],
  currentCategoryId: null,
  loading: false,
  switching: null,

  loadWorkspaces: async () => {
    set({ loading: true });
    registerWindowListeners();
    const workspaces = await WorkspaceService.listWorkspaces();
    const { ws: lastWs, catMap } = await readLastSelection();
    let currentWorkspaceId = resolveLastWs(lastWs, workspaces);

    // 本窗 binding 优先于 lastWorkspaceId（home 一旦绑定后用 binding 而非 lastWorkspaceId）。
    // 无 binding / 失效 → 回写当前 ws；有 binding 且存在 → 用 binding 覆盖。
    const winId = await getCurrentWindowId();
    if (winId != null) {
      const binding = await getWorkspaceBinding(winId);
      if (binding && workspaces.some((w) => w.id === binding)) {
        currentWorkspaceId = binding;
      } else if (currentWorkspaceId) {
        await setWorkspaceBinding(winId, currentWorkspaceId);
      }
    }

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
    const wasEmpty = get().workspaces.length === 0;
    const workspace = await WorkspaceService.createWorkspace(name, icon);
    set((s) => ({ workspaces: [...s.workspaces, workspace] }));
    if (!get().currentWorkspaceId) {
      await get().selectWorkspace(workspace.id);
    }
    // 首次创建（零→一，rev4 #6）：给本窗 binding=新 ws（create 本身不编排 tab，但须补 binding）
    if (wasEmpty) {
      const winId = await getCurrentWindowId();
      if (winId != null) await setWorkspaceBinding(winId, workspace.id);
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
    const fallback = workspaces[0]?.id;

    // delete 深化（rev4 #5）：扫所有 binding，凡=被删 ws 的窗口 rebind 到 fallback
    // （无 fallback=删最后 ws → clearBinding，内容 tab 保留不归属）。
    const bindings = await listAllBindings();
    for (const [winId, boundWs] of bindings) {
      if (boundWs === id) {
        if (fallback) await setWorkspaceBinding(winId, fallback);
        else await clearWorkspaceBinding(winId);
      }
    }
    // 隐私：清已删 ws 的 tab 会话（不留已删 ws 的 tab URL）
    await clearTabSession(id);

    const wasCurrent = get().currentWorkspaceId === id;
    if (wasCurrent) {
      if (fallback) {
        // 复用 selectWorkspace：persist 新 ws + 加载分类 + 恢复该 ws 的 last-cat
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

  reorderCategories: async (workspaceId, orderedIds) => {
    // 乐观重排:按 orderedIds 重建 categories 切片并赋 0..N
    const prev = get().categories;
    const byId = new Map(prev.map((c) => [c.id, c]));
    set({ categories: orderedIds.map((id, i) => ({ ...byId.get(id)!, order: i })) });
    try {
      await CategoryService.reorderCategories(workspaceId, orderedIds);
    } catch (e) {
      set({ categories: prev });
      throw e;
    }
  },

  reorderWorkspaces: async (orderedIds) => {
    // 乐观重排:按 orderedIds 重建 workspaces 切片并赋 0..N
    const prev = get().workspaces;
    const byId = new Map(prev.map((w) => [w.id, w]));
    set({ workspaces: orderedIds.map((id, i) => ({ ...byId.get(id)!, order: i })) });
    try {
      await WorkspaceService.reorderWorkspaces(orderedIds);
    } catch (e) {
      set({ workspaces: prev });
      throw e;
    }
  },
}));
