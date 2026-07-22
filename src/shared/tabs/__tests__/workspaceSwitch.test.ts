import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestWorkspaceSwitch } from '../workspaceSwitch';

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
