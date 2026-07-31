import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';

// mock WorkspaceService / CategoryService
const ws = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  reorderWorkspaces: vi.fn(),
}));
vi.mock('@/services/WorkspaceService', () => ws);

const cat = vi.hoisted(() => ({
  listCategories: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  reorderCategories: vi.fn(),
}));
vi.mock('@/services/CategoryService', () => cat);

import { useWorkspace } from '@/store/useWorkspace';
import { IDENTITY_SUFFIX } from '@/shared/tabs/tabGroupIdentity';

const wsOf = (id: string, name = 'WS', order = 0) =>
  ({ id, name, icon: '📁', createdAt: 1, order }) as never;
const catOf = (id: string, wsId: string, name = 'CAT', order = 0) =>
  ({ id, workspaceId: wsId, name, icon: '📂', order, createdAt: 1 }) as never;

beforeEach(() => {
  useWorkspace.setState({
    workspaces: [],
    currentWorkspaceId: null,
    categories: [],
    currentCategoryId: null,
    loading: false,
  });
  installChromeStorageLocal();
  ws.listWorkspaces.mockReset();
  ws.createWorkspace.mockReset();
  ws.updateWorkspace.mockReset();
  ws.deleteWorkspace.mockReset();
  ws.reorderWorkspaces.mockReset();
  cat.listCategories.mockReset();
  cat.updateCategory.mockReset();
  cat.deleteCategory.mockReset();
  cat.reorderCategories.mockReset();
});

/** 给 globalThis.chrome 装上 windows.getCurrent mock（本窗 binding 测试用）。 */
function withWindows(windowId: number | null) {
  const chrome = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
  chrome.windows = {
    getCurrent: vi.fn(async () => (windowId == null ? undefined : { id: windowId })),
  };
}

/** 装 windows.getCurrent + onCreated/onRemoved 事件 mock（窗口 listener 测试用）。 */
function withWindowEvents(windowId = 100) {
  const chrome = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
  const createdCbs: Array<(w: { id: number }) => Promise<void> | void> = [];
  const removedCbs: Array<(id: number) => Promise<void> | void> = [];
  chrome.windows = {
    getCurrent: vi.fn(async () => ({ id: windowId })),
    onCreated: {
      addListener: vi.fn((cb: (w: { id: number }) => Promise<void> | void) => createdCbs.push(cb)),
      removeListener: vi.fn(),
    },
    onRemoved: {
      addListener: vi.fn((cb: (id: number) => Promise<void> | void) => removedCbs.push(cb)),
      removeListener: vi.fn(),
    },
  };
  return {
    // for...of + await：等待 async listener（setWorkspaceBinding/clear）完成
    fireCreated: async (win: { id: number }) => {
      for (const cb of createdCbs) await cb(win);
    },
    fireRemoved: async (id: number) => {
      for (const cb of removedCbs) await cb(id);
    },
  };
}

describe('useWorkspace — updateWorkspace', () => {
  it('调用 Service 并同步本地 workspaces', async () => {
    useWorkspace.setState({
      workspaces: [wsOf('w1', '旧名')],
      currentWorkspaceId: 'w1',
    });

    const { updateWorkspace } = useWorkspace.getState();
    await updateWorkspace('w1', { name: '新名', icon: '🚀' });

    expect(ws.updateWorkspace).toHaveBeenCalledWith('w1', { name: '新名', icon: '🚀' });
    const updated = useWorkspace.getState().workspaces.find((w) => w.id === 'w1');
    expect(updated?.name).toBe('新名');
    expect(updated?.icon).toBe('🚀');
  });

  it('保留未更新字段（createdAt / order）', async () => {
    useWorkspace.setState({
      workspaces: [{ id: 'w1', name: '旧名', icon: '📁', createdAt: 99, order: 2 }],
      currentWorkspaceId: 'w1',
    });

    await useWorkspace.getState().updateWorkspace('w1', { icon: '📚' });

    const updated = useWorkspace.getState().workspaces.find((w) => w.id === 'w1');
    expect(updated?.createdAt).toBe(99);
    expect(updated?.order).toBe(2);
    expect(updated?.name).toBe('旧名');
  });
});

