import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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

  // 真实 Semi InputNumber 在 jsdom 下渲染为 <input>；data-testid 打在生产代码上（合法），
  // 但 Semi 可能不透传 data-* 到内部 input，故用 getByTestId 优先，回退到 container input。
  function getGraceInput(container: HTMLElement): HTMLInputElement {
    const byTestId = container.querySelector('[data-testid="ttl-grace"] input, input[data-testid="ttl-grace"]') as HTMLInputElement | null;
    if (byTestId) return byTestId;
    // 回退：分区内第一个 input 即 grace（组件渲染顺序：grace 在前，hardCap 在后）
    return container.querySelector('input') as HTMLInputElement;
  }
  function getHardCapInput(container: HTMLElement): HTMLInputElement {
    const inputs = container.querySelectorAll('input');
    // 取最后一个 input（hardCap）
    return inputs[inputs.length - 1] as HTMLInputElement;
  }

  it('挂载读 readTtlConfig，渲染为秒（默认 300 / 1800）', async () => {
    const { container } = render(<EncryptionTtlSection />);
    await waitFor(() => expect(getGraceInput(container).disabled).toBe(false));
    expect(getGraceInput(container).value).toBe('300');
    expect(getHardCapInput(container).value).toBe('1800');
  });

  it('改 grace → writeTtlConfig({ grace: 秒*1000 })', async () => {
    const user = userEvent.setup();
    const { container } = render(<EncryptionTtlSection />);
    await waitFor(() => expect(getGraceInput(container).disabled).toBe(false));
    await user.clear(getGraceInput(container));
    await user.type(getGraceInput(container), '90');
    await waitFor(() => expect(writeTtlConfigMock).toHaveBeenCalledWith({ grace: 90 * 1000 }));
  });

  it('改 hardCap → writeTtlConfig({ hardCap: 秒*1000 })', async () => {
    const user = userEvent.setup();
    const { container } = render(<EncryptionTtlSection />);
    await waitFor(() => expect(getGraceInput(container).disabled).toBe(false));
    await user.clear(getHardCapInput(container));
    await user.type(getHardCapInput(container), '1200');
    await waitFor(() => expect(writeTtlConfigMock).toHaveBeenCalledWith({ hardCap: 1200 * 1000 }));
  });

  it('grace 超上限被 clamp 到 3600 秒（1h）', async () => {
    const user = userEvent.setup();
    const { container } = render(<EncryptionTtlSection />);
    await waitFor(() => expect(getGraceInput(container).disabled).toBe(false));
    await user.clear(getGraceInput(container));
    await user.type(getGraceInput(container), '99999');
    await waitFor(() => expect(writeTtlConfigMock).toHaveBeenCalledWith({ grace: 3600 * 1000 }));
  });
});
