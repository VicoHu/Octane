import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestWorkspaceSwitch } from '../workspaceSwitch';

type QueryInfo = { currentWindow?: boolean; windowId?: number; url?: string };

/**
 * 合并 tabs + storage.local 的可控 chrome mock（覆盖 globalThis.chrome）。
 * storage.local 为 in-memory（binding/tabSession 真实往返），tabs 为 vi.fn。
 * T7 集成测试用：端到端验证 requestWorkspaceSwitch 完整往返 + 承重。
 */
function mockChromeWithStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  let nextId = 100;
  const c = {
    runtime: {
      getURL: (p: string) => `chrome-extension://octane/${p.replace(/^\//, '')}`,
    },
    tabs: {
      query: vi.fn(async (_info: QueryInfo) => [] as unknown[]),
      create: vi.fn(
        async (_props: {
          url: string;
          pinned?: boolean;
          windowId?: number;
          index?: number;
          active?: boolean;
        }) => ({ id: ++nextId }),
      ),
      remove: vi.fn(async (_id: number) => undefined),
      update: vi.fn(async (_id: number, _props: { active?: boolean }) => undefined),
    },
    windows: { getCurrent: vi.fn(async () => ({ id: 100 })) },
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (data: Record<string, unknown>) => {
          Object.assign(store, data);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete store[k];
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = c;
  return { c, store };
}

function sessionTabs(store: Record<string, unknown>, wsId: string): { url: string }[] {
  return (store[`tabSession.${wsId}`] as { tabs: { url: string }[] }).tabs;
}

describe('T7 集成 — fake-browser 完整往返 + 承重', () => {
  beforeEach(() => mockChromeWithStorage());

  it('A→B→A 往返：tab 归档/恢复/binding 端到端一致', async () => {
    const { c, store } = mockChromeWithStorage({
      'windowWorkspaceBinding.100': 'ws-a',
      'tabSession.ws-a': { tabs: [{ url: 'https://a.com', pinned: false, order: 0 }], savedAt: 1 },
      'tabSession.ws-b': { tabs: [{ url: 'https://b.com', pinned: false, order: 0 }], savedAt: 1 },
    });

    // A→B：窗内当前 a.com（ws-a 的 tab）
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 10, windowId: 100, url: 'https://a.com', pinned: false, index: 0 },
    ] as never);
    await requestWorkspaceSwitch('ws-b', 'B', 100, 'close');

    // archive：a.com 存入 ws-a session
    expect(sessionTabs(store, 'ws-a').some((t) => t.url === 'https://a.com')).toBe(true);
    // dispose：关 content tab 10
    expect(c.tabs.remove).toHaveBeenCalledWith(10);
    // restore：开 b.com，active:false 防抢焦点闪烁
    expect(c.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://b.com', active: false }));
    // binding：ws-b
    expect(store['windowWorkspaceBinding.100']).toBe('ws-b');

    // B→A：窗内当前 b.com
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 20, windowId: 100, url: 'https://b.com', pinned: false, index: 0 },
    ] as never);
    vi.mocked(c.tabs.create).mockClear();
    await requestWorkspaceSwitch('ws-a', 'A', 100, 'close');

    // archive：b.com 存入 ws-b
    expect(sessionTabs(store, 'ws-b').some((t) => t.url === 'https://b.com')).toBe(true);
    // restore：开 a.com（ws-a session，往返恢复）
    expect(c.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://a.com' }));
    // binding 回到 ws-a
    expect(store['windowWorkspaceBinding.100']).toBe('ws-a');
  });

  it('部分 remove 失败：切换仍完成（部分失败不阻断 dispose 循环）', async () => {
    const { c, store } = mockChromeWithStorage({
      'windowWorkspaceBinding.100': 'ws-a',
    });
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 10, windowId: 100, url: 'https://a1.com', index: 0 },
      { id: 11, windowId: 100, url: 'https://a2.com', index: 1 },
    ] as never);
    // 第一个 remove 失败（部分失败），第二个成功
    vi.mocked(c.tabs.remove).mockRejectedValueOnce(new Error('remove 10 失败'));

    await requestWorkspaceSwitch('ws-b', 'B', 100, 'close');

    // remove 调 2 次（部分失败不中断 dispose 循环）
    expect(c.tabs.remove).toHaveBeenCalledTimes(2);
    // binding 仍更新（切换完成，部分失败不阻断）
    expect(store['windowWorkspaceBinding.100']).toBe('ws-b');
  });

  it('A→B→C 同窗快速串行：最终 binding=C，请求不交错（per-window 串行队列）', async () => {
    const { c, store } = mockChromeWithStorage({
      'windowWorkspaceBinding.100': 'ws-a',
      'tabSession.ws-b': { tabs: [{ url: 'https://b.com', pinned: false, order: 0 }], savedAt: 1 },
      'tabSession.ws-c': { tabs: [{ url: 'https://c.com', pinned: false, order: 0 }], savedAt: 1 },
    });
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 10, windowId: 100, url: 'https://cur.com', index: 0 },
    ] as never);

    // 同窗快速连切 A→B、A→C（应串行，不交错 archive/dispose）
    await Promise.all([requestWorkspaceSwitch('ws-b', 'B', 100, 'close'), requestWorkspaceSwitch('ws-c', 'C', 100, 'close')]);

    // 最终 binding 为最后一次（C）；archive query 共 2 次（两次各自 archive，未互相吞掉）
    expect(store['windowWorkspaceBinding.100']).toBe('ws-c');
    expect(c.tabs.query).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T10 集成 v1.1 — hide 模式承重用例
