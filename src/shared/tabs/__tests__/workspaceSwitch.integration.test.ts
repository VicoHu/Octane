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
    await requestWorkspaceSwitch('ws-b', 100);

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
    await requestWorkspaceSwitch('ws-a', 100);

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

    await requestWorkspaceSwitch('ws-b', 100);

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
    await Promise.all([requestWorkspaceSwitch('ws-b', 100), requestWorkspaceSwitch('ws-c', 100)]);

    // 最终 binding 为最后一次（C）；archive query 共 2 次（两次各自 archive，未互相吞掉）
    expect(store['windowWorkspaceBinding.100']).toBe('ws-c');
    expect(c.tabs.query).toHaveBeenCalledTimes(2);
  });
});
