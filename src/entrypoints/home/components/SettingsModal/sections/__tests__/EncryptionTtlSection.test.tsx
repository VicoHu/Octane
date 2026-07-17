import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// 副作用边界：readTtlConfig / writeTtlConfig（chrome.storage 读写）
vi.mock('@/services/UnlockSession', () => ({
  readTtlConfig: vi.fn(),
  writeTtlConfig: vi.fn(),
}));

import { EncryptionTtlSection } from '../EncryptionTtlSection';
import { readTtlConfig, writeTtlConfig } from '@/services/UnlockSession';

const readTtlConfigMock = vi.mocked(readTtlConfig);
const writeTtlConfigMock = vi.mocked(writeTtlConfig);

describe('EncryptionTtlSection — side panel TTL 配置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readTtlConfigMock.mockResolvedValue({
      grace: 5 * 60_000,
      hardCap: 30 * 60_000,
    });
  });

  it('挂载读 readTtlConfig，渲染为秒（默认 300 / 1800）', async () => {
    render(<EncryptionTtlSection />);
    const graceInput = screen.getByLabelText('自动锁定宽限期（秒）');
    const hardCapInput = screen.getByLabelText('最长解锁时长（秒）');

    await waitFor(() => expect(graceInput).toBeEnabled());
    expect(hardCapInput).toBeEnabled();
    expect(graceInput).toHaveValue(300);
    expect(hardCapInput).toHaveValue(1800);
  });

  it('改 grace → writeTtlConfig({ grace: 秒*1000 })', async () => {
    const user = userEvent.setup();
    render(<EncryptionTtlSection />);
    const graceInput = screen.getByLabelText('自动锁定宽限期（秒）');
    await waitFor(() => expect(graceInput).toBeEnabled());
    await user.clear(graceInput);
    await user.type(graceInput, '90');
    await waitFor(() => expect(writeTtlConfigMock).toHaveBeenCalledWith({ grace: 90 * 1000 }));
  });

  it('改 hardCap → writeTtlConfig({ hardCap: 秒*1000 })', async () => {
    const user = userEvent.setup();
    render(<EncryptionTtlSection />);
    const hardCapInput = screen.getByLabelText('最长解锁时长（秒）');
    await waitFor(() => expect(hardCapInput).toBeEnabled());
    await user.clear(hardCapInput);
    await user.type(hardCapInput, '1200');
    await waitFor(() => expect(writeTtlConfigMock).toHaveBeenCalledWith({ hardCap: 1200 * 1000 }));
  });

  it('grace 超上限被 clamp 到 3600 秒（1h）', async () => {
    const user = userEvent.setup();
    render(<EncryptionTtlSection />);
    const graceInput = screen.getByLabelText('自动锁定宽限期（秒）');
    await waitFor(() => expect(graceInput).toBeEnabled());
    await user.clear(graceInput);
    await user.type(graceInput, '99999');
    await waitFor(() => expect(writeTtlConfigMock).toHaveBeenCalledWith({ grace: 3600 * 1000 }));
  });
});