// 端到端覆盖：hide 往返 / 标识失效兜底 / undo generation / 硬屏障 / 失败不更新 binding /
// 跨档 hide→close→hide / discard 档切回。
// 用 Map 驱动的 chrome stub（tabs/groups/storage 全真实往返），断言 tab/group/binding/session 最终态。
// ──────────────────────────────────────────────────────────────────────────

/**
 * Map 驱动 chrome stub（hide 模式集成用）：tabs/groups/storage.local 全真实状态机，
 * 支持折叠/展开/group/discard/remove 往返。暴露 __testTabs/__testGroups/__testStorage 供断言。
 * wsId 约定：`aaaaaaaa-*` → wsHash `aaaaaaaa`；`bbbbbbbb-*` → `bbbbbbbb`。
 */
function installHideIntegrationStub(initial: Record<string, unknown> = {}) {
  const groups = new Map<number, any>();
  const tabsStore = new Map<number, any>();
  const storageStore: Record<string, unknown> = { ...initial };
  let nextGroupId = 100;
  let nextTabId = 1000;
  const c: any = {
    runtime: { getURL: (p: string) => `chrome-extension://octane/${p.replace(/^\//, '')}` },
    tabs: {
      query: async (info: { windowId?: number } = {}) =>
        Array.from(tabsStore.values()).filter(
          (t) => info.windowId == null || t.windowId === info.windowId,
        ),
      create: async (props: any) => {
        const id = nextTabId++;
        const tab = { id, groupId: -1, active: false, ...props };
        tabsStore.set(id, tab);
        return { ...tab };
      },
      remove: async (id: number) => { tabsStore.delete(id); },
      update: async (id: number, props: any) => {
        const tab = tabsStore.get(id);
        if (!tab) throw new Error(`Tab ${id} not found`);
        Object.assign(tab, props);
        return { ...tab };
      },
      discard: async (id: number) => {
        const tab = tabsStore.get(id);
        if (!tab) throw new Error(`Tab ${id} not found`);
        if (tab.active) throw new Error('Cannot discard active tab');
        tab.discarded = true;
        return { ...tab };
      },
      group: async (opts: any) => {
        let gid = opts.groupId;
        if (gid == null) {
          gid = nextGroupId++;
          groups.set(gid, {
            id: gid, windowId: opts.createProperties?.windowId ?? -1,
            title: '', color: 'grey', collapsed: false,
          });
        }
        for (const tid of opts.tabIds) {
          const tab = tabsStore.get(tid);
          if (tab) tab.groupId = gid;
        }
        return gid;
      },
      ungroup: async (tabIds: number[]) => {
        for (const tid of tabIds) {
          const tab = tabsStore.get(tid);
          if (tab) tab.groupId = -1;
        }
      },
    },
    tabGroups: {
      get: async (gid: number) => {
        const g = groups.get(gid);
        if (!g) throw new Error(`Group ${gid} not found`);
        return { ...g };
      },
      query: async (info: { windowId?: number } = {}) =>
        Array.from(groups.values()).filter(
          (g) => info.windowId == null || g.windowId === info.windowId,
        ),
      update: async (gid: number, props: any) => {
        const g = groups.get(gid);
        if (!g) throw new Error(`Group ${gid} not found`);
        Object.assign(g, props);
        return { ...g };
      },
    },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in storageStore) out[k] = storageStore[k];
          return out;
        },
        set: async (data: Record<string, unknown>) => { Object.assign(storageStore, data); },
        remove: async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete storageStore[k];
        },
      },
    },
    __testTabs: tabsStore,
    __testGroups: groups,
    __testStorage: storageStore,
  };
  (globalThis as unknown as { chrome: unknown }).chrome = c;
  return c;
}

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const WS_B = 'bbbbbbbb-0000-0000-0000-000000000000';

