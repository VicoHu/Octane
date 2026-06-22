import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  focusOrCreateHomeTab,
  ensureHomeTabInAllWindows,
} from '../focusOrCreateHomeTab';

const HOME_URL = 'chrome-extension://octane/home.html';

/** 构造 fake tab，默认当前窗口 100。 */
function tab(
  partial: Partial<{
    id: number;
    windowId: number;
    pinned: boolean;
    url: string;
  }> = {},
) {
  return { id: 1, windowId: 100, pinned: false, url: HOME_URL, ...partial };
}

type QueryInfo = { url?: string; windowId?: number };

/**
 * 覆盖 chrome 全局为可控 mock（覆盖 WxtVitest 的 fakeBrowser，参考 popup/testUtils）。
 */
function mockChrome() {
  const c = {
    runtime: {
      getURL: (p: string) =>
        `chrome-extension://octane/${p.replace(/^\//, '')}`,
    },
    tabs: {
      query: vi.fn(async (_info: QueryInfo) => [] as unknown[]),
      update: vi.fn(async (_id: number, _props: { active?: boolean }) => undefined),
      create: vi.fn(
        async (_props: {
          url: string;
          pinned?: boolean;
          windowId?: number;
        }) => undefined,
      ),
    },
    windows: {
      getCurrent: vi.fn(async () => ({ id: 100 })),
      update: vi.fn(async (_id: number, _props: { focused?: boolean }) => undefined),
      getAll: vi.fn(async () => [{ id: 100 }, { id: 200 }]),
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = c;
  return c;
}

describe('focusOrCreateHomeTab', () => {
  let c: ReturnType<typeof mockChrome>;
  beforeEach(() => {
    c = mockChrome();
  });

  it('当前窗口已有 pinned home tab → 聚焦该 tab + 窗口，不创建', async () => {
    vi.mocked(c.tabs.query).mockResolvedValue([
      tab({ id: 5, windowId: 100, pinned: true }),
    ] as never);
    await focusOrCreateHomeTab();
    expect(c.tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(c.windows.update).toHaveBeenCalledWith(100, { focused: true });
    expect(c.tabs.create).not.toHaveBeenCalled();
  });

  it('当前窗口无 home tab → 创建 pinned，不聚焦', async () => {
    await focusOrCreateHomeTab();
    expect(c.tabs.create).toHaveBeenCalledWith({ url: HOME_URL, pinned: true });
    expect(c.tabs.update).not.toHaveBeenCalled();
    expect(c.windows.update).not.toHaveBeenCalled();
  });

  it('指定 windowId：只对该窗口判断，别窗口的 pinned tab 不算', async () => {
    vi.mocked(c.tabs.query).mockResolvedValue([
      tab({ id: 9, windowId: 200, pinned: true }),
    ] as never);
    await focusOrCreateHomeTab(100);
    expect(c.tabs.create).toHaveBeenCalledWith({ url: HOME_URL, pinned: true });
    expect(c.tabs.update).not.toHaveBeenCalled();
  });

  it('home tab 未 pinned（用户手动取消固定）→ 不算 logo tab，创建 pinned', async () => {
    vi.mocked(c.tabs.query).mockResolvedValue([
      tab({ id: 7, windowId: 100, pinned: false }),
    ] as never);
    await focusOrCreateHomeTab();
    expect(c.tabs.create).toHaveBeenCalledWith({ url: HOME_URL, pinned: true });
  });
});

describe('ensureHomeTabInAllWindows', () => {
  let c: ReturnType<typeof mockChrome>;
  beforeEach(() => {
    c = mockChrome();
  });

  it('N 窗口中 M 个缺 pinned home tab → 给缺的窗口补建 pinned', async () => {
    vi.mocked(c.tabs.query).mockImplementation((info: QueryInfo) =>
      Promise.resolve(
        info.windowId === 100
          ? ([tab({ id: 1, windowId: 100, pinned: true })] as never)
          : ([] as never[]),
      ),
    );
    await ensureHomeTabInAllWindows();
    expect(c.tabs.create).toHaveBeenCalledTimes(1);
    expect(c.tabs.create).toHaveBeenCalledWith({
      url: HOME_URL,
      pinned: true,
      windowId: 200,
    });
  });

  it('所有窗口都有 pinned home tab → 不创建', async () => {
    vi.mocked(c.tabs.query).mockResolvedValue([
      tab({ id: 1, pinned: true }),
    ] as never);
    await ensureHomeTabInAllWindows();
    expect(c.tabs.create).not.toHaveBeenCalled();
  });
});
