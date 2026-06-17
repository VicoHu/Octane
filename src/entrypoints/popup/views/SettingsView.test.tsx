import { describe, it, expect, vi } from 'vitest';
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
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsView from './SettingsView';

describe('SettingsView', () => {
  it('渲染本地备份区（导入/导出按钮）', () => {
    render(<SettingsView onBack={vi.fn()} />);
    expect(screen.getByText('导出数据')).toBeTruthy();
    expect(screen.getByText('导入数据')).toBeTruthy();
  });

  it('点击返回调用 onBack', () => {
    const onBack = vi.fn();
    render(<SettingsView onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
