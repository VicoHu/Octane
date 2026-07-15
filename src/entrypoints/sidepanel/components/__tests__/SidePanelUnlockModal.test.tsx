import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Toast 涉及 portal + 全局副作用，mock 为副作用边界。
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), close: vi.fn() },
}));
// unlock 副作用边界：PBKDF2 派生 + verifier 校验，mock 隔离。
vi.mock('@/services/UnlockSession', () => ({ unlock: vi.fn() }));

import { SidePanelUnlockModal } from '../SidePanelUnlockModal';
import { unlock } from '@/services/UnlockSession';
import { Toast } from '@/components/ui/toast';

describe('SidePanelUnlockModal — sidepanel 解锁弹窗', () => {
  beforeEach(() => vi.clearAllMocks());

  it('正确密码 → 调 unlock("sidepanel", pwd) + Toast 成功 + 关闭', async () => {
    const user = userEvent.setup();
    vi.mocked(unlock).mockResolvedValue(true);
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('输入主密码'), 'right-pwd');
    await user.click(screen.getByRole('button', { name: /解\s*锁/ }));

    expect(unlock).toHaveBeenCalledWith('sidepanel', 'right-pwd');
    expect(Toast.success).toHaveBeenCalledWith('已解锁');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('错误密码 → 显示「密码错误」，不关闭', async () => {
    const user = userEvent.setup();
    vi.mocked(unlock).mockResolvedValue(false);
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('输入主密码'), 'wrong');
    await user.click(screen.getByRole('button', { name: /解\s*锁/ }));

    expect(await screen.findByText('密码错误')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('unlock 抛异常 → 显示异常信息，不关闭（catch 分支）', async () => {
    const user = userEvent.setup();
    vi.mocked(unlock).mockRejectedValue(new Error('网络错误'));
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('输入主密码'), 'any');
    await user.click(screen.getByRole('button', { name: /解\s*锁/ }));

    expect(await screen.findByText('网络错误')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(Toast.success).not.toHaveBeenCalled();
  });
});
