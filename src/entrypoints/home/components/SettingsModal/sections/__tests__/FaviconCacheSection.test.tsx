import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FaviconCacheSection } from '../FaviconCacheSection';

vi.mock('@/services/FaviconService', () => ({
  clearAllFavicons: vi.fn(),
}));
import { clearAllFavicons } from '@/services/FaviconService';

// mock Toast 副作用边界（仅 Toast，其余 ui 真实渲染）
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), close: vi.fn() },
}));

describe('FaviconCacheSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染清空按钮与说明', () => {
    render(<FaviconCacheSection />);
    expect(screen.getByRole('button', { name: '清空 favicon 缓存' })).toBeInTheDocument();
    expect(screen.getByText(/仅清除第三方高清图标缓存/)).toBeInTheDocument();
    expect(screen.getByText(/浏览器本地图标仍可立即显示/)).toBeInTheDocument();
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
    const { Toast } = await import('@/components/ui/toast');
    expect(vi.mocked(Toast.success)).toHaveBeenCalledWith('已清空第三方 favicon 缓存，将在后台重新获取高清图标');
  });

  it('clearAllFavicons 失败 → Toast.error', async () => {
    vi.mocked(clearAllFavicons).mockRejectedValue(new Error('db error'));
    const user = userEvent.setup();
    render(<FaviconCacheSection />);
    await user.click(screen.getByRole('button', { name: '清空 favicon 缓存' }));
    const ok = await screen.findByRole('button', { name: '确定' });
    await user.click(ok);
    const { Toast } = await import('@/components/ui/toast');
    await vi.waitFor(() => {
      expect(vi.mocked(Toast.error)).toHaveBeenCalledWith('清空失败，请重试');
    });
  });
});
