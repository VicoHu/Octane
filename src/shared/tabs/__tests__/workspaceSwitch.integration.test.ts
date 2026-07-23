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
      move: async (ids: number[], props: { index: number }) => {
        const entries = Array.from(tabsStore.entries());
        const idSet = new Set(ids);
        const moving = entries.filter(([id]) => idSet.has(id));
        const rest = entries.filter(([id]) => !idSet.has(id));
        const pos = Math.min(Math.max(props.index, 0), rest.length);
        const reordered = [...rest.slice(0, pos), ...moving, ...rest.slice(pos)];
        tabsStore.clear();
        for (const [id, tab] of reordered) tabsStore.set(id, tab);
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
const WS_C = 'cccccccc-0000-0000-0000-000000000000';

/** 读取某 ws 的 TabSession tabs（断言用）。 */
function sessionUrls(c: any, wsId: string): string[] {
  const s = c.__testStorage[`tabSession.${wsId}`] as { tabs: { url: string }[] } | undefined;
  return s?.tabs.map((t) => t.url) ?? [];
}

describe('T10 集成 v1.1 — hide 模式承重用例', () => {
  beforeEach(() => installHideIntegrationStub());

  // 用例 1：hide 往返（核心隔离正确性 + 问题1 组名）
  it('hide 往返：A→B 收 A 组（建组 title 含名）→ B→A 解散 A 组（tab 释放散开）', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    // 新模型：当前 ws-a 切回态（tab 1 散）+ ws-b 切走态（组 20 折叠，tab 2 在组）
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: -1, index: 0 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 20, index: 0 });

    // A→B（hide）：dispose 收 A 散 tab 建组折叠（title 含 ws 名 A）+ restore B 解散组 20
    const r1 = await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide', { fromName: 'A' });
    expect(r1.fromId).toBe(WS_A);
    // 问题1：新建 A 组 title 含工作区名（非空名 ·aaaaaaaa）
    const aGroup: any = Array.from(c.__testGroups.values()).find((g: any) => g.title === 'A ·aaaaaaaa');
    expect(aGroup).toBeDefined();
    expect(aGroup.collapsed).toBe(true); // A 组折叠
    // B tab 散开（restore B ungroup 组 20）
    expect(c.__testTabs.get(2).groupId).toBe(-1);
    // tab 未关（hide 保留 tab，区别于 close 的 remove）
    expect(c.__testTabs.has(1)).toBe(true);
    expect(c.__testTabs.has(2)).toBe(true);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_B);

    // B→A（hide）：dispose 收 B 散 tab 建组折叠 + restore A 解散 A 组（tab 释放散开）
    const r2 = await requestWorkspaceSwitch(WS_A, 'A', 1, 'hide', { fromName: 'B' });
    expect(r2.fromId).toBe(WS_B);
    // A tab 散开（切回 A 解散，新模型核心）
    expect(c.__testTabs.get(1).groupId).toBe(-1);
    // tab 全程未关
    expect(c.__testTabs.has(1)).toBe(true);
    expect(c.__testTabs.has(2)).toBe(true);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);
  });

  // 用例 2：重启标识失效 → 兜底 restore 重开（tab 散开，新模型不建组）
  it('重启标识失效：A 组消失 → 切回 A 走兜底 restore 重开（tab 散开，不建组）', async () => {
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
    // 当前 ws-b 切回态（tab 2 散）；ws-a 组重启后消失（无组）
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: -1, index: 0 });

    // B→A（hide）：restore ws-a 时 findGroupByIdentity 找不到 → 兜底 restore 重开（散开）
    const r = await requestWorkspaceSwitch(WS_A, 'A', 1, 'hide', { fromName: 'B' });
    expect(r.fromId).toBe(WS_B);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);

    // 兜底 restore：从 TabSession.ws-a 重开 2 个 tab，散开（groupId=-1，新模型不建组）
    const opened = Array.from(c.__testTabs.values()).filter(
      (t: any) => t.url === 'https://a1.com' || t.url === 'https://a2.com',
    );
    expect(opened.length).toBe(2);
    expect(opened.every((t: any) => t.groupId === -1)).toBe(true);
    // 新模型：不新建 A 标识组
    expect(Array.from(c.__testGroups.values()).some((g: any) => g.title === 'A ·aaaaaaaa')).toBe(false);
  });

  // 用例 3：用户改 title 删标识 → 兜底 restore 重开（tab 散开，不建组）
  it('改 title 删标识：A 组 title 删 ·hash → 切回 A 兜底 restore 重开（散开，不建组）', async () => {
    const c = installHideIntegrationStub({
      'windowWorkspaceBinding.1': WS_B,
      [`tabSession.${WS_A}`]: { tabs: [{ url: 'https://a.com', pinned: false, order: 0 }], savedAt: 1 },
    });
    // 当前 ws-b 切回态（tab 2 散）
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: -1, index: 0 });
    // A 组存在但 title 被用户改了（删 ` ·aaaaaaaa` 后缀）→ findGroupByIdentity 回找不到
    c.__testGroups.set(10, { id: 10, windowId: 1, title: '我的工作', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a-old.com', groupId: 10, index: 0 });

    // B→A（hide）：findGroupByIdentity(ws-a) 找不到 title 匹配 → 兜底 restore 重开（散开）
    await requestWorkspaceSwitch(WS_A, 'A', 1, 'hide', { fromName: 'B' });

    // 兜底 restore 重开 a.com（散开 groupId=-1），不建新标识组（区别于用户改的「我的工作」旧组）
    const reopened: any = Array.from(c.__testTabs.values()).find((t: any) => t.url === 'https://a.com');
    expect(reopened).toBeDefined();
    expect(reopened.groupId).toBe(-1);
    expect(Array.from(c.__testGroups.values()).some((g: any) => g.title === 'A ·aaaaaaaa')).toBe(false);
  });

  // 用例 4：undo 总是反向（组临时无 generation 校验）
  it('undo 总是反向：A→B(hide) → 删 B 组 → undo 仍切回 A（不 Toast 拒绝）', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    // 当前 ws-a 切回态（tab 1 散）+ ws-b 切走态（组 20 折叠，tab 2 在组）
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: -1, index: 0 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 20, index: 0 });

    const { Toast } = await import('@/components/ui/toast');
    const errorSpy = vi.spyOn(Toast, 'error').mockImplementation(() => '' as never);

    const r = await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide', { fromName: 'A' });
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_B);
    errorSpy.mockClear();

    // 人为删目标 ws-b 的切走态组（新模型组临时，undo 不校验组结构）
    c.__testGroups.delete(20);
    await r.undo();

    // 新模型：undo 总是反向切换 → binding 回源 ws-a，不 Toast「工作区已变化」
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);
    expect(errorSpy).not.toHaveBeenCalledWith('工作区已变化，无法撤销，可手动切回');
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

  // 用例 8：discard 档切回 — A→B(hide-discard) discard → B→A 解散（tab 散开保留）
  it('discard 档切回：A→B(hide-discard) discard A 组 tab → B→A 解散（tab 散开保留）', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    // 当前 ws-a 切回态（tab 1 散）+ ws-b 切走态（组 20 折叠，tab 2 在组）
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: -1, index: 0 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 20, index: 0 });

    // A→B（hide-discard）：dispose 收 A 散 tab 建组折叠 + discard + restore B 解散组 20
    const r1 = await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide-discard', { fromName: 'A' });
    expect(r1.fromId).toBe(WS_A);
    // A tab 被 discard（丢内存保留占位）+ 入新建折叠组
    expect(c.__testTabs.get(1).discarded).toBe(true);
    expect(c.__testTabs.get(1).groupId).not.toBe(-1);
    // B tab 散开（restore B ungroup 组 20）
    expect(c.__testTabs.get(2).groupId).toBe(-1);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_B);

    // B→A（hide-discard）：dispose 收 B 散 tab 建组折叠 + discard + restore A 解散（tab 散开）
    const r2 = await requestWorkspaceSwitch(WS_A, 'A', 1, 'hide-discard', { fromName: 'B' });
    expect(r2.fromId).toBe(WS_B);
    // A tab 散开（切回 A 解散，新模型核心）
    expect(c.__testTabs.get(1).groupId).toBe(-1);
    // tab 未关（discard ≠ remove）
    expect(c.__testTabs.has(1)).toBe(true);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);
  });

  // 用例 9：hide 往返 pinned — dispose remove 后 restore 重建（切回解散 a.com 散开）
  // 回归 b75591e review Fix#1：restoreByMode hide 命中组路径曾遗漏重建 pinned。
  it('hide 往返 pinned：A→B remove P → B→A 解散 a.com（散开）+ 重建 pinned P（不丢失）', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    // 当前 ws-a 切回态：pinned P 散 + a.com 散；ws-b 切走态：组 20 折叠（b.com）
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://mail.com', groupId: -1, pinned: true, index: 0 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://a.com', groupId: -1, index: 1 });
    c.__testTabs.set(3, { id: 3, windowId: 1, url: 'https://b.com', groupId: 20, index: 0 });

    // A→B（hide）：archive（P + a.com）+ dispose remove P（C4b pinned 禁入组）+ 收 a.com 建组折叠
    await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide', { fromName: 'A' });
    // pinned P 被 remove（dispose remove pinned，不折叠）
    expect(Array.from(c.__testTabs.values()).some((t: any) => t.url === 'https://mail.com')).toBe(false);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_B);

    // B→A（hide）：findGroupByIdentity 命中 A 组 → ungroup a.com（散开）+ 重建 pinned P
    await requestWorkspaceSwitch(WS_A, 'A', 1, 'hide', { fromName: 'B' });
    // pinned P 重建（切回后存在 + pinned:true，不丢失）
    const pinnedP: any = Array.from(c.__testTabs.values()).find((t: any) => t.url === 'https://mail.com');
    expect(pinnedP).toBeDefined();
    expect(pinnedP.pinned).toBe(true);
    // a.com 散开（切回 A 解散，新模型核心）
    const aTab: any = Array.from(c.__testTabs.values()).find((t: any) => t.url === 'https://a.com');
    expect(aTab.groupId).toBe(-1);
    expect(c.__testStorage['windowWorkspaceBinding.1']).toBe(WS_A);
  });

  // 用例 10：undo 不泄漏正向 onProgress（QA bug4：避 switching state 卡死）
  it('undo 不触发正向切换的 onProgress（防 buildUndo 复用正向 onProgress 重设 switching 致按钮卡 disabled）', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_A });
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: -1, index: 0 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 20, index: 0 });

    let progCount = 0;
    const onProgress = () => { progCount++; };
    const r = await requestWorkspaceSwitch(WS_B, 'B', 1, 'hide', { fromName: 'A', onProgress });
    const switchCount = progCount;
    expect(switchCount).toBeGreaterThan(0); // 正向切换发了进度事件

    await r.undo();

    // undo 不触发正向 onProgress（防 switching state 泄漏卡死）
    expect(progCount).toBe(switchCount);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// hide 排序修复 — 真机 QA bug：切回当前工作区时，其他工作区折叠组排到了
