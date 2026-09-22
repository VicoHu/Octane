import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Toast 涉及 portal + 全局副作用，mock 为副作用边界。
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), close: vi.fn() },
}));
// unlock 副作用边界：PBKDF2 派生 + verifier 校验，mock 隔离。
vi.mock('@/services/UnlockSession', () => ({
  unlock: vi.fn(),
  unlockWithPin: vi.fn(),
}));
// PIN 可用性探测副作用边界：读 IndexedDB + storage，mock 隔离。
vi.mock('@/services/CryptoService', () => ({
  isPinEnabled: vi.fn(async () => false),
  hasPinEnvelope: vi.fn(async () => false),
  getPinConfig: vi.fn(async () => null),
}));

import { SidePanelUnlockModal } from '../SidePanelUnlockModal';
import { unlock, unlockWithPin } from '@/services/UnlockSession';
import { isPinEnabled, hasPinEnvelope, getPinConfig } from '@/services/CryptoService';
import { Toast } from '@/components/ui/toast';

describe('SidePanelUnlockModal — sidepanel 解锁弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPinEnabled).mockResolvedValue(false);
    vi.mocked(hasPinEnvelope).mockResolvedValue(false);
    vi.mocked(getPinConfig).mockResolvedValue(null);
  });

  it('正确密码 → 调 unlock("sidepanel", pwd) + Toast 成功 + 关闭', async () => {
    const user = userEvent.setup();
    vi.mocked(unlock).mockResolvedValue(true);
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('输入主密码'), 'right-pwd');
    await user.click(screen.getByRole('button', { name: '解 锁' }));

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
    await user.click(screen.getByRole('button', { name: '解 锁' }));

    expect(await screen.findByText('密码错误')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('unlock 抛异常 → 显示异常信息，不关闭（catch 分支）', async () => {
    const user = userEvent.setup();
    vi.mocked(unlock).mockRejectedValue(new Error('网络错误'));
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('输入主密码'), 'any');
    await user.click(screen.getByRole('button', { name: '解 锁' }));

    expect(await screen.findByText('网络错误')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(Toast.success).not.toHaveBeenCalled();
  });
});

describe('SidePanelUnlockModal — 快速解锁 PIN（#96）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isPinEnabled).mockResolvedValue(true);
    vi.mocked(hasPinEnvelope).mockResolvedValue(true);
    // 默认 6 位数字形态:解锁弹窗渲染分格方框
    vi.mocked(getPinConfig).mockResolvedValue({
      salt: 's==', iterations: 600_000, persistEnvelope: false,
      format: 'digits-6', createdAt: 0,
    });
  });

  it('PIN 可用 → 默认显示 PIN 输入与主密码回退链接', async () => {
    render(<SidePanelUnlockModal open={true} onClose={vi.fn()} />);

    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用主密码解锁' })).toBeInTheDocument();
  });

  it('正确 PIN → 调 unlockWithPin("sidepanel", pin) + Toast 成功 + 关闭', async () => {
    const user = userEvent.setup();
    vi.mocked(unlockWithPin).mockResolvedValue(true);
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);

    await user.type(await screen.findByLabelText('PIN'), '1234');
    await user.click(screen.getByRole('button', { name: '解 锁' }));

    expect(unlockWithPin).toHaveBeenCalledWith('sidepanel', '1234');
    expect(Toast.success).toHaveBeenCalledWith('已解锁');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('错误 PIN → 显示熔断提示文案，不关闭', async () => {
    const user = userEvent.setup();
    vi.mocked(unlockWithPin).mockResolvedValue(false);
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);

    await user.type(await screen.findByLabelText('PIN'), '0000');
    await user.click(screen.getByRole('button', { name: '解 锁' }));

    expect(
      await screen.findByText('PIN 错误，连续错误 5 次将停用 PIN'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('PIN 失败后信封消失（熔断）→ 自动落回主密码输入', async () => {
    const user = userEvent.setup();
    vi.mocked(unlockWithPin).mockResolvedValue(false);
    vi.mocked(hasPinEnvelope)
      .mockResolvedValueOnce(true) // 打开时探测：可用
      .mockResolvedValueOnce(false); // 失败后重探：已熔断
    render(<SidePanelUnlockModal open={true} onClose={vi.fn()} />);

    await user.type(await screen.findByLabelText('PIN'), '0000');
    await user.click(screen.getByRole('button', { name: '解 锁' }));

    expect(await screen.findByPlaceholderText('输入主密码')).toBeInTheDocument();
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument();
  });

  it('PIN 探测抛异常（如无 IndexedDB 环境）→ 落回主密码，不炸进程', async () => {
    vi.mocked(isPinEnabled).mockRejectedValue(new Error('db unavailable'));
    render(<SidePanelUnlockModal open={true} onClose={vi.fn()} />);

    expect(await screen.findByPlaceholderText('输入主密码')).toBeInTheDocument();
  });
});