describe('useWorkspace — updateCategory', () => {
  it('调用 Service 并同步本地 categories', async () => {
    useWorkspace.setState({
      currentWorkspaceId: 'w1',
      categories: [catOf('c1', 'w1', '旧') as never],
      currentCategoryId: 'c1',
    });

    const { updateCategory } = useWorkspace.getState();
    await updateCategory('c1', { name: '新', icon: '🎯' });

    expect(cat.updateCategory).toHaveBeenCalledWith('c1', { name: '新', icon: '🎯' });
    const updated = useWorkspace.getState().categories.find((c) => c.id === 'c1');
    expect(updated?.name).toBe('新');
    expect(updated?.icon).toBe('🎯');
  });
});

describe('useWorkspace — loadWorkspaces 持久化恢复', () => {
  it('无 last-selected → 落第一个工作区和第一个分类', async () => {
    ws.listWorkspaces.mockResolvedValue([wsOf('w1'), wsOf('w2')]);
    cat.listCategories.mockResolvedValue([catOf('c1', 'w1')]);

    await useWorkspace.getState().loadWorkspaces();

    expect(useWorkspace.getState().currentWorkspaceId).toBe('w1');
    expect(useWorkspace.getState().currentCategoryId).toBe('c1');
  });

  it('有 last-ws 且仍存在 → 恢复该工作区', async () => {
    installChromeStorageLocal({ initial: { lastWorkspaceId: 'w2' } });
    ws.listWorkspaces.mockResolvedValue([wsOf('w1'), wsOf('w2')]);
    cat.listCategories.mockResolvedValue([catOf('c1', 'w2')]);

    await useWorkspace.getState().loadWorkspaces();

    expect(useWorkspace.getState().currentWorkspaceId).toBe('w2');
    expect(cat.listCategories).toHaveBeenCalledWith('w2');
  });

  it('last-ws 失效 → 回退第一个', async () => {
    installChromeStorageLocal({ initial: { lastWorkspaceId: 'wGhost' } });
    ws.listWorkspaces.mockResolvedValue([wsOf('w1')]);
    cat.listCategories.mockResolvedValue([catOf('c1', 'w1')]);

    await useWorkspace.getState().loadWorkspaces();

    expect(useWorkspace.getState().currentWorkspaceId).toBe('w1');
  });

  it('per-ws map 命中 → 恢复该工作区上次的分类', async () => {
    installChromeStorageLocal({
      initial: { lastWorkspaceId: 'w1', lastCategoryIdByWs: { w1: 'c2' } },
    });
    ws.listWorkspaces.mockResolvedValue([wsOf('w1')]);
    cat.listCategories.mockResolvedValue([catOf('c1', 'w1'), catOf('c2', 'w1')]);

    await useWorkspace.getState().loadWorkspaces();

    expect(useWorkspace.getState().currentCategoryId).toBe('c2');
  });

  it('per-ws map 里的分类已被删 → 回退第一个', async () => {
    installChromeStorageLocal({
      initial: { lastWorkspaceId: 'w1', lastCategoryIdByWs: { w1: 'cGhost' } },
    });
    ws.listWorkspaces.mockResolvedValue([wsOf('w1')]);
    cat.listCategories.mockResolvedValue([catOf('c1', 'w1')]);

    await useWorkspace.getState().loadWorkspaces();

    expect(useWorkspace.getState().currentCategoryId).toBe('c1');
  });

  it('storage.get 抛错 → 不抛出，回退第一个（A1 容错）', async () => {
    installChromeStorageLocal({
      getImpl: async () => {
        throw new Error('quota exceeded');
      },
    });
    ws.listWorkspaces.mockResolvedValue([wsOf('w1')]);
    cat.listCategories.mockResolvedValue([catOf('c1', 'w1')]);

    await expect(useWorkspace.getState().loadWorkspaces()).resolves.toBeUndefined();
    expect(useWorkspace.getState().currentWorkspaceId).toBe('w1');
    expect(useWorkspace.getState().currentCategoryId).toBe('c1');
  });
});

