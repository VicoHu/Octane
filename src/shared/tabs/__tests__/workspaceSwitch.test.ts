import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  requestWorkspaceSwitch,
  switchWorkspaceBySetting,
  countRestorableTabsInWindow,
  archiveByMode,
  disposeByMode,
  restoreByMode,
  type SwitchProgress,
} from '../workspaceSwitch';

type QueryInfo = { currentWindow?: boolean; windowId?: number; url?: string };

/**
 * 合并 tabs + storage.local 的可控 chrome mock（覆盖 globalThis.chrome）。
 * storage.local 为 in-memory（binding/tabSession 真实往返），tabs 为 vi.fn。
 */
function mockChromeWithStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const c = {
    runtime: {
      getURL: (p: string) => `chrome-extension://octane/${p.replace(/^\//, '')}`,
    },
    tabs: {
      query: vi.fn(async (_info: QueryInfo) => [] as unknown[]),
      create: vi.fn(async (_props: { url: string; pinned?: boolean; windowId?: number; index?: number; active?: boolean }) => undefined),
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

const HOME_URL = 'chrome-extension://octane/home.html';

// requestWorkspaceSwitch 是整个功能的安全锚：archive 失败绝不关 tab（防丢数据）。
// 设计 Assignment：「archive 失败时 chrome.tabs.remove 不被调用——必须先红后绿」。

describe('requestWorkspaceSwitch — archive 硬屏障（安全锚）', () => {
  beforeEach(() => mockChromeWithStorage({ 'windowWorkspaceBinding.100': 'ws-a' }));

  it('archive 失败（tabs.query 抛错）→ 不调 chrome.tabs.remove（绝不无归档关闭 tab）', async () => {
    const { c } = mockChromeWithStorage({ 'windowWorkspaceBinding.100': 'ws-a' });
    vi.mocked(c.tabs.query).mockRejectedValue(new Error('query failed'));

    await requestWorkspaceSwitch('ws-b', 100);

    expect(c.tabs.remove).not.toHaveBeenCalled();
  });
});

describe('requestWorkspaceSwitch — 正常切换编排', () => {
  it('archive 当前 tab → dispose 关闭 content tab(保 home) → restore 目标 → 更新 binding', async () => {
    const { c, store } = mockChromeWithStorage({
      'windowWorkspaceBinding.100': 'ws-a',
      'tabSession.ws-b': { tabs: [{ url: 'https://b.com', order: 0 }], savedAt: 1 },
    });
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 10, windowId: 100, url: 'https://a.com', pinned: false, index: 0 },
      { id: 11, windowId: 100, url: HOME_URL, pinned: true, index: 1 }, // home tab，全程排除
    ] as never);

    await requestWorkspaceSwitch('ws-b', 100);

    // archive：ws-a session 保存 a.com（home 排除，order 取 index）
    const archived = store['tabSession.ws-a'] as { tabs: { url: string; pinned?: boolean; order: number }[] };
    expect(archived.tabs).toEqual([{ url: 'https://a.com', pinned: false, order: 0 }]);
    // dispose：仅 remove content tab 10（home 11 保留）
    expect(c.tabs.remove).toHaveBeenCalledWith(10);
    expect(c.tabs.remove).not.toHaveBeenCalledWith(11);
    // restore：create 目标 tab，active:false 防抢焦点
    expect(c.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://b.com', active: false, windowId: 100 }),
    );
    // binding 更新到目标
    expect(store['windowWorkspaceBinding.100']).toBe('ws-b');
  });
});

