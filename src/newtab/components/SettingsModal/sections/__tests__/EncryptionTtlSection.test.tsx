import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@douyinfe/semi-ui', () => ({
  InputNumber: (props: {
    value: number;
    min: number;
    max: number;
    suffix?: string;
    onChange: (v: number) => void;
    disabled?: boolean;
    'data-testid'?: string;
  }) => (
    <input
      data-testid={props['data-testid']}
      type="number"
      value={props.value}
      min={props.min}
      max={props.max}
      disabled={props.disabled}
      onChange={(e) => props.onChange(Number(e.target.value))}
    />
  ),
}));
vi.mock('@/services/UnlockSession', () => ({
  readTtlConfig: vi.fn(),
  writeTtlConfig: vi.fn(),
}));

import { EncryptionTtlSection } from '../EncryptionTtlSection';
import { readTtlConfig, writeTtlConfig } from '@/services/UnlockSession';

describe('EncryptionTtlSection — side panel TTL 配置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (readTtlConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      grace: 5 * 60_000,
      hardCap: 30 * 60_000,
    });
  });

  it('挂载读 readTtlConfig，渲染为分钟（默认 5 / 30）', async () => {
    render(<EncryptionTtlSection />);
    await waitFor(() =>
      expect((screen.getByTestId('ttl-grace') as HTMLInputElement).disabled).toBe(false),
    );
    expect((screen.getByTestId('ttl-grace') as HTMLInputElement).value).toBe('5');
    expect((screen.getByTestId('ttl-hardcap') as HTMLInputElement).value).toBe('30');
  });

  it('改 grace → writeTtlConfig({ grace: 分钟*60000 })', async () => {
    render(<EncryptionTtlSection />);
    await waitFor(() =>
      expect((screen.getByTestId('ttl-grace') as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.change(screen.getByTestId('ttl-grace'), { target: { value: '10' } });
    await waitFor(() => expect(writeTtlConfig).toHaveBeenCalledWith({ grace: 10 * 60_000 }));
  });

  it('改 hardCap → writeTtlConfig({ hardCap: 分钟*60000 })', async () => {
    render(<EncryptionTtlSection />);
    await waitFor(() =>
      expect((screen.getByTestId('ttl-hardcap') as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.change(screen.getByTestId('ttl-hardcap'), { target: { value: '45' } });
    await waitFor(() => expect(writeTtlConfig).toHaveBeenCalledWith({ hardCap: 45 * 60_000 }));
  });

  it('grace 超上限被 clamp 到 60', async () => {
    render(<EncryptionTtlSection />);
    await waitFor(() =>
      expect((screen.getByTestId('ttl-grace') as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.change(screen.getByTestId('ttl-grace'), { target: { value: '999' } });
    await waitFor(() => expect(writeTtlConfig).toHaveBeenCalledWith({ grace: 60 * 60_000 }));
  });
});
