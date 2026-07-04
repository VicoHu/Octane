import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookmarkFaviconPreview } from '@/newtab/components/BookmarkFaviconPreview';
import * as FaviconService from '@/services/FaviconService';
import { resetDB } from '@/shared/db/database';

// partial mock Toast（项目规范：仅 mock Toast，真实渲染其余 Semi 组件）
vi.mock('@douyinfe/semi-ui', async () => {
  const actual = await vi.importActual<typeof import('@douyinfe/semi-ui')>('@douyinfe/semi-ui');
  return { ...actual, Toast: { error: vi.fn(), success: vi.fn() } };
});

vi.mock('@/newtab/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => ({ kind: 'blob', src: 'blob:mock' })),
}));
import { useFavicon } from '@/newtab/hooks/useFavicon';

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
    vi.mocked(useFavicon).mockReturnValue({ kind: 'blob', src: 'blob:old' });
    const newBlob = new Blob(['new-bytes']);
    const refreshSpy = vi
      .spyOn(FaviconService, 'refreshFavicon')
      .mockResolvedValue(newBlob);
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

  it('刷新失败 → Toast.error 提示，预览保持原样', async () => {
    vi.mocked(useFavicon).mockReturnValue({ kind: 'blob', src: 'blob:keep' });
    vi.spyOn(FaviconService, 'refreshFavicon').mockResolvedValue(null);
    const { Toast } = await import('@douyinfe/semi-ui');
    render(<BookmarkFaviconPreview url="https://github.com" />);
    await userEvent.click(screen.getByRole('button', { name: '刷新 favicon' }));
    expect(vi.mocked(Toast.error)).toHaveBeenCalled();
  });

  it('URL 非法 → 刷新按钮 disabled', () => {
    render(<BookmarkFaviconPreview url="not-a-url" />);
    expect(screen.getByRole('button', { name: '刷新 favicon' })).toBeDisabled();
  });
});