describe('useWorkspace — loadWorkspaces 窗口绑定（T1b：本窗 binding 优先）', () => {
  it('本窗无 binding → 回写 binding=当前 ws', async () => {
    const { store } = installChromeStorageLocal({ initial: {} });
    withWindows(100);
    ws.listWorkspaces.mockResolvedValue([wsOf('w1'), wsOf('w2')]);
    cat.listCategories.mockResolvedValue([catOf('c1', 'w1')]);

    await useWorkspace.getState().loadWorkspaces();

    expect(useWorkspace.getState().currentWorkspaceId).toBe('w1');
    expect(store['windowWorkspaceBinding.100']).toBe('w1');
  });

  it('本窗有 binding → 用 binding 覆盖（优先于 lastWorkspaceId）', async () => {
    installChromeStorageLocal({
      initial: { lastWorkspaceId: 'w1', 'windowWorkspaceBinding.100': 'w2' },
    });
    withWindows(100);
    ws.listWorkspaces.mockResolvedValue([wsOf('w1'), wsOf('w2')]);
    cat.listCategories.mockResolvedValue([catOf('c2', 'w2')]);

    await useWorkspace.getState().loadWorkspaces();

    // binding=w2 覆盖 lastWorkspaceId=w1（home 一旦绑定后用 binding 而非 lastWorkspaceId）
    expect(useWorkspace.getState().currentWorkspaceId).toBe('w2');
    expect(cat.listCategories).toHaveBeenCalledWith('w2');
  });

  it('binding 失效（指向已删 ws）→ 回退 resolved + 回写新 binding', async () => {
    const { store } = installChromeStorageLocal({
      initial: { 'windowWorkspaceBinding.100': 'wGhost' },
    });
    withWindows(100);
    ws.listWorkspaces.mockResolvedValue([wsOf('w1')]);
    cat.listCategories.mockResolvedValue([catOf('c1', 'w1')]);

    await useWorkspace.getState().loadWorkspaces();

    expect(useWorkspace.getState().currentWorkspaceId).toBe('w1');
    expect(store['windowWorkspaceBinding.100']).toBe('w1');
  });
});

describe('useWorkspace — createWorkspace 首建补 binding（T1b rev4 #6）', () => {
  it('零 ws → 创建首个 ws → 给本窗 binding=新 ws', async () => {
    const { store } = installChromeStorageLocal({ initial: {} });
    withWindows(100);
    useWorkspace.setState({ workspaces: [], currentWorkspaceId: null });
    ws.createWorkspace.mockResolvedValue(wsOf('wNew', '新'));
    cat.listCategories.mockResolvedValue([]);

    await useWorkspace.getState().createWorkspace('新', '🆕');

    expect(store['windowWorkspaceBinding.100']).toBe('wNew');
    expect(useWorkspace.getState().currentWorkspaceId).toBe('wNew');
  });

  it('已有 ws → 创建新 ws → 不改本窗 binding（非首建）', async () => {
    const { store } = installChromeStorageLocal({
      initial: { 'windowWorkspaceBinding.100': 'wOld' },
    });
    withWindows(100);
    useWorkspace.setState({ workspaces: [wsOf('wOld')], currentWorkspaceId: 'wOld' });
    ws.createWorkspace.mockResolvedValue(wsOf('wNew', '新'));

    await useWorkspace.getState().createWorkspace('新', '🆕');

    // 非首建：binding 保持 wOld，不被新 ws 覆盖
    expect(store['windowWorkspaceBinding.100']).toBe('wOld');
  });
});

describe('useWorkspace — selectWorkspace 持久化', () => {
  it('切换工作区 → persist last-ws + 恢复该工作区 last-cat（不在切换时 persist cat）', async () => {
    const { store } = installChromeStorageLocal({
      initial: { lastCategoryIdByWs: { w2: 'c2' } },
    });
    cat.listCategories.mockResolvedValue([catOf('c1', 'w2'), catOf('c2', 'w2')]);

    await useWorkspace.getState().selectWorkspace('w2');

    expect(useWorkspace.getState().currentWorkspaceId).toBe('w2');
    expect(useWorkspace.getState().currentCategoryId).toBe('c2');
    expect(store.lastWorkspaceId).toBe('w2');
    // T2：selectWorkspace 读 map 恢复 cat，但不写入 map（避免 fallback 值污染偏好）
    expect(store.lastCategoryIdByWs).toEqual({ w2: 'c2' });
  });

  it('切到无 last-cat 的工作区 → cat 落第一个', async () => {
    installChromeStorageLocal({ initial: {} });
    cat.listCategories.mockResolvedValue([catOf('c1', 'w3')]);

    await useWorkspace.getState().selectWorkspace('w3');

    expect(useWorkspace.getState().currentCategoryId).toBe('c1');
  });
});