/** 读取某 ws 的 TabSession tabs（断言用）。 */
function sessionUrls(c: any, wsId: string): string[] {
  const s = c.__testStorage[`tabSession.${wsId}`] as { tabs: { url: string }[] } | undefined;
  return s?.tabs.map((t) => t.url) ?? [];
}

describe('T10 集成 v1.1 — hide 模式承重用例', () => {
  beforeEach(() => installHideIntegrationStub());

  // 用例 1：hide 往返（核心隔离正确性）
  it('hide 往返：A→B 折叠 A 组 → B→A 展开 A 组（tab 不关，count 不变）', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    // ws-a 组（gid 10，含 a.com）+ ws-b 组（gid 20，含 b.com）
    c.__testGroups.set(10, { id: 10, windowId: 1, title: 'A ·aaaaaaaa', color: 'grey', collapsed: false });
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: 10, index: 0 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 20, index: 0 });

    // A→B（hide）：折叠 A 组 + 展开 B 组
    const r1 = await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide');
    expect(r1.fromId).toBe(WS_A);
    expect(c.__testGroups.get(10).collapsed).toBe(true); // A 组折叠
    expect(c.__testGroups.get(20).collapsed).toBe(false); // B 组展开
    // tab 未关（hide 保留 tab，区别于 close 的 remove）
    expect(c.__testTabs.has(1)).toBe(true);
    expect(c.__testTabs.has(2)).toBe(true);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_B);

    // B→A（hide）：折叠 B 组 + 展开 A 组
    const r2 = await requestWorkspaceSwitch(WS_A, 'A', 1, 'hide');
    expect(r2.fromId).toBe(WS_B);
    expect(c.__testGroups.get(10).collapsed).toBe(false); // A 组展开（切回）
    expect(c.__testGroups.get(20).collapsed).toBe(true); // B 组折叠
    // tab 全程未关
    expect(c.__testTabs.has(1)).toBe(true);
    expect(c.__testTabs.has(2)).toBe(true);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);
  });

  // 用例 2：重启标识失效 → 兜底 restore 重开（TabSession.A）
  it('重启标识失效：A 组消失 → 切回 A 走兜底 restore 重开（TabSession.A）', async () => {
    const c = installHideIntegrationStub({
      'windowWorkspaceBinding.1': WS_B,
      [`tabSession.${WS_A}`]: {
        tabs: [
          { url: 'https://a1.com', pinned: false, order: 0 },
          { url: 'https://a2.com', pinned: false, order: 1 },
        ],
        savedAt: 1,
      },
    });
    // 仅 ws-b 组存在（ws-a 组重启后消失）
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: false });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 20, index: 0 });

    // B→A（hide）：restore ws-a 时 findGroupByIdentity 找不到 → 兜底 restore 重开
    const r = await requestWorkspaceSwitch(WS_A, 'A', 1, 'hide');
    expect(r.fromId).toBe(WS_B);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);

    // 兜底 restore：从 TabSession.ws-a 重开 2 个 tab
    const opened = Array.from(c.__testTabs.values()).filter((t: any) => t.url?.startsWith('https://a'));
    expect(opened.length).toBe(2);
    // 新建标识组（title 含 ` ·aaaaaaaa`，collapsed=false）
    const newGroup: any = Array.from(c.__testGroups.values()).find(
      (g: any) => g.title === 'A ·aaaaaaaa',
    );
    expect(newGroup).toBeTruthy();
    expect(newGroup.collapsed).toBe(false);
  });

  // 用例 3：用户改 title 删标识 → 兜底 restore 重建
  it('改 title 删标识：A 组 title 删 ·hash → 切回 A 兜底 restore 重建', async () => {
    const c = installHideIntegrationStub({
      'windowWorkspaceBinding.1': WS_B,
      [`tabSession.${WS_A}`]: { tabs: [{ url: 'https://a.com', pinned: false, order: 0 }], savedAt: 1 },
    });
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: false });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 20, index: 0 });
    // A 组存在但 title 被用户改了（删 ` ·aaaaaaaa` 后缀）→ findGroupByIdentity 回找不到
    c.__testGroups.set(10, { id: 10, windowId: 1, title: '我的工作', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a-old.com', groupId: 10, index: 0 });

    // B→A（hide）：findGroupByIdentity(ws-a) 找不到 title 匹配 → 兜底 restore 重建
    await requestWorkspaceSwitch(WS_A, 'A', 1, 'hide');

    // 新建标识组（title=`A ·aaaaaaaa`，区别于用户改的「我的工作」）
    const newGroup: any = Array.from(c.__testGroups.values()).find(
      (g: any) => g.title === 'A ·aaaaaaaa',
    );
    expect(newGroup).toBeTruthy();
    // 从 TabSession 重开 a.com（非组里的旧 a-old.com）
    expect(Array.from(c.__testTabs.values()).some((t: any) => t.url === 'https://a.com')).toBe(true);
  });

  // 用例 4：undo generation — 组结构变化拒绝 undo
  it('undo generation：A→B(hide) → 删 B 组 → undo 拒绝（binding 不回滚）', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    c.__testGroups.set(10, { id: 10, windowId: 1, title: 'A ·aaaaaaaa', color: 'grey', collapsed: false });
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: 10, index: 0 });

    const { Toast } = await import('@/components/ui/toast');
    const errorSpy = vi.spyOn(Toast, 'error').mockImplementation(() => '' as never);

    const r = await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide');
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_B);
    errorSpy.mockClear();

    // 组结构变化：删目标组 20（findGroupByIdentity 回找不到 → gid=null !== targetGroupId=20）
    c.__testGroups.delete(20);
    await r.undo();

    // undo 拒绝：binding 未回滚 + Toast 提示 + 源组未被展开
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_B);
    expect(errorSpy).toHaveBeenCalledWith('工作区已变化，无法撤销，可手动切回');
    expect(c.__testGroups.get(10).collapsed).toBe(true);
    errorSpy.mockRestore();
  });

  // 用例 5：硬屏障 hide — archive 失败不折叠/discard + binding 不动
  it('硬屏障 hide：archive 失败（query throw）→ 不折叠/discard + binding 不动', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    c.__testGroups.set(10, { id: 10, windowId: 1, title: 'A ·aaaaaaaa', color: 'grey', collapsed: false });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: 10, index: 0 });

    const { Toast } = await import('@/components/ui/toast');
    const errorSpy = vi.spyOn(Toast, 'error').mockImplementation(() => '' as never);

    // archive 失败：tabs.query 抛错 → archiveByMode 返回 null（硬屏障）
    const origQuery = c.tabs.query;
    c.tabs.query = async () => { throw new Error('boom'); };
    const r = await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide');
    c.tabs.query = origQuery;

    // 未成功切换：fromId=null + binding 不动 + 组未折叠
    expect(r.fromId).toBeNull();
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);
    expect(c.__testGroups.get(10).collapsed).toBe(false);
    // tab 未被 discard（archive 失败绝不再向下走）
    expect(c.__testTabs.get(1).discarded).toBeUndefined();
    errorSpy.mockRestore();
  });

  // 用例 6：失败不更新 binding — dispose 失败停留源 ws
  it('失败不更新 binding：dispose 失败（collapse throw）→ binding 不动', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    c.__testGroups.set(10, { id: 10, windowId: 1, title: 'A ·aaaaaaaa', color: 'grey', collapsed: false });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: 10, index: 0 });

    const { Toast } = await import('@/components/ui/toast');
    const errorSpy = vi.spyOn(Toast, 'error').mockImplementation(() => '' as never);

    // dispose 关键失败：tabGroups.update 抛错 → collapse 失败 → ok=false
    const origUpdate = c.tabGroups.update;
    c.tabGroups.update = async () => { throw new Error('boom'); };
    const r = await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide');
    c.tabGroups.update = origUpdate;

    // 未成功切换：fromId=null + binding 不动（停留源 ws-a）
    expect(r.fromId).toBeNull();
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);
    expect(errorSpy).toHaveBeenCalledWith('切换中止：无法收起当前标签，已保留');
    errorSpy.mockRestore();
  });

  // 用例 7：跨档 hide→close→hide 往返 — TabSession 无交叉污染
  it('跨档 hide→close→hide 往返：ws-a 的 session 不含 ws-b 的 tab（hide archive 按 groupId 过滤）', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    c.__testGroups.set(10, { id: 10, windowId: 1, title: 'A ·aaaaaaaa', color: 'grey', collapsed: false });
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: 10, index: 0 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 20, index: 0 });

    // A→B（hide）：archive ws-a 只收当前 ws 组（gid 10）+ 散 tab，不取别 ws 组（gid 20）
    await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide');
    // 核心断言：TabSession.ws-a 只含 a.com，不含 b.com（别 ws 组不污染）
    expect(sessionUrls(c, WS_A)).toEqual(['https://a.com']);
    expect(sessionUrls(c, WS_A)).not.toContain('https://b.com');
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_B);

    // B→A（close）：v1 行为回归（全窗 archive + remove + restore）
    await requestWorkspaceSwitch(WS_A, 'A', 1, 'close');
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);

    // A→B（hide）：再次切 B，hide 编排仍正常（group 命中→展开；无残留副作用）
    await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide');
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_B);
  });

  // 用例 8：discard 档切回 — A→B(hide-discard) discard → B→A 展开
  it('discard 档切回：A→B(hide-discard) discard A 组 tab → B→A 展开（tab 保留，重载语义）', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    c.__testGroups.set(10, { id: 10, windowId: 1, title: 'A ·aaaaaaaa', color: 'grey', collapsed: false });
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: 10, index: 0 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 20, index: 0 });

    // A→B（hide-discard）：折叠 A 组 + discard A 组 tab
    const r1 = await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide-discard');
    expect(r1.fromId).toBe(WS_A);
    expect(c.__testGroups.get(10).collapsed).toBe(true);
    expect(c.__testGroups.get(20).collapsed).toBe(false);
    // A 组 tab 被 discard（丢内存保留占位）
    expect(c.__testTabs.get(1).discarded).toBe(true);
    // tab 未关（discard ≠ remove）
    expect(c.__testTabs.has(1)).toBe(true);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_B);

    // B→A（hide-discard）：折叠 B 组 + discard B 组 tab + 展开 A 组
    const r2 = await requestWorkspaceSwitch(WS_A, 'A', 1, 'hide-discard');
    expect(r2.fromId).toBe(WS_B);
    expect(c.__testGroups.get(10).collapsed).toBe(false); // A 组切回展开
    expect(c.__testGroups.get(20).collapsed).toBe(true);
    // B 组 tab 被 discard
    expect(c.__testTabs.get(2).discarded).toBe(true);
    // A 组 tab 仍存在（Chrome 语义：展开时 discarded tab 重载，stub 不模拟重载但 tab 保留）
    expect(c.__testTabs.has(1)).toBe(true);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);
  });
});
