import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/services/UnlockSession', () => ({
  isUnlocked: vi.fn(() => Promise.resolve(false)),
  markHidden: vi.fn(() => Promise.resolve()),
  markVisible: vi.fn(() => Promise.resolve()),
}));

import { useSidePanelUnlockLifecycle } from '../useSidePanelUnlockLifecycle';
import { isUnlocked, markHidden, markVisible } from '@/services/UnlockSession';

describe('useSidePanelUnlockLifecycle — TTL 三路感知注册', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('setInterval 30s tick → 周期调 isUnlocked（hardCap 兜底，防一直盯着永不锁）', () => {
    renderHook(() => useSidePanelUnlockLifecycle());
    expect(isUnlocked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(isUnlocked).toHaveBeenCalledWith('sidepanel');
    vi.advanceTimersByTime(30_000);
    expect(isUnlocked).toHaveBeenCalledTimes(2);
  });

  it('document hidden 时 visibilitychange → markHidden', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    renderHook(() => useSidePanelUnlockLifecycle());
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(markHidden).toHaveBeenCalledWith('sidepanel');
  });

  it('document 可见时 visibilitychange → markVisible（重新计时 grace）', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    renderHook(() => useSidePanelUnlockLifecycle());
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(markVisible).toHaveBeenCalledWith('sidepanel');
  });

  it('window blur → markHidden；focus → markVisible', () => {
    renderHook(() => useSidePanelUnlockLifecycle());
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(markHidden).toHaveBeenCalledWith('sidepanel');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(markVisible).toHaveBeenCalledWith('sidepanel');
  });

  it('卸载时移除监听并清 interval（无泄漏）', () => {
    const { unmount } = renderHook(() => useSidePanelUnlockLifecycle());
    const before = (isUnlocked as ReturnType<typeof vi.fn>).mock.calls.length;
    unmount();
    vi.advanceTimersByTime(90_000); // 卸载后不应再触发 tick
    expect((isUnlocked as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });
});