describe('requestWorkspaceSwitch — per-window 串行队列（rev4 #2：防并发覆盖）', () => {
  it('同窗并发：第二个请求的 archive 等第一个完成才执行', async () => {
    const { c } = mockChromeWithStorage({ 'windowWorkspaceBinding.100': 'ws-a' });
    let resolveFirst!: (tabs: unknown[]) => void;
    let queryCalls = 0;
    vi.mocked(c.tabs.query).mockImplementation(() => {
      queryCalls++;
      if (queryCalls === 1) {
        return new Promise((r) => { resolveFirst = r; });
      }
      return Promise.resolve([{ id: 2, windowId: 100, url: 'https://x.com', index: 0 }]);
    });

    const p1 = requestWorkspaceSwitch('ws-b', 100);
    await vi.waitFor(() => expect(c.tabs.query).toHaveBeenCalledTimes(1)); // p1 进入 archive

    const p2 = requestWorkspaceSwitch('ws-a', 100);
    await new Promise((r) => setTimeout(r, 0)); // 让 microtask 推进
    // p2 排队：archive 仍只调用 1 次（未与 p1 交错）
    expect(c.tabs.query).toHaveBeenCalledTimes(1);

    resolveFirst([{ id: 1, windowId: 100, url: 'https://a.com', index: 0 }] as never);
    await Promise.all([p1, p2]);
    // p1 完成后 p2 才执行 archive（共 2 次）
    expect(c.tabs.query).toHaveBeenCalledTimes(2);
  });

  it('不同窗口并发：互不阻塞（各自独立 inflight）', async () => {
    const { c } = mockChromeWithStorage({
      'windowWorkspaceBinding.100': 'ws-a',
      'windowWorkspaceBinding.200': 'ws-a',
    });
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 1, windowId: 100, url: 'https://a.com', index: 0 },
    ] as never);

    // 窗 100 和窗 200 并发，应同时进入（不等彼此）
    await Promise.all([
      requestWorkspaceSwitch('ws-b', 100),
      requestWorkspaceSwitch('ws-b', 200),
    ]);

    // 两窗各 archive 一次（query 共 2 次，证明未互相阻塞）
    expect(c.tabs.query).toHaveBeenCalledTimes(2);
  });
});

describe('requestWorkspaceSwitch — 进度事件（T8 消费：archive/dispose/restore/done）', () => {
  it('onProgress：archive 起 / restore 逐 tab 计数 / done 收尾', async () => {
    const { c } = mockChromeWithStorage({
      'windowWorkspaceBinding.100': 'ws-a',
      'tabSession.ws-b': {
        tabs: [
          { url: 'https://b.com', order: 0 },
          { url: 'https://c.com', order: 1 },
        ],
        savedAt: 1,
      },
    });
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 10, windowId: 100, url: 'https://a.com', index: 0 },
    ] as never);

    const events: SwitchProgress[] = [];
    await requestWorkspaceSwitch('ws-b', 100, { onProgress: (p) => events.push({ ...p }) });

    const phases = events.map((e) => e.phase);
    expect(phases[0]).toBe('archive'); // 首事件 = archive
    expect(phases.at(-1)).toBe('done'); // 末事件 = done
    // restore 2 个 tab，末个 count=total=2（逐 tab 进度）
    const restores = events.filter((e) => e.phase === 'restore');
    expect(restores.at(-1)!.count).toBe(2);
    expect(restores.at(-1)!.total).toBe(2);
  });
});

describe('requestWorkspaceSwitch — undo（T4：回滚切换）', () => {
  it('undo：回滚 binding 到原工作区 + restore 原工作区标签', async () => {
    const { c, store } = mockChromeWithStorage({
      'windowWorkspaceBinding.100': 'ws-a',
      'tabSession.ws-a': { tabs: [{ url: 'https://a.com', order: 0 }], savedAt: 1 },
      'tabSession.ws-b': { tabs: [{ url: 'https://b.com', order: 0 }], savedAt: 1 },
    });
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 10, windowId: 100, url: 'https://cur.com', index: 0 },
    ] as never);

    const result = await requestWorkspaceSwitch('ws-b', 100);
    expect(store['windowWorkspaceBinding.100']).toBe('ws-b');

    await result.undo();

    // binding 回滚 ws-a；restore ws-a session（= 切换时 archive 的 cur.com）
    expect(store['windowWorkspaceBinding.100']).toBe('ws-a');
    expect(c.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://cur.com' }));
  });
});

