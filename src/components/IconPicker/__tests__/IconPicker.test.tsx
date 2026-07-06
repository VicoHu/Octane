import { describe, it, expect, vi, beforeEach } from 'vitest';
// Semi 加载动画依赖 lottie-web；jsdom 无 canvas，mock 掉
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
import { IconPicker } from '@/components/IconPicker';

describe('IconPicker — emoji 图标选择器', () => {
  beforeEach(() => {
    // 隔离 Semi Input 的潜在 portal 残留
    document.body.innerHTML = '';
  });

  it('渲染预设网格与当前选中预览', () => {
    render(<IconPicker value="📁" onChange={vi.fn()} />);
    // 预览区显示当前 icon
    expect(screen.getByTestId('icon-preview').textContent).toBe('📁');
    // 预设网格项存在
    expect(screen.getByTestId('icon-grid').children.length).toBeGreaterThan(0);
  });

  it('点击网格项触发 onChange', () => {
    const onChange = vi.fn();
    render(<IconPicker value="📁" onChange={onChange} />);
    const grid = screen.getByTestId('icon-grid');
    // 点第一个网格按钮（应为某个预设 emoji）
    const firstBtn = grid.children[0]! as HTMLButtonElement;
    fireEvent.click(firstBtn);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(typeof onChange.mock.calls[0]![0]).toBe('string');
  });

  it('输入合法 emoji 触发 onChange 并清空错误', () => {
    const onChange = vi.fn();
    render(<IconPicker value="📁" onChange={onChange} />);
    const input = screen.getByTestId('icon-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '🚀' } });
    expect(onChange).toHaveBeenCalledWith('🚀');
    expect(screen.queryByTestId('icon-error')).toBeNull();
  });

  it('输入非 emoji 不触发 onChange 且显示错误', () => {
    const onChange = vi.fn();
    render(<IconPicker value="📁" onChange={onChange} />);
    const input = screen.getByTestId('icon-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('icon-error')).toBeTruthy();
  });

  it('输入中文不触发 onChange', () => {
    const onChange = vi.fn();
    render(<IconPicker value="📁" onChange={onChange} />);
    const input = screen.getByTestId('icon-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '工作' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('icon-error')).toBeTruthy();
  });

  it('清空输入不触发 onChange 也不报错（允许中间态空值）', () => {
    const onChange = vi.fn();
    render(<IconPicker value="📁" onChange={onChange} />);
    const input = screen.getByTestId('icon-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('icon-error')).toBeNull();
  });
});
