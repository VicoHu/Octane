import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { cryptoState } = vi.hoisted(() => ({
  cryptoState: {} as Record<string, unknown>,
}));

vi.mock('@/store/useCrypto', () => ({
  useCrypto: (selector: (state: Record<string, unknown>) => unknown) => selector(cryptoState),
}));

vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn() },
}));

import { UnlockModal } from '..';

describe('UnlockModal - 关闭规则', () => {
  beforeEach(() => {
    Object.assign(cryptoState, {
      passwordSet: true,
      unlocked: true,
      loading: false,
      unlockModalOpen: true,
      needsReset: false,
      setupMasterPassword: vi.fn(),
      unlockWithPassword: vi.fn(),
      resetPassword: vi.fn(),
      closeUnlockModal: vi.fn(),
    });
  });

  it('非强制重设且弹窗打开 -> 按 Escape 调用一次关闭', async () => {
    const user = userEvent.setup();
    render(<UnlockModal />);

    await user.keyboard('{Escape}');

    expect(cryptoState.closeUnlockModal).toHaveBeenCalledTimes(1);
  });

  it('强制重设 -> 按 Escape 不关闭且重设弹窗仍可见', async () => {
    const user = userEvent.setup();
    cryptoState.needsReset = true;
    cryptoState.unlockModalOpen = false;
    render(<UnlockModal />);

    await user.keyboard('{Escape}');

    expect(cryptoState.closeUnlockModal).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '重设主密码' })).toBeVisible();
  });
});

describe('UnlockModal - 快速解锁 PIN（#96）', () => {
  beforeEach(() => {
    Object.assign(cryptoState, {
      passwordSet: true,
      unlocked: false,
      loading: false,
      unlockModalOpen: false,
      needsReset: false,
      pinEnabled: true,
      pinEnvelopeAvailable: true,
      setupMasterPassword: vi.fn(),
      unlockWithPassword: vi.fn(),
      unlockWithPin: vi.fn(async () => {}),
      resetPassword: vi.fn(),
      closeUnlockModal: vi.fn(),
      refreshPinStatus: vi.fn(),
    });
  });

  it('PIN 启用且信封可用 -> 默认显示 PIN 输入与主密码回退链接', () => {
    render(<UnlockModal />);

    expect(screen.getByPlaceholderText('输入 PIN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用主密码解锁' })).toBeInTheDocument();
  });

  it('点击回退链接 -> 切换为主密码输入，且可切回 PIN', async () => {
    const user = userEvent.setup();
    render(<UnlockModal />);

    await user.click(screen.getByRole('button', { name: '使用主密码解锁' }));
    expect(screen.getByPlaceholderText('输入主密码')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '使用 PIN 快速解锁' }));
    expect(screen.getByPlaceholderText('输入 PIN')).toBeInTheDocument();
  });

  it('输入 PIN 提交 -> 调用 unlockWithPin 并 Toast 已解锁', async () => {
    const user = userEvent.setup();
    render(<UnlockModal />);

    await user.type(screen.getByPlaceholderText('输入 PIN'), '1234');
    await user.click(screen.getByRole('button', { name: '解锁' }));

    await waitFor(() => {
      expect(cryptoState.unlockWithPin).toHaveBeenCalledWith('1234');
    });
  });

  it('PIN 错误 -> 显示熔断提示并重探 PIN 可用性（熔断后自动落回主密码）', async () => {
    cryptoState.unlockWithPin = vi.fn(async () => {
      throw new Error('PIN 错误');
    });
    const user = userEvent.setup();
    render(<UnlockModal />);

    await user.type(screen.getByPlaceholderText('输入 PIN'), '0000');
    await user.click(screen.getByRole('button', { name: '解锁' }));

    expect(await screen.findByText('PIN 错误，连续错误 5 次将停用 PIN')).toBeInTheDocument();
    expect(cryptoState.unlockWithPassword).not.toHaveBeenCalled();
    // 熔断场景（持久信封不触发 session onChanged）必须主动重探，showPin 才会翻回主密码
    await waitFor(() => {
      expect(cryptoState.refreshPinStatus).toHaveBeenCalled();
    });
  });

  it('PIN 未启用 -> 直接显示主密码输入，无 PIN 相关入口', () => {
    cryptoState.pinEnabled = false;
    cryptoState.pinEnvelopeAvailable = false;
    render(<UnlockModal />);

    expect(screen.getByPlaceholderText('输入主密码')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('输入 PIN')).not.toBeInTheDocument();
  });
});
