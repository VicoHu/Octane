import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
// 可控 useCrypto 状态（参考 settings-entry.test mock 模式，扩展为 per-test 可变）
const { mockState } = vi.hoisted(() => ({ mockState: {} as Record<string, unknown> }));
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (sel: (s: Record<string, unknown>) => unknown) => sel(mockState),
}));
// ChangePasswordModal 依赖 CryptoService，mock 为受控简单组件
vi.mock('@/newtab/components/ChangePasswordModal', () => ({
  ChangePasswordModal: ({ visible }: { visible: boolean }) =>
    visible ? <div>修改主密码弹窗</div> : null,
}));
import { render, screen, fireEvent } from '@testing-library/react';
import { PasswordSection } from '../sections/PasswordSection';

describe('PasswordSection（主密码分区，状态自适应）', () => {
  beforeEach(() => {
    Object.assign(mockState, {
      passwordSet: false,
      unlocked: false,
      openUnlockModal: vi.fn(),
      lockSession: vi.fn(),
    });
  });

  it('未设 → 「设置主密码」按钮，点击调 openUnlockModal', () => {
    render(<PasswordSection />);
    fireEvent.click(screen.getByRole('button', { name: '设置主密码' }));
    expect(mockState.openUnlockModal).toHaveBeenCalled();
  });

  it('已设+已锁 → 「解锁主密码」按钮', () => {
    mockState.passwordSet = true;
    mockState.unlocked = false;
    render(<PasswordSection />);
    expect(screen.getByRole('button', { name: '解锁主密码' })).toBeTruthy();
  });

  it('已设+已解 → 「锁定主密码」按钮，点击调 lockSession', () => {
    mockState.passwordSet = true;
    mockState.unlocked = true;
    render(<PasswordSection />);
    fireEvent.click(screen.getByRole('button', { name: '锁定主密码' }));
    expect(mockState.lockSession).toHaveBeenCalled();
  });

  it('已设+已解 → 「修改主密码」按钮，点击显示修改弹窗', () => {
    mockState.passwordSet = true;
    mockState.unlocked = true;
    render(<PasswordSection />);
    fireEvent.click(screen.getByRole('button', { name: '修改主密码' }));
    expect(screen.getByText('修改主密码弹窗')).toBeTruthy();
  });

  it('未设 → 不显示「修改主密码」', () => {
    render(<PasswordSection />);
    expect(screen.queryByRole('button', { name: '修改主密码' })).toBeNull();
  });
});
