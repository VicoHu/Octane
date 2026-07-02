import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('@/services/ContextService', () => ({
  getContexts: vi.fn(),
  getContextsRaw: vi.fn(),
}));
vi.mock('@/services/UnlockSession', () => ({
  isUnlocked: vi.fn(),
}));

import { useEncryptedContexts } from '../useEncryptedContexts';
import { getContexts, getContextsRaw } from '@/services/ContextService';
import { isUnlocked } from '@/services/UnlockSession';
import type { Context } from '@/shared/types';
import { ContextType } from '@/shared/types';

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    id: 'c1',
    bookmarkId: 'bm-1',
    type: ContextType.NOTE,
    title: '笔记',
    content: '明文内容',
    isEncrypted: false,
    order: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('useEncryptedContexts — 上下文级粒度 + 切断联动', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(false); // 默认 sidepanel 未解锁
  });

  it('未解锁 → 调 getContextsRaw（密文占位，明文正常），不调 getContexts', async () => {
    const ctxs = [
      makeContext({ id: 'c1', content: '明文' }),
      makeContext({ id: 'c2', content: '', isEncrypted: true }), // 密文占位
    ];
    (getContextsRaw as ReturnType<typeof vi.fn>).mockResolvedValue(ctxs);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getContextsRaw).toHaveBeenCalledWith('bm-1');
    expect(getContexts).not.toHaveBeenCalled();
    expect(result.current.contexts).toHaveLength(2);
    expect(result.current.contexts[1]!.isEncrypted).toBe(true);
  });

  it('已解锁 → 调 getContexts（密文解密）', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const ctxs = [makeContext({ id: 'c1', content: '解密明文', isEncrypted: true })];
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue(ctxs);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getContexts).toHaveBeenCalledWith('bm-1');
    expect(getContextsRaw).not.toHaveBeenCalled();
    expect(result.current.contexts[0]!.content).toBe('解密明文');
  });

  it('回归核心：home 解锁（写共享 key → onChanged derived-key）不联动 sidepanel', async () => {
    // home 解锁只写 octane-derived-key，不写 sidepanel 标记 → isUnlocked('sidepanel') 仍 false
    const onChangeListeners: Array<(c: Record<string, unknown>, a: string) => void> = [];
    (globalThis as Record<string, unknown>).chrome = {
      storage: {
        onChanged: {
          addListener: (cb: (c: Record<string, unknown>, a: string) => void) => onChangeListeners.push(cb),
          removeListener: () => {},
        },
      },
    };
    (getContextsRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeContext({ id: 'c1', content: '', isEncrypted: true }), // 占位
    ]);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getContextsRaw).toHaveBeenCalledTimes(1);
    expect(getContexts).not.toHaveBeenCalled(); // 未解锁不调解密版

    // home 解锁写入共享 key → onChanged 触发重拉
    isUnlocked; // 保持 mock false（sidepanel 标记不在）
    await act(async () => {
      for (const cb of onChangeListeners) cb({ 'octane-derived-key': { newValue: 'k' } }, 'session');
    });
    await waitFor(() => expect(getContextsRaw).toHaveBeenCalledTimes(2));
    expect(getContexts).not.toHaveBeenCalled(); // 仍不泄露
    expect(result.current.contexts[0]!.content).toBe(''); // 占位未解密

    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('抛错 → error', async () => {
    (getContextsRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('读取失败'));
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.contexts).toEqual([]);
  });

  it('bookmarkId 变化 → 重拉', async () => {
    (getContextsRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeContext({ id: 'c1', content: 'A' })])
      .mockResolvedValueOnce([makeContext({ id: 'c2', content: 'B' })]);
    const { result, rerender } = renderHook(
      ({ id }) => useEncryptedContexts(id, false, 1),
      { initialProps: { id: 'bm-1' } },
    );
    await waitFor(() => expect(result.current.contexts).toHaveLength(1));
    rerender({ id: 'bm-2' });
    await waitFor(() => expect(result.current.contexts[0]!.content).toBe('B'));
  });

  it('contextCount 变化 → 重拉', async () => {
    (getContextsRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeContext({ id: 'c1' })])
      .mockResolvedValueOnce([makeContext({ id: 'c1' }), makeContext({ id: 'c2' })]);
    const { result, rerender } = renderHook(
      ({ count }) => useEncryptedContexts('bm-1', false, count),
      { initialProps: { count: 1 } },
    );
    await waitFor(() => expect(result.current.contexts).toHaveLength(1));
    rerender({ count: 2 });
    await waitFor(() => expect(result.current.contexts).toHaveLength(2));
  });

  /** 安装 chrome.storage.onChanged 内存 mock */
  function installOnChanged() {
    const listeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];
    (globalThis as Record<string, unknown>).chrome = {
      storage: {
        onChanged: {
          addListener: (cb: (c: Record<string, unknown>, a: string) => void) => listeners.push(cb),
          removeListener: (cb: (c: Record<string, unknown>, a: string) => void) => {
            const i = listeners.indexOf(cb);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
      },
    };
    return {
      fireAsync: async (changes: Record<string, unknown>, area: string) => {
        await act(async () => {
          for (const cb of listeners) cb(changes, area);
        });
      },
      count: () => listeners.length,
    };
  }

  it('onChanged unlock-sidepanel（sidepanel 解锁）→ 重查 isUnlocked + 切换 getContexts 解密', async () => {
    (getContextsRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeContext({ id: 'c1', content: '', isEncrypted: true }),
    ]);
    const onChanged = installOnChanged();
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.contexts[0]!.content).toBe(''));

    // sidepanel 解锁：isUnlocked 现在返回 true → getContexts 解密
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeContext({ id: 'c1', content: '解密明文', isEncrypted: true }),
    ]);
    await onChanged.fireAsync({ 'octane-unlock-sidepanel': { newValue: true } }, 'session');
    await waitFor(() => expect(result.current.contexts[0]!.content).toBe('解密明文'));
    expect(getContexts).toHaveBeenCalled();

    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('onChanged 忽略 visibility key（失焦/聚焦不触发重拉）', async () => {
    (getContextsRaw as ReturnType<typeof vi.fn>).mockResolvedValue([makeContext({ id: 'c1' })]);
    const onChanged = installOnChanged();
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.contexts).toHaveLength(1));
    const before = (getContextsRaw as ReturnType<typeof vi.fn>).mock.calls.length;
    await onChanged.fireAsync(
      { 'octane-unlock-visibility-sidepanel': { newValue: { hiddenAt: 1 } } },
      'session',
    );
    expect((getContextsRaw as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('onChanged 卸载时移除监听', async () => {
    (getContextsRaw as ReturnType<typeof vi.fn>).mockResolvedValue([makeContext({ id: 'c1' })]);
    const onChanged = installOnChanged();
    const { unmount } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    expect(onChanged.count()).toBe(1);
    unmount();
    expect(onChanged.count()).toBe(0);
    delete (globalThis as Record<string, unknown>).chrome;
  });
});
