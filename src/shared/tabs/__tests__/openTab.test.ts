import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openUrlInNewTab } from '../openTab';

type ChromeTabsMock = {
  query: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

const getChromeTabs = (): ChromeTabsMock =>
  (globalThis as unknown as { chrome: { tabs: ChromeTabsMock } }).chrome.tabs;

describe('openUrlInNewTab — 当前窗口最右侧打开', () => {
  beforeEach(() => {
    (globalThis as unknown as { chrome?: unknown }).chrome = {
      tabs: {
        query: vi.fn(),
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  it('查询当前窗口 tab 后在最大 index 右侧创建前台 tab', async () => {
    const { query, create } = getChromeTabs();
    query.mockResolvedValue([
      { id: 1, index: 0, pinned: true },
      { id: 2, index: 3 },
      { id: 3, index: 1 },
    ]);

    await openUrlInNewTab('https://example.com', true);

    expect(query).toHaveBeenCalledWith({ currentWindow: true });
    expect(create).toHaveBeenCalledWith({
      url: 'https://example.com',
      active: true,
      index: 4,
    });
  });

  it('当前窗口没有 tab 时从 index 0 后台创建', async () => {
    const { query, create } = getChromeTabs();
    query.mockResolvedValue([]);

    await openUrlInNewTab('https://example.com', false);

    expect(create).toHaveBeenCalledWith({
      url: 'https://example.com',
      active: false,
      index: 0,
    });
  });
});
