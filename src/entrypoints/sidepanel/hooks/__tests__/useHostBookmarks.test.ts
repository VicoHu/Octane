import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/shared/db/database', () => ({
  getAll: vi.fn(),
}));
vi.mock('@/services/BookmarkService', async () => {
  const actual = await vi.importActual<typeof import('@/services/BookmarkService')>('@/services/BookmarkService');
  return { ...actual, findBookmarksByHost: vi.fn() };
});

import { useHostBookmarks } from '../useHostBookmarks';
import { getAll } from '@/shared/db/database';
import { findBookmarksByHost } from '@/services/BookmarkService';
import type { Bookmark } from '@/shared/types';
import { DB_NAME } from '@/shared/types';

function makeBookmark(id: string, url: string): Bookmark {
  return {
    id, workspaceId: 'w1', categoryId: 'c1', name: id, url,
    description: '', faviconUrl: '', contextCount: 0,
    hasEncryptedContext: false, createdAt: 0, updatedAt: 0,
  };
}

describe('useHostBookmarks — 全局 hostname 匹配', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hostname 为 null → matched=[]，不调 getAll', () => {
    const { result } = renderHook(() => useHostBookmarks(null));
    expect(result.current.matched).toEqual([]);
    expect(getAll).not.toHaveBeenCalled();
  });

  it('hostname 有值 → getAll(bookmarks) + findBookmarksByHost 返回命中', async () => {
    const all = [makeBookmark('b1', 'https://a.com'), makeBookmark('b2', 'https://b.com')];
    const hit = [all[0]];
    (getAll as ReturnType<typeof vi.fn>).mockResolvedValue(all);
    (findBookmarksByHost as ReturnType<typeof vi.fn>).mockReturnValue(hit);

    const { result } = renderHook(() => useHostBookmarks('a.com'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getAll).toHaveBeenCalledWith('bookmarks');
    expect(findBookmarksByHost).toHaveBeenCalledWith(all, 'a.com');
    expect(result.current.matched).toBe(hit);
  });

  it('hostname 变化 → 重新匹配，结果更新', async () => {
    const all = [makeBookmark('b1', 'https://a.com')];
    (getAll as ReturnType<typeof vi.fn>).mockResolvedValue(all);
    (findBookmarksByHost as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([all[0]])
      .mockReturnValueOnce([]);

    const { result, rerender } = renderHook(({ h }) => useHostBookmarks(h), { initialProps: { h: 'a.com' } });
    await waitFor(() => expect(result.current.matched).toHaveLength(1));

    rerender({ h: 'z.com' });
    await waitFor(() => expect(result.current.matched).toHaveLength(0));
  });
});

describe('useHostBookmarks — BroadcastChannel 监听', () => {
  beforeEach(() => vi.clearAllMocks());

  it('收到 bookmarks 广播 → 重新匹配（getAll 再调一次）', async () => {
    const all = [makeBookmark('b1', 'https://a.com')];
    (getAll as ReturnType<typeof vi.fn>).mockResolvedValue(all);
    (findBookmarksByHost as ReturnType<typeof vi.fn>).mockReturnValue([all[0]]);

    const { result } = renderHook(() => useHostBookmarks('a.com'));
    await waitFor(() => expect(result.current.matched).toHaveLength(1));
    expect(getAll).toHaveBeenCalledTimes(1);

    // 模拟 home 广播 bookmarks 变化（原生 BroadcastChannel 异步派发）
    const ch = new BroadcastChannel(DB_NAME);
    ch.postMessage({ store: 'bookmarks', action: 'put' });
    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(2));
    ch.close();
  });

  it('收到非 bookmarks 广播 → 不重新匹配', async () => {
    const all = [makeBookmark('b1', 'https://a.com')];
    (getAll as ReturnType<typeof vi.fn>).mockResolvedValue(all);
    (findBookmarksByHost as ReturnType<typeof vi.fn>).mockReturnValue([all[0]]);

    const { result } = renderHook(() => useHostBookmarks('a.com'));
    await waitFor(() => expect(result.current.matched).toHaveLength(1));
    expect(getAll).toHaveBeenCalledTimes(1);

    const ch = new BroadcastChannel(DB_NAME);
    ch.postMessage({ store: 'contexts', action: 'put' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getAll).toHaveBeenCalledTimes(1);
    ch.close();
  });
});

describe('useHostBookmarks — BroadcastChannel 不可用时静默降级', () => {
  const origBC = globalThis.BroadcastChannel;

  afterEach(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: origBC, writable: true, configurable: true });
  });

  // 回归测试：BroadcastChannel 为 undefined 时 channel=null，监听须用可选链守卫
  // （channel?.addEventListener），否则对 null 赋值抛 TypeError。与 database.ts 的
  // dbChannel?.postMessage 同模式。
  it('无 BroadcastChannel 时静默降级不崩溃', async () => {
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, writable: true, configurable: true });

    const all = [makeBookmark('b1', 'https://a.com')];
    (getAll as ReturnType<typeof vi.fn>).mockResolvedValue(all);
    (findBookmarksByHost as ReturnType<typeof vi.fn>).mockReturnValue([all[0]]);

    // 渲染应不抛错（channel=null 时监听跳过，refresh 仍正常匹配）
    const { result } = renderHook(() => useHostBookmarks('a.com'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.matched).toHaveLength(1);
  });
});
