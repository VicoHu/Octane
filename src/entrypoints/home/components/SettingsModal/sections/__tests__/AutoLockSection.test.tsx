import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { sessionApi } = vi.hoisted(() => ({
  sessionApi: {
    readAutoLockConfig: vi.fn(),
    writeAutoLockConfig: vi.fn(),
  },
}));

// partial mock：档位常量 AUTOLOCK_PRESETS_MS 用真实值，仅覆盖读写副作用
vi.mock('@/services/UnlockSession', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/UnlockSession')>();
  return {
    ...actual,
    readAutoLockConfig: sessionApi.readAutoLockConfig,
    writeAutoLockConfig: sessionApi.writeAutoLockConfig,
  };
});

import { AutoLockSection } from '../AutoLockSection';

describe('AutoLockSection — 统一自动锁定档位（#96）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionApi.readAutoLockConfig.mockResolvedValue({ idleMs: 300_000 });
  });

  it('渲染当前配置值（5 分钟）', async () => {
    render(<AutoLockSection />);

    const trigger = await waitFor(() =>
      screen.getByRole('combobox', { name: '闲置多久后锁定' }),
    );
    // SelectContent 会预渲染全部选项，须在 trigger 内断言当前显示值
    expect(within(trigger).getByText('5 分钟')).toBeInTheDocument();
  });

  it('未配置（null）-> 显示永不（新默认）', async () => {
    sessionApi.readAutoLockConfig.mockResolvedValue({ idleMs: null });
    render(<AutoLockSection />);

    const trigger = await waitFor(() =>
      screen.getByRole('combobox', { name: '闲置多久后锁定' }),
    );
    expect(within(trigger).getByText('永不')).toBeInTheDocument();
  });

  it('键盘切换档位（ArrowDown 打开 + 选择）-> 写入对应 idleMs', async () => {
    const user = userEvent.setup();
    render(<AutoLockSection />);
    const trigger = await waitFor(() =>
      screen.getByRole('combobox', { name: '闲置多久后锁定' }),
    );

    trigger.focus();
    await user.keyboard('[ArrowDown]');

    const option = await screen.findByRole('option', { name: '15 分钟' });
    await user.click(option);

    await waitFor(() => {
      expect(sessionApi.writeAutoLockConfig).toHaveBeenCalledWith(900_000);
    });
  });
});
