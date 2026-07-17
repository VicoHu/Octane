import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { cryptoState } = vi.hoisted(() => ({
  cryptoState: {} as Record<string, unknown>,
}));

vi.mock('@/store/useCrypto', () => ({
  useCrypto: (selector: (state: Record<string, unknown>) => unknown) => selector(cryptoState),
}));

const { toastMock } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/ui/toast', () => ({
  Toast: toastMock,
}));

import { ChangePasswordModal } from '..';

describe('ChangePasswordModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(cryptoState, {
      loading: false,
      changePassword: vi.fn(async () => {}),
    });
  });

  async function fillValid(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText('当前主密码'), 'oldpassword1');
    await user.type(screen.getByPlaceholderText('新主密码（至少 12 个字符）'), 'newpassword123');
    await user.type(screen.getByPlaceholderText('确认新主密码'), 'newpassword123');
  }

  it('新密码少于 12 字符 -> 显示错误且不调用 changePassword', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordModal visible={true} onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('当前主密码'), 'oldpass123');
    await user.type(screen.getByPlaceholderText('新主密码（至少 12 个字符）'), 'short');
    await user.type(screen.getByPlaceholderText('确认新主密码'), 'short');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(screen.getByText('新密码至少 12 个字符')).toBeInTheDocument();
    expect(cryptoState.changePassword).not.toHaveBeenCalled();
  });

  it('两次新密码不一致 -> 显示错误', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordModal visible={true} onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('当前主密码'), 'oldpass123');
    await user.type(screen.getByPlaceholderText('新主密码（至少 12 个字符）'), 'newpassword123');
    await user.type(screen.getByPlaceholderText('确认新主密码'), 'differentpwd1');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(screen.getByText('两次新密码不一致')).toBeInTheDocument();
    expect(cryptoState.changePassword).not.toHaveBeenCalled();
  });

  it('新旧密码相同 -> 显示错误', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordModal visible={true} onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('当前主密码'), 'samepassword1');
    await user.type(screen.getByPlaceholderText('新主密码（至少 12 个字符）'), 'samepassword1');
    await user.type(screen.getByPlaceholderText('确认新主密码'), 'samepassword1');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(screen.getByText('新密码不能与旧密码相同')).toBeInTheDocument();
    expect(cryptoState.changePassword).not.toHaveBeenCalled();
  });

  it('校验通过 -> 调用 changePassword + Toast 成功 + onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ChangePasswordModal visible={true} onClose={onClose} />);

    await fillValid(user);
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    await waitFor(() => {
      expect(cryptoState.changePassword).toHaveBeenCalledWith('oldpassword1', 'newpassword123');
    });
    expect(toastMock.success).toHaveBeenCalledWith('主密码已修改，加密笔记已同步');
    expect(onClose).toHaveBeenCalled();
  });

  it('changePassword 抛错 -> 显示错误信息', async () => {
    cryptoState.changePassword = vi.fn(async () => {
      throw new Error('派生失败');
    });
    const user = userEvent.setup();
    render(<ChangePasswordModal visible={true} onClose={vi.fn()} />);

    await fillValid(user);
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    await waitFor(() => {
      expect(screen.getByText('派生失败')).toBeInTheDocument();
    });
  });

  it('changePassword 进行中连按 Enter -> 只调用一次（防双触发 race 致密文与元数据错乱、永久丢失）', async () => {
    let resolveChange: () => void = () => {};
    cryptoState.changePassword = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveChange = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<ChangePasswordModal visible={true} onClose={vi.fn()} />);

    await fillValid(user);

    // 第一回车：changePassword 开始（promise pending，loading 尚未在闭包里生效）
    await user.keyboard('{Enter}');
    expect(cryptoState.changePassword).toHaveBeenCalledTimes(1);

    // changePassword 未 resolve 前，连续再按 Enter：应被 submittingRef 防重入拦截
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    expect(cryptoState.changePassword).toHaveBeenCalledTimes(1);

    resolveChange();
  });
});
