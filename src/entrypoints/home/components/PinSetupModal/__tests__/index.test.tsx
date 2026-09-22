import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { cryptoApi, cryptoState, toastMock } = vi.hoisted(() => ({
  cryptoApi: {
    unlock: vi.fn(),
    setupPin: vi.fn(),
    disablePin: vi.fn(),
  },
  cryptoState: {} as Record<string, unknown>,
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/CryptoService', () => cryptoApi);
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (selector: (state: Record<string, unknown>) => unknown) => selector(cryptoState),
}));
vi.mock('@/components/ui/toast', () => ({ Toast: toastMock }));

import { PinSetupModal } from '..';

describe('PinSetupModal — PIN 管理弹窗（#96）', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(cryptoState, { refreshPinStatus: vi.fn(async () => {}) });
  });

  it('主密码错误 -> 显示错误且不启用 PIN', async () => {
    cryptoApi.unlock.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="enable" onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('主密码（验证身份）'), 'wrong-master');
    await user.click(screen.getByRole('button', { name: '启用 PIN' }));

    expect(await screen.findByText('主密码错误')).toBeInTheDocument();
    expect(cryptoApi.setupPin).not.toHaveBeenCalled();
  });

  it('主密码正确 + 填写 PIN -> 调用 setupPin 并关闭', async () => {
    cryptoApi.unlock.mockResolvedValue(true);
    cryptoApi.setupPin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="enable" onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('主密码（验证身份）'), 'master-password-1');
    await user.type(screen.getByPlaceholderText('输入 6 位数字 PIN'), '123456');
    await user.type(screen.getByPlaceholderText('确认 PIN'), '123456');
    await user.click(screen.getByRole('button', { name: '启用 PIN' }));

    await waitFor(() => {
      expect(cryptoApi.setupPin).toHaveBeenCalledWith('123456', 'digits-6', false);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('unlock 抛异常 -> 显示错误信息，不关闭（外层 catch 兜底）', async () => {
    cryptoApi.unlock.mockRejectedValue(new Error('未设置主密码'));
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="enable" onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('主密码（验证身份）'), 'any');
    await user.click(screen.getByRole('button', { name: '启用 PIN' }));

    expect(await screen.findByText('未设置主密码')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('两次 PIN 不一致 -> 拦截并提示', async () => {
    cryptoApi.unlock.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="enable" onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('主密码（验证身份）'), 'master-password-1');
    await user.type(screen.getByPlaceholderText('输入 6 位数字 PIN'), '123456');
    await user.type(screen.getByPlaceholderText('确认 PIN'), '654321');
    await user.click(screen.getByRole('button', { name: '启用 PIN' }));

    expect(await screen.findByText('两次 PIN 不一致')).toBeInTheDocument();
    expect(cryptoApi.setupPin).not.toHaveBeenCalled();
  });

  it('勾选重启保持 -> 显示离线暴力破解警示，且 persist 参数传 true', async () => {
    cryptoApi.unlock.mockResolvedValue(true);
    cryptoApi.setupPin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="enable" onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('主密码（验证身份）'), 'master-password-1');
    await user.type(screen.getByPlaceholderText('输入 6 位数字 PIN'), '123456');
    await user.type(screen.getByPlaceholderText('确认 PIN'), '123456');
    await user.click(screen.getByRole('checkbox'));
    expect(
      screen.getByText(/能读取本机文件的人可尝试暴力破解短 PIN/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '启用 PIN' }));
    await waitFor(() => {
      expect(cryptoApi.setupPin).toHaveBeenCalledWith('123456', 'digits-6', true);
    });
  });

  it('disable 模式 -> 主密码验证通过即关闭 PIN', async () => {
    cryptoApi.unlock.mockResolvedValue(true);
    cryptoApi.disablePin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="disable" onClose={onClose} />);

    expect(screen.queryByPlaceholderText('确认 PIN')).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('主密码（验证身份）'), 'master-password-1');
    await user.click(screen.getByRole('button', { name: '关闭 PIN' }));

    await waitFor(() => {
      expect(cryptoApi.disablePin).toHaveBeenCalled();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
