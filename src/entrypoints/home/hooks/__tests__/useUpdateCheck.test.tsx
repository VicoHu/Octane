import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UPDATE_CHECK_DELAY_MS,
  resolveUpdateCheckResult,
  useUpdateCheck,
} from '../useUpdateCheck';

function setupChrome() {
  const requestUpdateCheck = vi.fn().mockResolvedValue({ status: 'no_update' });
  (globalThis as { chrome?: Record<string, unknown> }).chrome = {
    runtime: { requestUpdateCheck },
  };
  return { requestUpdateCheck };
}

afterEach(() => vi.useRealTimers());

describe('共享更新检测逻辑', () => {
  it('待装版本存在时返回发现新版本结果', () => {
    expect(resolveUpdateCheckResult('cws', '0.1.14.0')).toEqual({
      type: 'update-available',
      version: '0.1.14.0',
    });
  });

  it('无待装版本时返回已是最新结果', () => {
    expect(resolveUpdateCheckResult('edge', null)).toEqual({ type: 'up-to-date' });
  });

  it('manual 渠道返回 Releases 引导结果', () => {
    expect(resolveUpdateCheckResult('manual', null)).toEqual({ type: 'manual' });
  });

  it('商店渠道尽力触发检查，延迟后读取最新待装版本', async () => {
    vi.useFakeTimers();
    const { requestUpdateCheck } = setupChrome();
    const { result, rerender } = renderHook(
      ({ pendingVersion }) => useUpdateCheck('cws', pendingVersion),
      { initialProps: { pendingVersion: null as string | null } },
    );

    let checking!: Promise<ReturnType<typeof resolveUpdateCheckResult>>;
    act(() => {
      checking = result.current.checkForUpdate();
    });
    expect(result.current.checking).toBe(true);
    expect(requestUpdateCheck).toHaveBeenCalledOnce();

    rerender({ pendingVersion: '0.1.14.0' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS);
    });

    await expect(checking).resolves.toEqual({
      type: 'update-available',
      version: '0.1.14.0',
    });
    expect(result.current.checking).toBe(false);
  });

  it('manual 渠道不调用商店检查 API', async () => {
    const { requestUpdateCheck } = setupChrome();
    const { result } = renderHook(() => useUpdateCheck('manual', null));

    await expect(result.current.checkForUpdate()).resolves.toEqual({ type: 'manual' });
    expect(requestUpdateCheck).not.toHaveBeenCalled();
  });
});
