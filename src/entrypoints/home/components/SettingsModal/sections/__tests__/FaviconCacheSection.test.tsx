import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FaviconCacheSection } from '../FaviconCacheSection';

vi.mock('@/services/FaviconService', () => ({
  clearAllFavicons: vi.fn(),
}));
import { clearAllFavicons } from '@/services/FaviconService';

// partial mock Toast（仅 Toast，其余 Semi 真实渲染）
vi.mock('@douyinfe/semi-ui', async () => {
  const actual = await vi.importActual<typeof import('@douyinfe/semi-ui')>('@douyinfe/semi-ui');
  return { ...actual, Toast: { success: vi.fn(), error: vi.fn() } };
});

describe('FaviconCacheSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染清空按钮与说明', () => {
    render(<FaviconCacheSection />);
    expect(screen.getByRole('button', { name: '清空 favicon 缓存' })).toBeInTheDocument();
    expect(screen.getByText(/书签图标缓存在本地/)).toBeInTheDocument();
  });

  it('点击按钮 → 确认 → clearAllFavicons 调用 + Toast.success', async () => {
    vi.mocked(clearAllFavicons).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<FaviconCacheSection />);
    await user.click(screen.getByRole('button', { name: '清空 favicon 缓存' }));
    // Popconfirm 弹出，点确认按钮
    const ok = await screen.findByRole('button', { name: '确定' });
    await user.click(ok);
    expect(clearAllFavicons).toHaveBeenCalledTimes(1);
    const { Toast } = await import('@douyinfe/semi-ui');
    expect(vi.mocked(Toast.success)).toHaveBeenCalledWith('已清空 favicon 缓存，下次访问书签将重新抓取');
  });

  it('clearAllFavicons 失败 → Toast.error', async () => {
    vi.mocked(clearAllFavicons).mockRejectedValue(new Error('db error'));
    const user = userEvent.setup();
    render(<FaviconCacheSection />);
    await user.click(screen.getByRole('button', { name: '清空 favicon 缓存' }));
    const ok = await screen.findByRole('button', { name: '确定' });
    await user.click(ok);
    const { Toast } = await import('@douyinfe/semi-ui');
    await vi.waitFor(() => {
      expect(vi.mocked(Toast.error)).toHaveBeenCalledWith('清空失败，请重试');
    });
  });
});
