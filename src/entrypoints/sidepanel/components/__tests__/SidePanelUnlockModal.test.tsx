import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@douyinfe/semi-ui', () => ({
  Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <div data-testid="modal">{children}</div> : null,
  Input: (props: { value?: string; onChange: (v: string) => void; onEnterPress: () => void }) => (
    <input
      data-testid="pwd-input"
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onEnterPress();
      }}
    />
  ),
  Button: ({
    children,
    onClick,
    loading,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    loading?: boolean;
  }) => (
    <button data-testid="submit" onClick={onClick} disabled={loading}>
      {children}
    </button>
  ),
  Toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('@/services/UnlockSession', () => ({ unlock: vi.fn() }));

import { SidePanelUnlockModal } from '../SidePanelUnlockModal';
import { unlock } from '@/services/UnlockSession';
import { Toast } from '@douyinfe/semi-ui';

describe('SidePanelUnlockModal — sidepanel 解锁弹窗', () => {
  beforeEach(() => vi.clearAllMocks());

  it('正确密码 → 调 unlock("sidepanel", pwd) + Toast 成功 + 关闭', async () => {
    (unlock as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('pwd-input'), { target: { value: 'right-pwd' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('submit'));
    });
    expect(unlock).toHaveBeenCalledWith('sidepanel', 'right-pwd');
    expect(Toast.success).toHaveBeenCalledWith('已解锁');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('错误密码 → 显示「密码错误」，不关闭', async () => {
    (unlock as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);
    fireEvent.change(screen.getByTestId('pwd-input'), { target: { value: 'wrong' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('submit'));
    });
    expect(screen.getByText('密码错误')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
