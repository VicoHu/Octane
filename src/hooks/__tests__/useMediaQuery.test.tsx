import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMediaQuery } from '@/hooks/useMediaQuery';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('订阅媒体查询变化并返回最新匹配状态', () => {
    let matches = false;
    let changeListener: EventListener | undefined;
    const mediaQueryList = {
      get matches() {
        return matches;
      },
      media: '(max-width: 767px)',
      onchange: null,
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        changeListener = listener;
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQueryList));

    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));

    expect(result.current).toBe(false);

    act(() => {
      matches = true;
      changeListener?.(new Event('change'));
    });

    expect(result.current).toBe(true);
  });
});
