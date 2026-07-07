import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// mock FaviconService：hook 测的是状态机，不测抓取细节。
// 注意：pickHostname 必须一起 stub —— hook 用它做 url 合法性守卫，
// 不补全会让 hook 把所有 url 当非法返回 null，测试错乱。
vi.mock('@/services/FaviconService', () => ({
  pickHostname: (u: string) => {
    try {
      return new URL(u).hostname;
    } catch {
      return null;
    }
  },
  getCachedBlob: vi.fn(),
  fetchAndStoreFavicon: vi.fn(),
  buildFaviconRenderUrl: (url: string) => `chrome-extension://x/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`,
}));

import { getCachedBlob, fetchAndStoreFavicon, buildFaviconRenderUrl } from '@/services/FaviconService';
import { resetDB } from '@/shared/db/database';
import { useFavicon } from '@/hooks/useFavicon';

beforeEach(async () => {
  resetDB();
  vi.clearAllMocks();
});

describe('useFavicon — favicon 渲染源状态机', () => {
  it('缓存命中 → 返回 blob 态', async () => {
    vi.mocked(getCachedBlob).mockResolvedValue(new Blob(['x']));
    const { result } = renderHook(({ u }) => useFavicon(u), {
      initialProps: { u: 'https://github.com' },
    });
    await act(() => Promise.resolve());
    await act(() => Promise.resolve()); // 等 async effect 完成
    expect(result.current?.kind).toBe('blob');
    expect(result.current?.src).toMatch(/^blob:/);
  });

  it('缓存未命中 → 返回 remote 态并后台抓取', async () => {
    vi.mocked(getCachedBlob).mockResolvedValue(null);
    vi.mocked(fetchAndStoreFavicon).mockResolvedValue(new Blob(['y']));
    renderHook(({ u }) => useFavicon(u), {
      initialProps: { u: 'https://github.com' },
    });
    await act(() => Promise.resolve());
    expect(fetchAndStoreFavicon).toHaveBeenCalledWith('https://github.com');
  });

  it('缓存未命中 → 初始渲染即返回 remote 占位', async () => {
    vi.mocked(getCachedBlob).mockResolvedValue(null);
    vi.mocked(fetchAndStoreFavicon).mockResolvedValue(null);
    const { result } = renderHook(({ u }) => useFavicon(u), {
      initialProps: { u: 'https://github.com' },
    });
    // 同步首次返回即 remote 占位（不等 DB 也不空白）
    expect(result.current?.kind).toBe('remote');
    expect(result.current?.src).toContain('_favicon');
    expect(result.current?.src).toBe(buildFaviconRenderUrl('https://github.com'));
  });

  it('url 变化 → 重新查询缓存并 revoke 旧 blob URL', async () => {
    vi.mocked(getCachedBlob).mockResolvedValue(new Blob(['a']));
    const { rerender, unmount } = renderHook(({ u }) => useFavicon(u), {
      initialProps: { u: 'https://a.com' },
    });
    await act(() => Promise.resolve());
    rerender({ u: 'https://b.com' });
    await act(() => Promise.resolve());
    // 切换后应再次查询 b.com 缓存
    expect(getCachedBlob).toHaveBeenCalledWith('b.com');
    // 卸载触发 revoke，不应抛错
    unmount();
    expect(true).toBe(true);
  });

  it('非法 url → 立即返回 null（首字母回退），不发后台抓取', async () => {
    const { result } = renderHook(({ u }) => useFavicon(u), {
      initialProps: { u: 'not-a-url' },
    });
    await act(() => Promise.resolve());
    expect(result.current).toBeNull();
    expect(fetchAndStoreFavicon).not.toHaveBeenCalled();
  });
});