describe('useWorkspace — selectCategory persist', () => {
  it('显式选分类 → persist map[当前ws]=cat', async () => {
    const { store } = installChromeStorageLocal({ initial: {} });
    useWorkspace.setState({ currentWorkspaceId: 'w1', currentCategoryId: 'c1' });

    useWorkspace.getState().selectCategory('c2');

    expect(useWorkspace.getState().currentCategoryId).toBe('c2');
    // selectCategory 接口是 sync（UI 立即更新），persist 为后台 async：等其落定
    await vi.waitFor(() => expect(store.lastCategoryIdByWs).toEqual({ w1: 'c2' }));
  });
});

describe('useWorkspace — per-workspace cat 独立性（Codex #1 回归）', () => {
  it('A→B→A 切换：回到 A 时仍恢复 A 的 last-cat', async () => {
    installChromeStorageLocal({
      initial: { lastCategoryIdByWs: { wA: 'cA2', wB: 'cB1' } },
    });

    cat.listCategories.mockResolvedValueOnce([catOf('cB1', 'wB'), catOf('cB2', 'wB')]);
    await useWorkspace.getState().selectWorkspace('wB');
    expect(useWorkspace.getState().currentCategoryId).toBe('cB1');

    cat.listCategories.mockResolvedValueOnce([catOf('cA1', 'wA'), catOf('cA2', 'wA')]);
    await useWorkspace.getState().selectWorkspace('wA');
    expect(useWorkspace.getState().currentCategoryId).toBe('cA2');
  });
});

describe('useWorkspace — delete 持久化', () => {
  it('删除当前工作区 → 回退第一个 + persist 更新 last-ws', async () => {
    const { store } = installChromeStorageLocal({ initial: { lastWorkspaceId: 'w1' } });
    ws.deleteWorkspace.mockResolvedValue(undefined);
    ws.listWorkspaces.mockResolvedValue([wsOf('w2')]);
    cat.listCategories.mockResolvedValue([catOf('c1', 'w2')]);
    useWorkspace.setState({
      workspaces: [wsOf('w1'), wsOf('w2')],
      currentWorkspaceId: 'w1',
    });

    await useWorkspace.getState().deleteWorkspace('w1');

    expect(useWorkspace.getState().currentWorkspaceId).toBe('w2');
    expect(store.lastWorkspaceId).toBe('w2');
  });

  it('删除最后一个工作区 → 进入无工作区空状态', async () => {
    ws.deleteWorkspace.mockResolvedValue(undefined);
    ws.listWorkspaces.mockResolvedValue([]);
    useWorkspace.setState({
      workspaces: [wsOf('w1')],
      currentWorkspaceId: 'w1',
      categories: [catOf('c1', 'w1')],
      currentCategoryId: 'c1',
    });

    await useWorkspace.getState().deleteWorkspace('w1');

    expect(useWorkspace.getState().workspaces).toEqual([]);
    expect(useWorkspace.getState().currentWorkspaceId).toBeNull();
    expect(useWorkspace.getState().categories).toEqual([]);
    expect(useWorkspace.getState().currentCategoryId).toBeNull();
  });

  it('删除当前分类 → 回退第一个剩余分类 + persist 更新 map', async () => {
    const { store } = installChromeStorageLocal({ initial: {} });
    cat.deleteCategory.mockResolvedValue(undefined);
    useWorkspace.setState({
      currentWorkspaceId: 'w1',
      categories: [catOf('c1', 'w1'), catOf('c2', 'w1')],
      currentCategoryId: 'c1',
    });

    await useWorkspace.getState().deleteCategory('c1');

    expect(useWorkspace.getState().currentCategoryId).toBe('c2');
    expect(store.lastCategoryIdByWs).toEqual({ w1: 'c2' });
  });
});

