import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookmarkFaviconPreview } from '@/components/BookmarkFaviconPreview';
import * as FaviconService from '@/services/FaviconService';
import { resetDB } from '@/shared/db/database';

// partial mock Toast（项目规范：仅 mock Toast，真实渲染其余 Semi 组件）
vi.mock('@douyinfe/semi-ui', async () => {
  const actual = await vi.importActual<typeof import('@douyinfe/semi-ui')>('@douyinfe/semi-ui');
  return { ...actual, Toast: { error: vi.fn(), success: vi.fn() } };
});

vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => ({ kind: 'third-party', src: 'blob:mock', onError: vi.fn() })),
}));
import { useFavicon } from '@/hooks/useFavicon';


function refreshResult(blob: Blob, cacheId = 'cache-new') {
  return {
    hostname: 'github.com',
    source: 'icon-horse' as const,
    blob,
    width: 64,
    height: 64,
    cacheId,
  };
}

beforeEach(async () => {
  resetDB();
  vi.clearAllMocks();
});

describe('BookmarkFaviconPreview', () => {
  it('渲染 favicon 图标 + 刷新按钮', () => {
    render(<BookmarkFaviconPreview url="https://github.com" />);
    expect(screen.getByRole('button', { name: '刷新 favicon' })).toBeInTheDocument();
  });

  it('点击刷新 → 调 refreshFavicon，成功后刷新预览', async () => {
    vi.mocked(useFavicon).mockReturnValue({ kind: 'third-party', src: 'blob:old', onError: vi.fn() });
    const newBlob = new Blob(['new-bytes']);
    const refreshSpy = vi
      .spyOn(FaviconService, 'refreshFavicon')
      .mockResolvedValue(refreshResult(newBlob));
    const createURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:new-override');
    render(<BookmarkFaviconPreview url="https://github.com" />);
    const img = document.querySelector('img')!;
    expect(img.src).toBe('blob:old');
    await userEvent.click(screen.getByRole('button', { name: '刷新 favicon' }));
    expect(refreshSpy).toHaveBeenCalledWith('https://github.com');
    expect(createURLSpy).toHaveBeenCalledWith(newBlob);
    expect(img.src).toBe('blob:new-override');
  });

  it('刷新 A 未完成时 URL 切到 B，迟到结果不得覆盖 B 的图标', async () => {
    let resolveRefresh!: (result: ReturnType<typeof refreshResult> | null) => void;
    vi.spyOn(FaviconService, 'refreshFavicon').mockReturnValue(
      new Promise((resolve) => { resolveRefresh = resolve; }),
    );
    vi.mocked(useFavicon).mockImplementation((currentUrl) => ({
      kind: 'chrome',
      src: `chrome:${currentUrl}`,
      onError: vi.fn(),
    }));
    const createURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late-a');
    const view = render(<BookmarkFaviconPreview url="https://a.example" />);

    await userEvent.click(screen.getByRole('button', { name: '刷新 favicon' }));
    view.rerender(<BookmarkFaviconPreview url="https://b.example" />);
    await act(async () => resolveRefresh(refreshResult(new Blob(['a-icon']))));

    await waitFor(() => expect(screen.getByAltText('').getAttribute('src')).toBe('chrome:https://b.example'));
    expect(createURLSpy).not.toHaveBeenCalled();
  });

  it('组件卸载后刷新才返回，不创建无法回收的 Object URL', async () => {
    let resolveRefresh!: (result: ReturnType<typeof refreshResult> | null) => void;
    vi.spyOn(FaviconService, 'refreshFavicon').mockReturnValue(
      new Promise((resolve) => { resolveRefresh = resolve; }),
    );
    const createURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late-unmount');
    const view = render(<BookmarkFaviconPreview url="https://a.example" />);

    await userEvent.click(screen.getByRole('button', { name: '刷新 favicon' }));
    view.unmount();
    await act(async () => resolveRefresh(refreshResult(new Blob(['a-icon']))));

    expect(createURLSpy).not.toHaveBeenCalled();
  });

  it('刷新失败 → Toast.error 提示，预览保持原样', async () => {
    vi.mocked(useFavicon).mockReturnValue({ kind: 'third-party', src: 'blob:keep', onError: vi.fn() });
    vi.spyOn(FaviconService, 'refreshFavicon').mockResolvedValue(null);
    const { Toast } = await import('@douyinfe/semi-ui');
    render(<BookmarkFaviconPreview url="https://github.com" />);
    await userEvent.click(screen.getByRole('button', { name: '刷新 favicon' }));
    expect(vi.mocked(Toast.error)).toHaveBeenCalled();
  });


  it('手动刷新图标加载失败时删除已写入的第三方缓存', async () => {
    vi.spyOn(FaviconService, 'refreshFavicon').mockResolvedValue(refreshResult(new Blob(['broken']), 'cache-broken'));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:broken-override');
    const invalidateSpy = vi.spyOn(FaviconService, 'invalidateFavicon').mockResolvedValue();
    render(<BookmarkFaviconPreview url="https://github.com/path" />);

    await userEvent.click(screen.getByRole('button', { name: '刷新 favicon' }));
    fireEvent.error(screen.getByAltText(''));

    expect(invalidateSpy).toHaveBeenCalledWith('github.com', 'cache-broken');
  });

  it('图片加载失败调用 hook onError', () => {
    const onError = vi.fn();
    vi.mocked(useFavicon).mockReturnValue({ kind: 'chrome', src: 'chrome-url', onError });
    render(<BookmarkFaviconPreview url="https://github.com" />);
    fireEvent.error(screen.getByAltText(''));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('URL 非法 → 刷新按钮 disabled', () => {
    render(<BookmarkFaviconPreview url="not-a-url" />);
    expect(screen.getByRole('button', { name: '刷新 favicon' })).toBeDisabled();
  });
});
