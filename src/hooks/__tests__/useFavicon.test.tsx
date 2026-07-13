import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/FaviconService', () => ({
  pickHostname: (url: string) => {
    try { return new URL(url).hostname; } catch { return null; }
  },
  buildFaviconRenderUrl: (url: string) =>
    `chrome-extension://x/_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`,
  isPrivateFaviconTarget: vi.fn(() => false),
  getThirdPartyCache: vi.fn(),
  fetchBestThirdPartyFavicon: vi.fn(),
  invalidateFavicon: vi.fn(),
}));

import {
  fetchBestThirdPartyFavicon,
  getThirdPartyCache,
  invalidateFavicon,
  isPrivateFaviconTarget,
} from '@/services/FaviconService';
import { useFavicon } from '@/hooks/useFavicon';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPrivateFaviconTarget).mockReturnValue(false);
  vi.mocked(getThirdPartyCache).mockResolvedValue({
    blob: null,
    stale: false,
    canRefresh: true,
    record: undefined,
  });
  vi.mocked(fetchBestThirdPartyFavicon).mockResolvedValue(null);
  vi.mocked(invalidateFavicon).mockResolvedValue(undefined);
});

describe('useFavicon 异步升级状态机', () => {
  it('有 runtime favicon 时首帧立即返回 tab，不等待 DB', () => {
    const { result } = renderHook(() =>
      useFavicon('https://chatgpt.com', 'https://chatgpt.com/favicon.svg'),
    );

    expect(result.current?.kind).toBe('tab');
    expect(result.current?.src).toBe('https://chatgpt.com/favicon.svg');
  });

  it('没有 runtime favicon 时首帧返回 Chrome _favicon', () => {
    const { result } = renderHook(() => useFavicon('https://chatgpt.com'));
    expect(result.current?.kind).toBe('chrome');
    expect(result.current?.src).toContain('_favicon');
  });

  it('第三方缓存命中后切换 Blob', async () => {
    vi.mocked(getThirdPartyCache).mockResolvedValue({
      blob: new Blob(['cached'], { type: 'image/png' }),
      stale: false,
      canRefresh: false,
    });
    const { result } = renderHook(() => useFavicon('https://example.com'));

    await waitFor(() => expect(result.current?.kind).toBe('third-party'));
    expect(result.current?.src).toMatch(/^blob:/);
    expect(fetchBestThirdPartyFavicon).not.toHaveBeenCalled();
  });

  it('无缓存时先显示本地，后台成功后热切换第三方', async () => {
    vi.mocked(fetchBestThirdPartyFavicon).mockResolvedValue({
      hostname: 'example.com',
      source: 'icon-horse',
      blob: new Blob(['fresh'], { type: 'image/png' }),
      width: 64,
      height: 64,
    });
    const { result } = renderHook(() =>
      useFavicon('https://example.com', 'https://example.com/runtime.svg'),
    );

    expect(result.current?.kind).toBe('tab');
    await waitFor(() => expect(result.current?.kind).toBe('third-party'));
    expect(fetchBestThirdPartyFavicon).toHaveBeenCalledWith('https://example.com');
  });

  it('第三方失败时保持本地来源', async () => {
    const { result } = renderHook(() =>
      useFavicon('https://example.com', 'https://example.com/runtime.svg'),
    );

    await waitFor(() => expect(fetchBestThirdPartyFavicon).toHaveBeenCalled());
    expect(result.current?.kind).toBe('tab');
  });

  it('内网不读取第三方缓存也不抓取', async () => {
    vi.mocked(isPrivateFaviconTarget).mockReturnValue(true);
    const { result } = renderHook(() => useFavicon('http://192.168.1.2:3000'));

    await act(() => Promise.resolve());
    expect(result.current?.kind).toBe('chrome');
    expect(getThirdPartyCache).not.toHaveBeenCalled();
    expect(fetchBestThirdPartyFavicon).not.toHaveBeenCalled();
  });

  it('onError 按 third-party → tab → chrome → null 回退', async () => {
    vi.mocked(getThirdPartyCache).mockResolvedValue({
      blob: new Blob(['cached'], { type: 'image/png' }),
      stale: false,
      canRefresh: false,
    });
    const { result } = renderHook(() =>
      useFavicon('https://example.com', 'https://example.com/runtime.svg'),
    );
    await waitFor(() => expect(result.current?.kind).toBe('third-party'));

    act(() => result.current?.onError());
    expect(invalidateFavicon).toHaveBeenCalledWith('example.com');
    expect(result.current?.kind).toBe('tab');

    act(() => result.current?.onError());
    expect(result.current?.kind).toBe('chrome');

    act(() => result.current?.onError());
    expect(result.current).toBeNull();
  });

  it('浏览器稍后补充 runtime favicon 时从 Chrome 切到 tab', async () => {
    const { result, rerender } = renderHook(
      ({ runtime }) => useFavicon('https://example.com', runtime),
      { initialProps: { runtime: undefined as string | undefined } },
    );
    expect(result.current?.kind).toBe('chrome');

    rerender({ runtime: 'https://example.com/runtime.svg' });
    await waitFor(() => expect(result.current?.kind).toBe('tab'));
  });

  it('非法 URL 返回 null，不访问 DB/网络', async () => {
    const { result } = renderHook(() => useFavicon('not-a-url'));
    await act(() => Promise.resolve());
    expect(result.current).toBeNull();
    expect(getThirdPartyCache).not.toHaveBeenCalled();
    expect(fetchBestThirdPartyFavicon).not.toHaveBeenCalled();
  });

  it('卸载时 revoke 第三方 Blob URL', async () => {
    vi.mocked(getThirdPartyCache).mockResolvedValue({
      blob: new Blob(['cached'], { type: 'image/png' }),
      stale: false,
      canRefresh: false,
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { result, unmount } = renderHook(() => useFavicon('https://example.com'));
    await waitFor(() => expect(result.current?.kind).toBe('third-party'));
    const src = result.current!.src;

    unmount();
    expect(revoke).toHaveBeenCalledWith(src);
  });
});
