import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestWorkspaceSwitch, type SwitchProgress } from '../workspaceSwitch';

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