// 当前普通 tab 之后（应紧跟 pinned，当前 tab 最右）。
// 根因：restoreByMode 解散目标组（ungroup）后 tab 停在历史位置（靠前），
// 未移到折叠组之后；兜底 restore 按 index:t.order 插入也可能插到折叠组前面。
// 修复：解散/重开后把当前 ws 普通 tab 移到窗口末尾（所有折叠组之后）。
// ──────────────────────────────────────────────────────────────────────────
describe('hide 排序修复 — 切回当前 ws 普通 tab 移到所有折叠组之后', () => {
  beforeEach(() => installHideIntegrationStub());

  it('切回 A（命中组）：A 普通 tab 解散后移到 B/C 折叠组之后（当前 tab 最右）', async () => {
    const c = installHideIntegrationStub({ 'windowWorkspaceBinding.1': WS_C });
    // 稳定态：A/B 折叠组在前（紧跟 pinned 区），C 当前活动散 tab 在后。
    // Map 顺序 = tab 物理位置：[aTab(A组), bTab(B组), cTab(散)]
    c.__testGroups.set(10, { id: 10, windowId: 1, title: 'A ·aaaaaaaa', color: 'grey', collapsed: true });
    c.__testGroups.set(20, { id: 20, windowId: 1, title: 'B ·bbbbbbbb', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: 10 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 20 });
    c.__testTabs.set(3, { id: 3, windowId: 1, url: 'https://c.com', groupId: -1 });

    // C→A（hide）：dispose 收 C 散 tab 建组 + restore A 解散 A 组
    await requestWorkspaceSwitch(WS_A, 'A', 1, 'hide', { fromName: 'C' });

    // 修复后顺序：[b(B组), c(C组), a(A当前散)] —— A 当前 tab 移到所有折叠组之后
    const order = (await c.tabs.query({ windowId: 1 })).map((t: any) => t.url);
    expect(order).toEqual(['https://b.com', 'https://c.com', 'https://a.com']);
  });
});
