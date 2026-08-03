import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocalToday } from '../useLocalToday';

describe('useLocalToday — 本地日期刷新', () => {
  afterEach(() => vi.useRealTimers());

  it('跨本地午夜 → 返回下一天', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 23, 59, 59, 900));
    const { result } = renderHook(() => useLocalToday());

    expect(result.current).toBe('2026-08-03');
    act(() => vi.advanceTimersByTime(100));

    expect(result.current).toBe('2026-08-04');
  });

  it('页面重新可见 → 重新读取本地日期', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 3, 12));
    const { result } = renderHook(() => useLocalToday());
    vi.setSystemTime(new Date(2026, 7, 4, 12));

    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(result.current).toBe('2026-08-04');
  });
});
