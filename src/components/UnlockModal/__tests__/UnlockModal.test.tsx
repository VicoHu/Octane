import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
