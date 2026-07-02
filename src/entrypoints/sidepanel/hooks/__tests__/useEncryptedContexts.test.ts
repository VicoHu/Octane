import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/services/UnlockSession', () => ({
  isUnlocked: vi.fn(),
}));
vi.mock('@/services/ContextService', () => ({
  getContexts: vi.fn(),
}));

import { useEncryptedContexts } from '../useEncryptedContexts';
import { isUnlocked } from '@/services/UnlockSession';
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

  it('切断联动：sidepanel surface 未解锁 → locked（即使 home 已解锁，不读全局 key）', async () => {
    // home 已解锁（octane-derived-key 在）但 sidepanel surface 未解锁 →
    // hook 必须读 UnlockSession.isUnlocked('sidepanel')，与 home 解锁态物理隔离。
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(true);
    expect(getContexts).not.toHaveBeenCalled();
    // 契约：hook 必须按 sidepanel surface 查询，而非无参全局 isUnlocked()
    expect(isUnlocked).toHaveBeenCalledWith('sidepanel');
  });

  it('未加密 context + 未解锁 → 不 gate，直接读取并显示（bug 复现）', async () => {
    // isUnlocked=false（从未解锁），但书签不含加密 context → 不应 locked
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const ctxs = [makeContext({ id: 'c1', isEncrypted: false, content: '明文' })];
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue(ctxs);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', false, 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(false);
    expect(getContexts).toHaveBeenCalledWith('bm-1');
    expect(result.current.contexts).toEqual(ctxs);
  });

  it('含加密 context + 未解锁 → locked=true，不调用 getContexts（不预渲染明文）', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(true);
    expect(getContexts).not.toHaveBeenCalled();
  });

  it('已解锁 → getContexts 解密成功 → 返回明文上下文', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const ctxs = [makeContext({ id: 'c1', content: '解密明文' }), makeContext({ id: 'c2' })];
    (getContexts as ReturnType<typeof vi.fn>).mockResolvedValue(ctxs);
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.locked).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.contexts).toEqual(ctxs);
  });

  it('getContexts 解密失败（密码错误）→ error，明文不泄露', async () => {
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getContexts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('密钥不可用'));
    const { result } = renderHook(() => useEncryptedContexts('bm-1', true, 1));
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

    const { result, rerender } = renderHook(({ id }) => useEncryptedContexts(id, true, 1), { initialProps: { id: 'bm-1' } });
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

  it('contextCount 变化（未加密新建上下文）→ 重新拉取，新上下文出现（R3 回归）', async () => {
    // 复现预存 bug：就地创建一条未加密上下文后，bookmark.contextCount 1→2，
    // 但 bookmarkId / hasEncryptedContext 不变 → 若 contextCount 不在依赖里，effect 不重跑，新卡不出现。
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getContexts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeContext({ id: 'c1', content: '第一条' })])
      .mockResolvedValueOnce([
        makeContext({ id: 'c1', content: '第一条' }),
        makeContext({ id: 'c2', content: '新建的第二条' }),
      ]);

    const { result, rerender } = renderHook(
      ({ count }) => useEncryptedContexts('bm-1', false, count),
      { initialProps: { count: 1 } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.contexts).toHaveLength(1);

    // 模拟就地创建后 bookmark.contextCount 变化（hasEncryptedContext 仍为 false）
    rerender({ count: 2 });
    await waitFor(() => expect(result.current.contexts).toHaveLength(2));
    expect(getContexts).toHaveBeenCalledTimes(2);
    expect(result.current.contexts.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('T10 解锁窗口内就地新增加密上下文（contextCount+1）→ 重拉解密可见', async () => {
    // hasEncryptedContext=true 且已解锁：就地新增一条加密上下文后 contextCount 1→2，
    // bookmarkId/hasEncryptedContext 不变 → contextCount 在依赖里触发重拉，新加密上下文解密可见。
    (isUnlocked as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (getContexts as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeContext({ id: 'c1', isEncrypted: true, content: '加密1' })])
      .mockResolvedValueOnce([
        makeContext({ id: 'c1', isEncrypted: true, content: '加密1' }),
        makeContext({ id: 'c2', isEncrypted: true, content: '新加密2' }),
      ]);

    const { result, rerender } = renderHook(
      ({ count }) => useEncryptedContexts('bm-1', true, count),
      { initialProps: { count: 1 } },
    );
    await waitFor(() => expect(result.current.contexts).toHaveLength(1));
    expect(result.current.locked).toBe(false);

    // 模拟就地创建加密上下文后 bookmark.contextCount 变化
    rerender({ count: 2 });
    await waitFor(() => expect(result.current.contexts).toHaveLength(2));
    expect(getContexts).toHaveBeenCalledTimes(2);
    expect(result.current.contexts.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
