import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/shared/db/database', () => ({
  getAll: vi.fn(),
}));

import { useSourceMap } from '../useSourceMap';
import { getAll } from '@/shared/db/database';
import type { Workspace, Category } from '@/shared/types';
import { DB_NAME } from '@/shared/types';

function makeWs(id: string): Workspace {
  return { id, name: id, icon: '🗂', createdAt: 0, order: 0 };
}
function makeCat(id: string): Category {
  return { id, workspaceId: 'w1', name: id, icon: '📁', order: 0, createdAt: 0 };
}

describe('useSourceMap — 工作区/分类来源解析', () => {
  beforeEach(() => vi.clearAllMocks());

  it('TS1 mount → getAll(workspaces)+getAll(categories) 一次取数，ready=true', async () => {
    const wss = [makeWs('w1'), makeWs('w2')];
    const cats = [makeCat('c1')];
    (getAll as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(wss)
      .mockResolvedValueOnce(cats);

    const { result } = renderHook(() => useSourceMap());
    // 初始未就绪
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.workspaces).toEqual(wss);
    expect(result.current.categories).toEqual(cats);
    expect(getAll).toHaveBeenCalledWith('workspaces');
    expect(getAll).toHaveBeenCalledWith('categories');
  });

  it('TS2 收 workspaces / categories 广播 → 刷新（getAll 再次调用）', async () => {
    (getAll as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeWs('w1')])
      .mockResolvedValueOnce([makeCat('c1')])
      .mockResolvedValueOnce([makeWs('w1'), makeWs('w2')])
      .mockResolvedValueOnce([makeCat('c1')]);

    const { result } = renderHook(() => useSourceMap());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(getAll).toHaveBeenCalledTimes(2);

    const ch = new BroadcastChannel(DB_NAME);
    ch.postMessage({ store: 'workspaces', action: 'put' });
    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(4));
    expect(result.current.workspaces).toHaveLength(2);
    ch.close();
  });

  it('TS3 [R9] bookmarks+delete 广播 → 刷新；contexts / bookmarks+put → 不刷新', async () => {
    (getAll as ReturnType<typeof vi.fn>)
      .mockResolvedValue([makeWs('w1')]); // 每次 getAll 都返回（workspaces/categories 交替）

    renderHook(() => useSourceMap());
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    const baseline = (getAll as ReturnType<typeof vi.fn>).mock.calls.length;

    const ch = new BroadcastChannel(DB_NAME);
    // contexts 广播 → 不刷新
    ch.postMessage({ store: 'contexts', action: 'put' });
    await new Promise((r) => setTimeout(r, 20));
    expect((getAll as ReturnType<typeof vi.fn>).mock.calls.length).toBe(baseline);

    // bookmarks+put（如 syncContextMeta 更新 contextCount）→ 不刷新
    ch.postMessage({ store: 'bookmarks', action: 'put' });
    await new Promise((r) => setTimeout(r, 20));
    expect((getAll as ReturnType<typeof vi.fn>).mock.calls.length).toBe(baseline);

    // bookmarks+delete（级联删工作区/分类）→ 刷新（R9：cascadeDelete 只广播 bookmarks-delete）
    ch.postMessage({ store: 'bookmarks', action: 'delete' });
    await waitFor(() => expect((getAll as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(baseline));
    ch.close();
  });

  it('TS4 BroadcastChannel 不可用 → 静默降级，首次加载仍 ready', async () => {
    const origBC = globalThis.BroadcastChannel;
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, writable: true, configurable: true });
    try {
      (getAll as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([makeWs('w1')])
        .mockResolvedValueOnce([makeCat('c1')]);
      const { result } = renderHook(() => useSourceMap());
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.workspaces).toHaveLength(1);
    } finally {
      Object.defineProperty(globalThis, 'BroadcastChannel', { value: origBC, writable: true, configurable: true });
    }
  });
});
