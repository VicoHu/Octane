import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCurrentTabContext } from '../useCurrentTabContext';

type TabLike = { id?: number; url?: string };

/**
 * mock chrome.tabs：query 返回 activeTab，onActivated/onUpdated 可手动触发。
 * 返回触发器与 setQueryResult，供 M2(race)/M3(onUpdated) 测试控制时序。
 */
function mockTabs(activeTab: TabLike | undefined) {
  const onActivatedCbs: Array<(info: { tabId: number; windowId: number }) => void> = [];
  const onUpdatedCbs: Array<(tabId: number, changeInfo: { status?: string; url?: string }) => void> = [];
  const queryMock = vi.fn().mockResolvedValue(activeTab ? [activeTab] : []);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      query: queryMock,
      onActivated: {
        addListener: vi.fn((cb: (info: { tabId: number; windowId: number }) => void) => onActivatedCbs.push(cb)),
        removeListener: vi.fn(),
      },
      onUpdated: {
        addListener: vi.fn((cb: (tabId: number, changeInfo: { status?: string; url?: string }) => void) => onUpdatedCbs.push(cb)),
        removeListener: vi.fn(),
      },
    },
  };
  return {
    queryMock,
    triggerActivated(tabId: number) {
      onActivatedCbs.forEach((cb) => cb({ tabId, windowId: 1 }));
    },
    triggerUpdated(tabId: number, changeInfo: { status?: string; url?: string }) {
      onUpdatedCbs.forEach((cb) => cb(tabId, changeInfo));
    },
    setQueryResult(tab: TabLike | undefined) {
      queryMock.mockResolvedValue(tab ? [tab] : []);
    },
  };
}

describe('useCurrentTabContext — 当前 tab hostname 联动', () => {
  it('当前 tab url 为 undefined（无 host permission）→ hostname 为 null，不报错', async () => {
    mockTabs({ id: 1 });
    const { result } = renderHook(() => useCurrentTabContext());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hostname).toBeNull();
  });

  it('快速切 tab race：后发起的刷新先到达时，前一个过期结果被丢弃', async () => {
    const ctl = mockTabs({ id: 1, url: 'https://a.com' });
    const { result } = renderHook(() => useCurrentTabContext());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hostname).toBe('a.com');

    // 后续两次 query 返回可控 promise，模拟异步 race
    let resolveFirst!: (v: TabLike[]) => void;
    let resolveSecond!: (v: TabLike[]) => void;
    ctl.queryMock
      .mockReturnValueOnce(new Promise<TabLike[]>((r) => { resolveFirst = r; }))
      .mockReturnValueOnce(new Promise<TabLike[]>((r) => { resolveSecond = r; }));

    ctl.triggerActivated(2);
    ctl.triggerActivated(3);

    // 第二次（b.com）先 resolve → 生效
    resolveSecond([{ id: 3, url: 'https://b.com' }]);
    await waitFor(() => expect(result.current.hostname).toBe('b.com'));

    // 第一次（a.com）后 resolve → 过期，被丢弃
    resolveFirst([{ id: 2, url: 'https://a.com' }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.hostname).toBe('b.com');
  });

  it('onUpdated 的 loading 事件被忽略，仅 complete 触发刷新', async () => {
    const ctl = mockTabs({ id: 1, url: 'https://a.com' });
    const { result } = renderHook(() => useCurrentTabContext());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hostname).toBe('a.com');

    // 后续 query 改为返回 b.com
    ctl.setQueryResult({ id: 1, url: 'https://b.com' });

    // loading 事件 → 不刷新，hostname 不变
    ctl.triggerUpdated(1, { status: 'loading' });
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.hostname).toBe('a.com');

    // complete 事件 → 刷新为 b.com
    ctl.triggerUpdated(1, { status: 'complete' });
    await waitFor(() => expect(result.current.hostname).toBe('b.com'));
  });
});