describe('useWorkspace — deleteWorkspace 深化（T1c rev4 #5：rebind + 清 session）', () => {
  it('删 ws：所有 bound=该 ws 的窗口 rebind 到 fallback', async () => {
    const { store } = installChromeStorageLocal({
      initial: {
        'windowWorkspaceBinding.100': 'wDel',
        'windowWorkspaceBinding.200': 'wKeep',
      },
    });
    useWorkspace.setState({
      workspaces: [wsOf('wDel'), wsOf('wKeep')],
      currentWorkspaceId: 'wKeep',
    });
    ws.deleteWorkspace.mockResolvedValue(undefined);
    ws.listWorkspaces.mockResolvedValue([wsOf('wKeep')]);
    cat.listCategories.mockResolvedValue([]);

    await useWorkspace.getState().deleteWorkspace('wDel');

    // wDel 的窗口 100 rebind 到 fallback(wKeep)；窗口 200 已是 wKeep 不变
    expect(store['windowWorkspaceBinding.100']).toBe('wKeep');
    expect(store['windowWorkspaceBinding.200']).toBe('wKeep');
  });

  it('删 ws → 清该 ws 的 tabSession（隐私：不留已删 ws 的 tab URL）', async () => {
    const { store } = installChromeStorageLocal({
      initial: {
        'tabSession.wDel': { tabs: [{ url: 'https://secret.example', order: 0 }], savedAt: 1 },
      },
    });
    useWorkspace.setState({
      workspaces: [wsOf('wDel'), wsOf('wKeep')],
      currentWorkspaceId: 'wKeep',
    });
    ws.deleteWorkspace.mockResolvedValue(undefined);
    ws.listWorkspaces.mockResolvedValue([wsOf('wKeep')]);

    await useWorkspace.getState().deleteWorkspace('wDel');

    expect(store['tabSession.wDel']).toBeUndefined();
  });

  it('删最后 ws（无剩余）→ bound 该 ws 的窗口 clearBinding + currentWorkspaceId=null', async () => {
    const { store } = installChromeStorageLocal({
      initial: { 'windowWorkspaceBinding.100': 'wOnly' },
    });
    useWorkspace.setState({
      workspaces: [wsOf('wOnly')],
      currentWorkspaceId: 'wOnly',
    });
    ws.deleteWorkspace.mockResolvedValue(undefined);
    ws.listWorkspaces.mockResolvedValue([]);

    await useWorkspace.getState().deleteWorkspace('wOnly');

    expect(store['windowWorkspaceBinding.100']).toBeUndefined();
    expect(useWorkspace.getState().currentWorkspaceId).toBeNull();
  });
});