describe('switchWorkspaceBySetting — 门控分流（T3：off 纯 UI / close tab 编排）', () => {
  it('off 模式：仅 selectWorkspace，不触发 tab 编排', async () => {
    const { c } = mockChromeWithStorage({ 'windowWorkspaceBinding.1': 'ws-a' });
    const selectWorkspace = vi.fn();
    await switchWorkspaceBySetting({ toId: 'ws-b', setting: 'off', windowId: 1, selectWorkspace });
    // off 不调 requestWorkspaceSwitch：无 tab 操作
    expect(c.tabs.remove).not.toHaveBeenCalled();
    expect(c.tabs.create).not.toHaveBeenCalled();
    // selectWorkspace 仍同步选中态（off = 当前行为）
    expect(selectWorkspace).toHaveBeenCalledWith('ws-b');
  });

  it('close + windowId：requestWorkspaceSwitch 编排 tab + selectWorkspace 同步选中态', async () => {
    const { c, store } = mockChromeWithStorage({
      'windowWorkspaceBinding.1': 'ws-a',
      'tabSession.ws-b': { tabs: [{ url: 'https://b.com', order: 0 }], savedAt: 1 },
    });
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 10, windowId: 1, url: 'https://a.com', index: 0 },
    ] as never);
    const selectWorkspace = vi.fn();
    await switchWorkspaceBySetting({ toId: 'ws-b', setting: 'close', windowId: 1, selectWorkspace });
    // tab 编排：restore ws-b 的 tab（active:false 防闪烁）
    expect(c.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://b.com' }));
    // binding 更新到 ws-b（requestWorkspaceSwitch 内部）
    expect(store['windowWorkspaceBinding.1']).toBe('ws-b');
    // selectWorkspace 同步 store 选中态（否则 UI 高亮/分类停留在旧工作区）
    expect(selectWorkspace).toHaveBeenCalledWith('ws-b');
  });

  it('close + windowId null（非扩展环境）：fallback 仅 selectWorkspace，不编排', async () => {
    const selectWorkspace = vi.fn();
    await switchWorkspaceBySetting({ toId: 'ws-b', setting: 'close', windowId: null, selectWorkspace });
    expect(selectWorkspace).toHaveBeenCalledWith('ws-b');
  });
});

describe('countRestorableTabsInWindow — 本窗可归档 tab 计数（T5 首启告知用）', () => {
  it('计数可归档 content tab，排除内部页与 home', async () => {
    const { c } = mockChromeWithStorage({});
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 1, windowId: 5, url: 'https://a.com', index: 0 },
      { id: 2, windowId: 5, url: 'https://b.com', index: 1 },
      { id: 3, windowId: 5, url: 'chrome://newtab', index: 2 },
      { id: 4, windowId: 5, url: 'chrome-extension://octane/home.html', index: 3 },
    ] as never);

    expect(await countRestorableTabsInWindow(5)).toBe(2);
  });

  it('无 tab → 0', async () => {
    mockChromeWithStorage({});

    expect(await countRestorableTabsInWindow(5)).toBe(0);
  });

  it('devtools: 与 file: 不可恢复，不计入（T6）', async () => {
    const { c } = mockChromeWithStorage({});
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 1, windowId: 5, url: 'https://a.com', index: 0 },
      { id: 2, windowId: 5, url: 'devtools://devtools/builder.html', index: 1 },
      { id: 3, windowId: 5, url: 'file:///tmp/x.html', index: 2 },
    ] as never);

    expect(await countRestorableTabsInWindow(5)).toBe(1);
  });
});

describe('switchWorkspaceBySetting — 返回 SwitchResult（T4 切换结果 Toast 用）', () => {
  it('close + windowId：返回 fromId/closedCount/undo（供 Toast「已关闭 N / 切回 Y」）', async () => {
    const { c } = mockChromeWithStorage({
      'windowWorkspaceBinding.1': 'ws-a',
      'tabSession.ws-b': { tabs: [{ url: 'https://b.com', order: 0 }], savedAt: 1 },
    });
    vi.mocked(c.tabs.query).mockResolvedValue([
      { id: 10, windowId: 1, url: 'https://a.com', index: 0 },
    ] as never);
    const selectWorkspace = vi.fn();

    const result = await switchWorkspaceBySetting({ toId: 'ws-b', setting: 'close', windowId: 1, selectWorkspace });

    expect(result.fromId).toBe('ws-a');
    expect(result.closedCount).toBe(1); // 关了 1 个 content tab（a.com）
    expect(typeof result.undo).toBe('function');
  });

  it('off：返回 noop（fromId null / closedCount 0，无 undo 语义）', async () => {
    const selectWorkspace = vi.fn();

    const result = await switchWorkspaceBySetting({ toId: 'ws-b', setting: 'off', windowId: 1, selectWorkspace });

    expect(result.fromId).toBeNull();
    expect(result.closedCount).toBe(0);
  });
});

