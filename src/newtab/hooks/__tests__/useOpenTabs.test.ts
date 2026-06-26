import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useOpenTabs } from '../useOpenTabs';

type TabLike = { id?: number; url?: string; lastAccessed?: number };

/**
 * mock chrome.tabs：query 可控，onCreated/onUpdated/onRemoved 可手动触发。
 * 参考 useCurrentTabContext.test.ts 的回调收集套路。
 */
function mockTabs(initial: TabLike[]) {
  let current = initial;
  const listeners: Record<'onCreated' | 'onUpdated' | 'onRemoved', Array<() => void>> = {
    onCreated: [],
    onUpdated: [],
    onRemoved: [],
  };
  const queryMock = vi.fn(async () => current);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      query: queryMock,
      onCreated: {
        addListener: vi.fn((cb: () => void) => listeners.onCreated.push(cb)),
        removeListener: vi.fn(),
      },
      onUpdated: {
        addListener: vi.fn((cb: () => void) => listeners.onUpdated.push(cb)),
        removeListener: vi.fn(),
      },
      onRemoved: {
        addListener: vi.fn((cb: () => void) => listeners.onRemoved.push(cb)),
        removeListener: vi.fn(),
      },
    },
  };
  return {
    queryMock,
    setQueryResult(next: TabLike[]) {
      current = next;
      queryMock.mockResolvedValue(next);
    },
    triggerCreated() {
      listeners.onCreated.forEach((cb) => cb());
    },
    triggerUpdated() {
      listeners.onUpdated.forEach((cb) => cb());
    },
    triggerRemoved() {
      listeners.onRemoved.forEach((cb) => cb());
    },
  };
}

describe('useOpenTabs — 返回当前窗口 tab 列表（按最近活跃降序）', () => {
  it('query 返回的 tab 映射为 {url,tabId,lastAccessed}，按 lastAccessed 降序', async () => {
    mockTabs([
      { id: 1, url: 'https://a.com', lastAccessed: 100 },
      { id: 2, url: 'https://b.com', lastAccessed: 300 },
      { id: 3, url: 'https://c.com', lastAccessed: 200 },
    ]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current.length).toBe(3));
    expect(result.current).toEqual([
      { url: 'https://b.com', tabId: 2, lastAccessed: 300 },
      { url: 'https://c.com', tabId: 3, lastAccessed: 200 },
      { url: 'https://a.com', tabId: 1, lastAccessed: 100 },
    ]);
  });

  it('过滤无 url 或无 id 的 tab', async () => {
    mockTabs([
      { id: 1, url: 'https://a.com', lastAccessed: 100 },
      { id: undefined, url: 'https://b.com', lastAccessed: 200 },
      { id: 3, url: undefined, lastAccessed: 300 },
    ]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current).toEqual([
      { url: 'https://a.com', tabId: 1, lastAccessed: 100 },
    ]);
  });

  it('onCreated 触发刷新（重新 query 后列表更新）', async () => {
    const ctl = mockTabs([{ id: 1, url: 'https://a.com', lastAccessed: 100 }]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current.length).toBe(1));

    ctl.setQueryResult([
      { id: 1, url: 'https://a.com', lastAccessed: 100 },
      { id: 2, url: 'https://b.com', lastAccessed: 200 },
    ]);
    ctl.triggerCreated();
    await waitFor(() => expect(result.current.length).toBe(2));
  });

  it('onUpdated 触发刷新（tab 导航后 url 同步）', async () => {
    const ctl = mockTabs([{ id: 1, url: 'https://a.com', lastAccessed: 100 }]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current[0]?.url).toBe('https://a.com'));

    ctl.setQueryResult([{ id: 1, url: 'https://a.com/archives', lastAccessed: 100 }]);
    ctl.triggerUpdated();
    await waitFor(() => expect(result.current[0]?.url).toBe('https://a.com/archives'));
  });

  it('onRemoved 触发刷新（关闭 tab 后列表缩短）', async () => {
    const ctl = mockTabs([
      { id: 1, url: 'https://a.com', lastAccessed: 100 },
      { id: 2, url: 'https://b.com', lastAccessed: 200 },
    ]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current.length).toBe(2));

    ctl.setQueryResult([{ id: 1, url: 'https://a.com', lastAccessed: 100 }]);
    ctl.triggerRemoved();
    await waitFor(() => expect(result.current.length).toBe(1));
  });

  it('chrome 不可用 → 返回空列表，不抛错', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = undefined;
    const { result } = renderHook(() => useOpenTabs());
    expect(result.current).toEqual([]);
  });
});
