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

  it('未解锁 → locked=true，不调用 getContexts（不预渲染明文）', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const { result } = renderHook(() => useEncryptedContexts('bm-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(true);
    expect(getContexts).not.toHaveBeenCalled();
  });

  it('已解锁 → getContexts 解密成功 → 返回明文上下文', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const ctxs = [makeContext({ id: 'c1', content: '解密明文' }), makeContext({ id: 'c2' })];
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue(ctxs);
    const { result } = renderHook(() => useEncryptedContexts('bm-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.contexts).toEqual(ctxs);
  });

  it('getContexts 解密失败（密码错误）→ error，明文不泄露', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getContexts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('密钥不可用'));
    const { result } = renderHook(() => useEncryptedContexts('bm-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(result.current.contexts).toEqual([]);
  });
});
