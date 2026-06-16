import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/services/CryptoService', () => ({
  isUnlocked: vi.fn(),
}));
vi.mock('@/services/ContextService', () => ({
  getContexts: vi.fn(),
}));

import { useEncryptedContexts } from '../useEncryptedContexts';
import { isUnlocked } from '@/services/CryptoService';
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

describe('useEncryptedContexts — 加密上下文解锁 gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未加密 context + 未解锁 → 不 gate，直接读取并显示（bug 复现）', async () => {
    // isUnlocked=false（从未解锁），但书签不含加密 context → 不应 locked
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const ctxs = [makeContext({ id: 'c1', isEncrypted: false, content: '明文' })];
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue(ctxs);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(false);
    expect(getContexts).toHaveBeenCalledWith('bm-1');
    expect(result.current.contexts).toEqual(ctxs);
  });

  it('含加密 context + 未解锁 → locked=true，不调用 getContexts（不预渲染明文）', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(true);
    expect(getContexts).not.toHaveBeenCalled();
  });

  it('已解锁 → getContexts 解密成功 → 返回明文上下文', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const ctxs = [makeContext({ id: 'c1', content: '解密明文' }), makeContext({ id: 'c2' })];
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue(ctxs);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.contexts).toEqual(ctxs);
  });

  it('getContexts 解密失败（密码错误）→ error，明文不泄露', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getContexts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('密钥不可用'));
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(result.current.contexts).toEqual([]);
  });

  it('bookmarkId 变化时丢弃过期结果（前一次异步未完成的结果不覆盖新结果）', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    // 第一次 query 挂起（模拟慢异步），第二次立即返回
    let resolveFirst!: (v: Context[]) => void;
    (getContexts as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(new Promise<Context[]>((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce([makeContext({ id: 'c-new', content: '新书签的上下文' })]);

    const { result, rerender } = renderHook(({ id }) => useEncryptedContexts(id, true), { initialProps: { id: 'bm-1' } });
    // 第一次 effect 已发起挂起的 getContexts('bm-1')
    await new Promise((r) => setTimeout(r, 10));

    // 切换 bookmarkId → 触发新 effect，前一个 active flag 置 false
    rerender({ id: 'bm-2' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contexts).toHaveLength(1);
    expect(result.current.contexts[0]!.id).toBe('c-new');

    // 前一次的慢异步现在 resolve → 应被丢弃，不覆盖 bm-2 的结果
    resolveFirst([makeContext({ id: 'c-stale', content: '过期内容' })]);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.contexts[0]!.id).toBe('c-new');
  });
});
