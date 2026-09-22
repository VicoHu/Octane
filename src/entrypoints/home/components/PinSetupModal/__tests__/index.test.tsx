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

/** 走完第 1 步主密码验证，进入第 2 步 */
async function passVerify(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('主密码'), 'master-password-1');
  await user.click(screen.getByRole('button', { name: '下一步' }));
  await screen.findByLabelText('PIN');
}

describe('PinSetupModal — 第 1 步：验证身份（#96 两步向导）', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(cryptoState, { refreshPinStatus: vi.fn(async () => {}) });
  });

  it('初始显示步骤指示与主密码输入，无 PIN 字段', () => {
    render(<PinSetupModal visible={true} intent="enable" onClose={onClose} />);

    expect(screen.getByText('1. 验证身份')).toBeInTheDocument();
    expect(screen.getByText('2. 设置 PIN')).toBeInTheDocument();
    expect(screen.getByLabelText('主密码')).toBeInTheDocument();
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument();
  });

  it('主密码错误 -> 就近显示错误，停留在第 1 步', async () => {
    cryptoApi.unlock.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="enable" onClose={onClose} />);

    await user.type(screen.getByLabelText('主密码'), 'wrong-master');
    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(await screen.findByText('主密码错误')).toBeInTheDocument();
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument();
    expect(cryptoApi.setupPin).not.toHaveBeenCalled();
  });

  it('主密码正确 -> 进入第 2 步（形态选择 + PIN 输入出现）', async () => {
    cryptoApi.unlock.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="enable" onClose={onClose} />);

    await passVerify(user);

    expect(screen.getByRole('button', { name: '启用 PIN' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一步' })).toBeInTheDocument();
  });

  it('unlock 抛异常 -> 显示错误信息，不进入第 2 步（外层 catch 兜底）', async () => {
    cryptoApi.unlock.mockRejectedValue(new Error('未设置主密码'));
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="enable" onClose={onClose} />);

    await user.type(screen.getByLabelText('主密码'), 'any');
    await user.click(screen.getByRole('button', { name: '下一步' }));

    expect(await screen.findByText('未设置主密码')).toBeInTheDocument();
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument();
  });
});

describe('PinSetupModal — 第 2 步：设置 PIN', () => {
  const onClose = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.assign(cryptoState, { refreshPinStatus: vi.fn(async () => {}) });
    cryptoApi.unlock.mockResolvedValue(true);
    cryptoApi.setupPin.mockResolvedValue(undefined);
  });

  async function renderAtStep2() {
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="enable" onClose={onClose} />);
    await passVerify(user);
    return user;
  }

  it('填写 PIN 并提交 -> 调用 setupPin 并关闭（默认 6 位数字、不持久化）', async () => {
    const user = await renderAtStep2();

    await user.type(screen.getByLabelText('PIN'), '123456');
    await user.type(screen.getByLabelText('确认 PIN'), '123456');
    await user.click(screen.getByRole('button', { name: '启用 PIN' }));

    await waitFor(() => {
      expect(cryptoApi.setupPin).toHaveBeenCalledWith('123456', 'digits-6', false);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('两次 PIN 不一致 -> 拦截并就近提示', async () => {
    const user = await renderAtStep2();

    await user.type(screen.getByLabelText('PIN'), '123456');
    await user.type(screen.getByLabelText('确认 PIN'), '654321');
    await user.click(screen.getByRole('button', { name: '启用 PIN' }));

    expect(await screen.findByText('两次 PIN 不一致')).toBeInTheDocument();
    expect(cryptoApi.setupPin).not.toHaveBeenCalled();
  });

  it('勾选重启保持 -> 显示暴力破解警示，且 persist 参数传 true', async () => {
    const user = await renderAtStep2();

    await user.type(screen.getByLabelText('PIN'), '123456');
    await user.type(screen.getByLabelText('确认 PIN'), '123456');
    await user.click(screen.getByRole('checkbox'));
    expect(
      screen.getByText(/能读取本机文件的人可尝试暴力破解短 PIN/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '启用 PIN' }));
    await waitFor(() => {
      expect(cryptoApi.setupPin).toHaveBeenCalledWith('123456', 'digits-6', true);
    });
  });

  it('上一步 -> 返回第 1 步重新验证', async () => {
    const user = await renderAtStep2();

    await user.click(screen.getByRole('button', { name: '上一步' }));

    expect(await screen.findByLabelText('主密码')).toBeInTheDocument();
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument();
  });
});

describe('PinSetupModal — disable 模式（单步）', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(cryptoState, { refreshPinStatus: vi.fn(async () => {}) });
  });

  it('主密码验证通过即关闭 PIN，不出现第 2 步', async () => {
    cryptoApi.unlock.mockResolvedValue(true);
    cryptoApi.disablePin.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<PinSetupModal visible={true} intent="disable" onClose={onClose} />);

    expect(screen.queryByRole('button', { name: '下一步' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('主密码'), 'master-password-1');
    await user.click(screen.getByRole('button', { name: '关闭 PIN' }));

    await waitFor(() => {
      expect(cryptoApi.disablePin).toHaveBeenCalled();
    });
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByLabelText('PIN')).not.toBeInTheDocument();
  });
});