describe('useWorkspace — T3 reorder(乐观重排 + 失败回滚)', () => {
  it('reorderCategories 乐观重排 categories 切片并赋 0..N', async () => {
    useWorkspace.setState({
      workspaces: [],
      currentWorkspaceId: 'w1',
      categories: [catOf('c1', 'w1', 'CAT', 0), catOf('c2', 'w1', 'CAT', 1), catOf('c3', 'w1', 'CAT', 2)],
      currentCategoryId: 'c1',
    });

    await useWorkspace.getState().reorderCategories('w1', ['c3', 'c1', 'c2']);

    expect(cat.reorderCategories).toHaveBeenCalledWith('w1', ['c3', 'c1', 'c2']);
    const cs = useWorkspace.getState().categories;
    expect(cs.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
    expect(cs.map((c) => c.order)).toEqual([0, 1, 2]);
  });

  it('reorderCategories 失败 → categories 回滚前一快照', async () => {
    cat.reorderCategories.mockRejectedValue(new Error('排序 ID 数量与现有记录不一致'));
    useWorkspace.setState({
      workspaces: [],
      currentWorkspaceId: 'w1',
      categories: [catOf('c1', 'w1', 'CAT', 0), catOf('c2', 'w1', 'CAT', 1)],
      currentCategoryId: 'c1',
    });

    await expect(
      useWorkspace.getState().reorderCategories('w1', ['c2', 'c1']),
    ).rejects.toThrow('排序 ID 数量与现有记录不一致');

    const cs = useWorkspace.getState().categories;
    expect(cs.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(cs.map((c) => c.order)).toEqual([0, 1]);
  });

  it('reorderWorkspaces 乐观重排 workspaces 切片并赋 0..N', async () => {
    useWorkspace.setState({
      workspaces: [wsOf('w1', 'WS', 0), wsOf('w2', 'WS', 1)],
      currentWorkspaceId: 'w1',
    });

    await useWorkspace.getState().reorderWorkspaces(['w2', 'w1']);

    expect(ws.reorderWorkspaces).toHaveBeenCalledWith(['w2', 'w1']);
    const list = useWorkspace.getState().workspaces;
    expect(list.map((w) => w.id)).toEqual(['w2', 'w1']);
    expect(list.map((w) => w.order)).toEqual([0, 1]);
  });

  it('reorderWorkspaces 失败 → workspaces 回滚前一快照', async () => {
    ws.reorderWorkspaces.mockRejectedValue(new Error('排序 ID 数量与现有记录不一致'));
    useWorkspace.setState({
      workspaces: [wsOf('w1', 'WS', 0), wsOf('w2', 'WS', 1)],
      currentWorkspaceId: 'w1',
    });

    await expect(
      useWorkspace.getState().reorderWorkspaces(['w2', 'w1']),
    ).rejects.toThrow('排序 ID 数量与现有记录不一致');

    const list = useWorkspace.getState().workspaces;
    expect(list.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(list.map((w) => w.order)).toEqual([0, 1]);
  });
});

describe('useWorkspace — T9 deleteWorkspace 清 hide 孤儿组（隐私）', () => {
  /** 装 tabGroups/tabs/windows 内存 stub（installChromeStorageLocal 覆盖了 T0 stub）。 */
  function withTabGroupStub(windows: number[]) {
    const c = (globalThis as Record<string, unknown>).chrome as Record<string, any>;
    const groups = new Map<number, any>();
    const tabsStore = new Map<number, any>();
    c.tabGroups = {
      query: async (info: { windowId?: number } = {}) =>
        Array.from(groups.values()).filter(
          (g) => info.windowId == null || g.windowId === info.windowId,
        ),
    };
    c.tabs = {
      query: async (info: { windowId?: number } = {}) =>
        Array.from(tabsStore.values()).filter(
          (t) => info.windowId == null || t.windowId === info.windowId,
        ),
      remove: async (id: number) => {
        tabsStore.delete(id);
      },
    };
    c.windows = {
      getAll: async () => windows.map((id) => ({ id })),
    };
    return { groups, tabsStore };
  }

  it('删 ws：该 ws 的 hide 标识组内 tab 被 remove；别 ws 的组不碰', async () => {
    installChromeStorageLocal({ initial: {} });
    const { groups, tabsStore } = withTabGroupStub([1, 2]);

    // 窗口 1：wDel 的 hide 标识组（tab 1）+ 无关 tab（tab 2）
    groups.set(10, {
      id: 10,
      windowId: 1,
      title: `X${IDENTITY_SUFFIX('wDel')}`,
      color: 'grey',
      collapsed: true,
    });
    tabsStore.set(1, { id: 1, windowId: 1, url: 'https://x.com', groupId: 10 });
    tabsStore.set(2, { id: 2, windowId: 1, url: 'https://y.com', groupId: -1 });
    // 窗口 2：别 ws(wKeep) 的标识组（tab 3）—— 不应被清
    groups.set(20, {
      id: 20,
      windowId: 2,
      title: `Y${IDENTITY_SUFFIX('wKeep')}`,
      color: 'grey',
      collapsed: true,
    });
    tabsStore.set(3, { id: 3, windowId: 2, url: 'https://z.com', groupId: 20 });

    useWorkspace.setState({
      workspaces: [wsOf('wDel'), wsOf('wKeep')],
      currentWorkspaceId: 'wKeep',
    });
    ws.deleteWorkspace.mockResolvedValue(undefined);
    ws.listWorkspaces.mockResolvedValue([wsOf('wKeep')]);

    await useWorkspace.getState().deleteWorkspace('wDel');

    // wDel 标识组的 tab 1 被 remove；窗口 1 无关 tab 2 保留；窗口 2 别 ws 的 tab 3 不碰
    expect(tabsStore.has(1)).toBe(false);
    expect(tabsStore.has(2)).toBe(true);
    expect(tabsStore.has(3)).toBe(true);
  });

  it('删 ws：清其冷恢复 topology 当前项或 resident 引用', async () => {
    const { store } = installChromeStorageLocal({
      initial: {
        'sessionContinuity.topology': {
          currentWorkspaceId: 'wKeep',
          residents: [
            { workspaceId: 'wDel', title: 'Del ·dddddddd' },
            { workspaceId: 'wOther', title: 'Other ·oooooooo' },
          ],
        },
      },
    });
    const c = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    c.runtime = { getURL: () => 'chrome-extension://octane/home.html' };
    c.windows = { getAll: async () => [] };
    c.tabs = { query: async () => [], remove: async () => {} };
    c.tabGroups = { query: async () => [] };
    useWorkspace.setState({ workspaces: [wsOf('wDel'), wsOf('wKeep')], currentWorkspaceId: 'wKeep' });
    ws.deleteWorkspace.mockResolvedValue(undefined);
    ws.listWorkspaces.mockResolvedValue([wsOf('wKeep')]);

    await useWorkspace.getState().deleteWorkspace('wDel');

    expect(store['sessionContinuity.topology']).toEqual({
      currentWorkspaceId: 'wKeep',
      residents: [{ workspaceId: 'wOther', title: 'Other ·oooooooo' }],
    });
  });

  it('删 current ws：移除整个冷恢复 topology，避免保留其 URL 引用', async () => {
    const { store } = installChromeStorageLocal({
      initial: {
        'sessionContinuity.topology': {
          currentWorkspaceId: 'wDel',
          residents: [{ workspaceId: 'wKeep', title: 'Keep ·kkkkkkkk' }],
        },
      },
    });
    const c = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    c.runtime = { getURL: () => 'chrome-extension://octane/home.html' };
    c.windows = { getAll: async () => [] };
    c.tabs = { query: async () => [], remove: async () => {} };
    c.tabGroups = { query: async () => [] };
    useWorkspace.setState({ workspaces: [wsOf('wDel'), wsOf('wKeep')], currentWorkspaceId: 'wDel' });
    ws.deleteWorkspace.mockResolvedValue(undefined);
    ws.listWorkspaces.mockResolvedValue([wsOf('wKeep')]);
    cat.listCategories.mockResolvedValue([]);

    await useWorkspace.getState().deleteWorkspace('wDel');

    expect(store['sessionContinuity.topology']).toBeUndefined();
  });

  it('windows.getAll 抛错 → 不阻断 delete（非扩展环境/部分失败容错）', async () => {
    installChromeStorageLocal({ initial: {} });
    const c = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    c.windows = {
      getAll: async () => {
        throw new Error('chrome unavailable');
      },
    };

    useWorkspace.setState({
      workspaces: [wsOf('wDel'), wsOf('wKeep')],
      currentWorkspaceId: 'wKeep',
    });
    ws.deleteWorkspace.mockResolvedValue(undefined);
    ws.listWorkspaces.mockResolvedValue([wsOf('wKeep')]);

    // 主流程（rebind / fallback / 清 session）仍完成；hide 清理静默吞错
    await expect(useWorkspace.getState().deleteWorkspace('wDel')).resolves.toBeUndefined();
    expect(useWorkspace.getState().workspaces.map((w) => w.id)).toEqual(['wKeep']);
  });
});

describe('useWorkspace — 窗口 listener（T1c：onCreated 默认绑定 / onRemoved 清 binding）', () => {
  it('loadWorkspaces 注册 onCreated：新窗 → 默认 binding=当前 ws', async () => {
    const { store } = installChromeStorageLocal({ initial: {} });
    const events = withWindowEvents(100);
    ws.listWorkspaces.mockResolvedValue([wsOf('wCur')]);
    cat.listCategories.mockResolvedValue([]);

    await useWorkspace.getState().loadWorkspaces();
    await events.fireCreated({ id: 200 });

    expect(store['windowWorkspaceBinding.200']).toBe('wCur');
  });

  it('onRemoved：窗口关闭 → 清该窗 binding', async () => {
    const { store } = installChromeStorageLocal({
      initial: { 'windowWorkspaceBinding.100': 'wCur' },
    });
    const events = withWindowEvents(100);
    ws.listWorkspaces.mockResolvedValue([wsOf('wCur')]);
    cat.listCategories.mockResolvedValue([]);

    await useWorkspace.getState().loadWorkspaces();
    await events.fireRemoved(100);

    expect(store['windowWorkspaceBinding.100']).toBeUndefined();
  });
});