// archiveByMode（T3）：close 全窗 restorable；hide 按 groupId 过滤当前 ws 组 + 散 tab（不污染别 ws 组）。
// 使用 T0 setup.ts 注入的 stub（globalThis.chrome.__testTabs / __testGroups 种子）。
// 注：本文件其它 describe 用 mockChromeWithStorage 整体替换 globalThis.chrome，会使 T0 stub
// 的 `t.query ?? ...` 守卫保留旧 vi.fn 而非读 __testTabs。故此处 beforeEach 装一份新鲜
// Map 驱动的 chrome（与 setup.ts 同构），保证自包含不受前测污染。
describe('archiveByMode', () => {
  beforeEach(() => {
    const groups = new Map<number, any>();
    const tabsStore = new Map<number, any>();
    let nextGroupId = 100;
    const c: any = {
      tabs: {
        query: async (info: { windowId?: number } = {}) =>
          Array.from(tabsStore.values()).filter(
            (t) => info.windowId == null || t.windowId === info.windowId,
          ),
        create: async () => undefined,
        remove: async () => undefined,
        update: async () => undefined,
        discard: async () => undefined,
        group: async (opts: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }) => {
          let gid = opts.groupId;
          if (gid == null) {
            gid = nextGroupId++;
            groups.set(gid, { id: gid, windowId: opts.createProperties?.windowId ?? -1, title: '', color: 'grey', collapsed: false });
          }
          for (const tid of opts.tabIds) {
            const tab = tabsStore.get(tid);
            if (tab) tab.groupId = gid;
          }
          return gid;
        },
        ungroup: async () => undefined,
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
        update: async () => undefined,
      },
      runtime: { getURL: (p: string) => `chrome-extension://octane/${p.replace(/^\//, '')}` },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
      },
      __testTabs: tabsStore,
      __testGroups: groups,
    };
    (globalThis as unknown as { chrome: unknown }).chrome = c;
    // 当前 ws（ws-a）的组（gid=10）含 2 tab；别 ws（ws-b）折叠组（gid=11）含 1 tab；散 tab 1 个
    groups.set(10, { id: 10, windowId: 1, title: '工作 ·aaaa1111', color: 'grey', collapsed: false });
    groups.set(11, { id: 11, windowId: 1, title: '学习 ·bbbb2222', color: 'grey', collapsed: true });
    tabsStore.set(1, { id: 1, windowId: 1, url: 'https://a1.com', groupId: 10 });
    tabsStore.set(2, { id: 2, windowId: 1, url: 'https://a2.com', groupId: 10 });
    tabsStore.set(3, { id: 3, windowId: 1, url: 'https://b1.com', groupId: 11 }); // 别 ws，不应归档
    tabsStore.set(4, { id: 4, windowId: 1, url: 'https://loose.com', groupId: -1 }); // 散 tab，视为当前 ws
  });

  it('hide：只归档当前 ws 组 + 散 tab（不污染别 ws 组）', async () => {
    const c = (globalThis as any).chrome;
    const result = await archiveByMode(c, 1, 'aaaa1111-0000-0000', 'hide');
    expect(result).not.toBeNull();
    const urls = result!.tabs.map((t: any) => t.entry.url).sort();
    expect(urls).toEqual(['https://a1.com', 'https://a2.com', 'https://loose.com']);
    // 别 ws tab 不在
    expect(urls).not.toContain('https://b1.com');
  });

  it('hide：找不到当前 ws 组时，散 tab 仍归档（兜底前保全）', async () => {
    const c = (globalThis as any).chrome;
    const result = await archiveByMode(c, 1, 'zzzz9999-0000-0000', 'hide'); // 无此 ws 组
    expect(result!.tabs.map((t: any) => t.entry.url)).toEqual(['https://loose.com']);
  });

  it('close：归档全窗 restorable tab（v1 行为不变）', async () => {
    const c = (globalThis as any).chrome;
    const result = await archiveByMode(c, 1, 'aaaa1111-0000-0000', 'close');
    expect(result!.tabs.map((t: any) => t.entry.url).sort()).toEqual([
      'https://a1.com', 'https://a2.com', 'https://b1.com', 'https://loose.com',
    ]);
  });

  it('query 抛错 → null（硬屏障）', async () => {
    const c = (globalThis as any).chrome;
    const orig = c.tabs.query;
    c.tabs.query = async () => { throw new Error('boom'); };
    const result = await archiveByMode(c, 1, 'aaaa1111-0000-0000', 'hide');
    expect(result).toBeNull();
    c.tabs.query = orig;
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T4: disposeByMode + restoreByMode（hide 核心 dispose/restore）
// 自 contained Map-driven chrome stub（参考 archiveByMode 测试同构），含 Map-backed
// storage.local（TabSession 真实往返）+ vi.fn 的 update/create（验证两个补丁）。
// ──────────────────────────────────────────────────────────────────────────

/** 装一份新鲜 Map 驱动的 chrome（tabs/groups/storage 全真实往返），返回实例供断言。 */
function installDisposeRestoreStub() {
  const groups = new Map<number, any>();
  const tabsStore = new Map<number, any>();
  const storageStore: Record<string, unknown> = {};
  let nextGroupId = 100;
  let nextTabId = 1000;
  const c: any = {
    runtime: { getURL: (p: string) => `chrome-extension://octane/${p.replace(/^\//, '')}` },
    tabs: {
      query: async (info: { windowId?: number } = {}) =>
        Array.from(tabsStore.values()).filter(
          (t) => info.windowId == null || t.windowId === info.windowId,
        ),
      create: vi.fn(async (props: any) => {
        const id = nextTabId++;
        const tab = { id, groupId: -1, active: false, ...props };
        tabsStore.set(id, tab);
        return { ...tab };
      }),
      remove: async (id: number) => { tabsStore.delete(id); },
      update: vi.fn(async (id: number, props: any) => {
        const tab = tabsStore.get(id);
        if (!tab) throw new Error(`Tab ${id} not found`);
        Object.assign(tab, props);
        return { ...tab };
      }),
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

describe('disposeByMode', () => {
  beforeEach(() => {
    const c = installDisposeRestoreStub();
    // 当前 ws（aaaa1111）组 gid=10 含 1 tab；pinned home tab；散 tab；pinned 非 home tab
    c.__testGroups.set(10, { id: 10, windowId: 1, title: '工作 ·aaaa1111', color: 'grey', collapsed: false });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a1.com', groupId: 10 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'chrome-extension://octane/home.html', groupId: -1, pinned: true });
    c.__testTabs.set(3, { id: 3, windowId: 1, url: 'https://loose.com', groupId: -1 });
    c.__testTabs.set(4, { id: 4, windowId: 1, url: 'https://pinned.com', groupId: -1, pinned: true });
  });

  describe('close 档（v1 回归）', () => {
    it('close：走 v1 disposeTabs（remove）→ ok=true', async () => {
      const c = (globalThis as any).chrome;
      const toDispose = [
        { id: 1, entry: { url: 'https://a1.com', pinned: false, order: 0 } },
        { id: 3, entry: { url: 'https://loose.com', pinned: false, order: 1 } },
      ];
      const r = await disposeByMode(c, 1, 'aaaa1111-0000-0000', 'close', toDispose as any);
      expect(r.ok).toBe(true);
      expect(c.__testTabs.has(1)).toBe(false);
      expect(c.__testTabs.has(3)).toBe(false);
    });
  });

  describe('hide / hide-discard 档', () => {
    it('hide：激活 home + 散 tab 入组 + collapse + pinned remove', async () => {
      const c = (globalThis as any).chrome;
      const toDispose = [
        { id: 1, entry: { url: 'https://a1.com', pinned: false, order: 0 } },
        { id: 3, entry: { url: 'https://loose.com', pinned: false, order: 1 } },
        { id: 4, entry: { url: 'https://pinned.com', pinned: true, order: 2 } },
      ];
      const r = await disposeByMode(c, 1, 'aaaa1111-0000-0000', 'hide', toDispose as any);
      expect(r.ok).toBe(true);
      // 补丁 1：激活 home tab（避 discard active 失败 + 避抢焦点）
      expect(c.tabs.update).toHaveBeenCalledWith(2, { active: true });
      // 组折叠
      expect(c.__testGroups.get(10).collapsed).toBe(true);
      // pinned tab 被 remove
      expect(c.__testTabs.has(4)).toBe(false);
      // 散 tab 纳入组 10
      expect(c.__testTabs.get(3).groupId).toBe(10);
      // home tab 未被 dispose（仍存在，isRestorable 自动排除 chrome-extension://）
      expect(c.__testTabs.has(2)).toBe(true);
    });

    it('hide-discard：折叠 + discard 非 active tab', async () => {
      const c = (globalThis as any).chrome;
      const toDispose = [{ id: 1, entry: { url: 'https://a1.com', pinned: false, order: 0 } }];
      const r = await disposeByMode(c, 1, 'aaaa1111-0000-0000', 'hide-discard', toDispose as any);
      expect(r.ok).toBe(true);
      expect(c.__testGroups.get(10).collapsed).toBe(true);
      // home 被 active 后 tab 1 非 active → discard 成功
      expect(c.__testTabs.get(1).discarded).toBe(true);
    });

    it('hide：无现有 ws 组 + 散 tab → 建组（title=标识）+ collapse', async () => {
      const c = (globalThis as any).chrome;
      c.__testGroups.clear(); // 清掉组 10 模拟无现有 ws 组
      const toDispose = [{ id: 3, entry: { url: 'https://loose.com', pinned: false, order: 0 } }];
      const r = await disposeByMode(c, 1, 'aaaa1111-0000-0000', 'hide', toDispose as any);
      expect(r.ok).toBe(true);
      // 新建组 title=标识（空名 + wsHash），collapsed=true
      const groups = Array.from(c.__testGroups.values());
      expect(groups.some((g: any) => g.title === ' ·aaaa1111' && g.collapsed === true)).toBe(true);
    });

    it('collapse 失败 → ok=false（调用方不更新 binding）', async () => {
      const c = (globalThis as any).chrome;
      const orig = c.tabGroups.update;
      c.tabGroups.update = async () => { throw new Error('boom'); };
      const r = await disposeByMode(c, 1, 'aaaa1111-0000-0000', 'hide', []);
      expect(r.ok).toBe(false);
      c.tabGroups.update = orig;
    });

    it('discard 单 tab 失败不阻断 ok（部分失败降级）', async () => {
      const c = (globalThis as any).chrome;
      const orig = c.tabs.discard;
      c.tabs.discard = async () => { throw new Error('cannot discard'); };
      const toDispose = [{ id: 1, entry: { url: 'https://a1.com', pinned: false, order: 0 } }];
      const r = await disposeByMode(c, 1, 'aaaa1111-0000-0000', 'hide-discard', toDispose as any);
      expect(r.ok).toBe(true); // discard 失败不阻断
      c.tabs.discard = orig;
    });
  });
});

describe('restoreByMode', () => {
  beforeEach(() => {
    installDisposeRestoreStub();
  });

  describe('close 档（v1 回归）', () => {
    it('close：走 v1 openTabsInWindow（重开 tab）', async () => {
      const c = (globalThis as any).chrome;
      const { saveTabSession } = await import('@/services/TabSessionService');
      await saveTabSession('cccc3333-0000-0000', [{ url: 'https://x.com', pinned: false, order: 0 }]);
      const r = await restoreByMode(c, 1, 'cccc3333-0000-0000', '目标', 'close');
      expect(r.opened.length).toBe(1);
      expect(c.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x.com' }));
    });
  });

  describe('hide / hide-discard 档', () => {
    it('命中标识组 → expand（不重开）+ 返回 groupId（补丁 2）', async () => {
      const c = (globalThis as any).chrome;
      c.__testGroups.set(20, { id: 20, windowId: 1, title: '目标 ·cccc3333', color: 'grey', collapsed: true });
      const r = await restoreByMode(c, 1, 'cccc3333-0000-0000', '目标', 'hide');
      expect(r.opened).toEqual([]);
      // 补丁 2：返回 groupId 供 T6 undo generation 校验组结构
      expect(r.groupId).toBe(20);
      expect(c.__testGroups.get(20).collapsed).toBe(false);
      // 不重开 tab
      expect(c.tabs.create).not.toHaveBeenCalled();
    });

    it('未命中 → 兜底 restore 重开 + 建组（title=标识）+ 返回 groupId（补丁 2）', async () => {
      const c = (globalThis as any).chrome;
      const { saveTabSession } = await import('@/services/TabSessionService');
      await saveTabSession('cccc3333-0000-0000', [{ url: 'https://x.com', pinned: false, order: 0 }]);
      const r = await restoreByMode(c, 1, 'cccc3333-0000-0000', '目标', 'hide');
      expect(r.opened.length).toBe(1);
      // 补丁 2：新建组也返回 groupId
      expect(r.groupId).not.toBeNull();
      // 新组 title = 标识，collapsed=false
      const groups = await c.tabGroups.query({ windowId: 1 });
      expect(groups.some((g: any) => g.title === '目标 ·cccc3333')).toBe(true);
      expect(groups.some((g: any) => g.id === r.groupId && g.collapsed === false)).toBe(true);
    });

    it('未命中且无 TabSession → 空（无 tab 可恢复，groupId=null）', async () => {
      const c = (globalThis as any).chrome;
      const r = await restoreByMode(c, 1, 'cccc3333-0000-0000', '目标', 'hide');
      expect(r.opened).toEqual([]);
      expect(r.failed).toEqual([]);
      expect(r.groupId).toBeNull();
    });
  });
});
