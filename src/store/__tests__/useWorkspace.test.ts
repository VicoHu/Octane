import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';

// mock WorkspaceService / CategoryService
const ws = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
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
  ws.updateWorkspace.mockReset();
  ws.deleteWorkspace.mockReset();
  ws.reorderWorkspaces.mockReset();
  cat.listCategories.mockReset();
  cat.updateCategory.mockReset();
  cat.deleteCategory.mockReset();
  cat.reorderCategories.mockReset();
});

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
