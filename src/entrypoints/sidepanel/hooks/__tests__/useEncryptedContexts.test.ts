import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('@/services/ContextService', () => ({
  getContexts: vi.fn(),
}));

import { useEncryptedContexts } from '../useEncryptedContexts';
import { getContexts } from '@/services/ContextService';
import type { Context } from '@/shared/types';
import { ContextType } from '@/shared/types';

/** 上下文测试工厂：补全必填字段，允许按用例覆盖 */
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

describe('useEncryptedContexts — 上下文级粒度', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('挂载 → 调 getContexts 拉取并填充 contexts', async () => {
    const ctxs = [makeContext({ id: 'c1', content: '明文' })];
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue(ctxs);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', false, 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getContexts).toHaveBeenCalledWith('bm-1');
    expect(result.current.contexts).toEqual(ctxs);
    expect(result.current.error).toBeNull();
  });

  it('getContexts 抛错 → error，明文不泄露', async () => {
    (getContexts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('读取失败'));
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.contexts).toEqual([]);
  });

  it('含未解锁密文（getContexts 返回占位）→ contexts 仍含该条（ContextCard 渲染锁占位）', async () => {
    // getContexts 容错：密文未解锁返回 content='' 占位
    const ctxs = [
      makeContext({ id: 'c1', content: '明文' }),
      makeContext({ id: 'c2', content: '', isEncrypted: true }),
    ];
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue(ctxs);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contexts).toHaveLength(2);
    expect(result.current.contexts[1]!.isEncrypted).toBe(true);
  });

  it('bookmarkId 变化 → 重拉', async () => {
    (getContexts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeContext({ id: 'c1', content: 'A' })])
      .mockResolvedValueOnce([makeContext({ id: 'c2', content: 'B' })]);
    const { result, rerender } = renderHook(
      ({ id }) => useEncryptedContexts(id, false, 1),
      { initialProps: { id: 'bm-1' } },
    );
    await waitFor(() => expect(result.current.contexts).toHaveLength(1));
    rerender({ id: 'bm-2' });
    await waitFor(() => expect(result.current.contexts[0]!.content).toBe('B'));
    expect(getContexts).toHaveBeenLastCalledWith('bm-2');
  });

  it('contextCount 变化 → 重拉（捕获就地新建上下文）', async () => {
    (getContexts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeContext({ id: 'c1', content: '第一条' })])
      .mockResolvedValueOnce([
        makeContext({ id: 'c1', content: '第一条' }),
        makeContext({ id: 'c2', content: '新建' }),
      ]);
    const { result, rerender } = renderHook(
      ({ count }) => useEncryptedContexts('bm-1', false, count),
      { initialProps: { count: 1 } },
    );
    await waitFor(() => expect(result.current.contexts).toHaveLength(1));
    rerender({ count: 2 });
    await waitFor(() => expect(result.current.contexts).toHaveLength(2));
    expect(getContexts).toHaveBeenCalledTimes(2);
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

  it('onChanged 感知解锁标记变化 → 重拉 contexts（占位→明文）', async () => {
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeContext({ id: 'c1', content: '', isEncrypted: true }), // 占位
    ]);
    const onChanged = installOnChanged();
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.contexts[0]!.content).toBe(''));

    // 解锁后重拉 → 明文
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeContext({ id: 'c1', content: '解密明文', isEncrypted: true }),
    ]);
    await onChanged.fireAsync({ 'octane-unlock-sidepanel': { newValue: true } }, 'session');
    await waitFor(() => expect(result.current.contexts[0]!.content).toBe('解密明文'));

    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('onChanged 感知 derived-key 变化（home lock）→ 重拉', async () => {
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue([makeContext({ id: 'c1' })]);
    const onChanged = installOnChanged();
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.contexts).toHaveLength(1));
    const callsBefore = (getContexts as ReturnType<typeof vi.fn>).mock.calls.length;

    await onChanged.fireAsync({ 'octane-derived-key': { oldValue: 'k' } }, 'session');
    await waitFor(() =>
      expect((getContexts as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore),
    );

    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('onChanged 忽略 visibility key（失焦/聚焦不触发重拉，止闪烁）', async () => {
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue([makeContext({ id: 'c1' })]);
    const onChanged = installOnChanged();
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.contexts).toHaveLength(1));
    const callsBefore = (getContexts as ReturnType<typeof vi.fn>).mock.calls.length;

    await onChanged.fireAsync(
      { 'octane-unlock-visibility-sidepanel': { newValue: { hiddenAt: 1 } } },
      'session',
    );
    expect((getContexts as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);

    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('onChanged 卸载时移除监听', async () => {
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue([makeContext({ id: 'c1' })]);
    const onChanged = installOnChanged();
    const { unmount } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    expect(onChanged.count()).toBe(1);
    unmount();
    expect(onChanged.count()).toBe(0);
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('解锁重拉（onChanged）保留上次 contexts，不闪骨架（loading 不回 true）', async () => {
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue([makeContext({ id: 'c1', content: '占位' })]);
    const onChanged = installOnChanged();
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contexts).toHaveLength(1);

    // 模拟重拉期间 contexts 不被清空、loading 不回 true
    let resolveRetry!: (v: Context[]) => void;
    (getContexts as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<Context[]>((r) => {
        resolveRetry = r;
      }),
    );
    await onChanged.fireAsync({ 'octane-unlock-sidepanel': { newValue: true } }, 'session');
    await new Promise((r) => setTimeout(r, 0));
    // 重拉进行中：contexts 保留、loading 不回 true
    expect(result.current.contexts).toHaveLength(1);
    expect(result.current.loading).toBe(false);

    resolveRetry([makeContext({ id: 'c1', content: '明文' })]);
    await waitFor(() => expect(result.current.contexts[0]!.content).toBe('明文'));

    delete (globalThis as Record<string, unknown>).chrome;
  });
});
