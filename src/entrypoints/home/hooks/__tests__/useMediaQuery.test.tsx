import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from '../useMediaQuery';

interface TestMediaQueryList {
  matches: boolean;
  addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => void;
  setMatches: (next: boolean) => void;
}

function createMediaQueryList(matches: boolean): TestMediaQueryList {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  return {
    matches,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    setMatches(next: boolean) {
      this.matches = next;
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
    },
  };
}

describe('useMediaQuery — TodoPage 断点', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it.each([
    [760, true],
    [761, false],
  ])('%ipx 在移动端查询中为 %s', (width, expected) => {
    const mediaQueryList = createMediaQueryList(expected);
    vi.stubGlobal('matchMedia', vi.fn((query: string) => {
      expect(query).toBe('max-width:760px');
      return mediaQueryList as unknown as MediaQueryList;
    }));

    const { result } = renderHook(() => useMediaQuery('max-width:760px'));
    expect(result.current).toBe(expected);
    expect(width <= 760).toBe(expected);
  });

  it.each([
    [1199, false],
    [1200, true],
  ])('%ipx 在宽桌面查询中为 %s', (width, expected) => {
    const mediaQueryList = createMediaQueryList(expected);
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQueryList as unknown as MediaQueryList));

    const { result } = renderHook(() => useMediaQuery('min-width:1200px'));
    expect(result.current).toBe(expected);
    expect(width >= 1200).toBe(expected);

    act(() => mediaQueryList.setMatches(!expected));
    expect(result.current).toBe(!expected);
  });
});
