import { describe, it, expect, vi } from 'vitest';
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
import SubPageHeader from './SubPageHeader';

describe('SubPageHeader', () => {
  it('渲染标题', () => {
    render(<SubPageHeader title="保存当前页面" onBack={vi.fn()} />);
    expect(screen.getByText('保存当前页面')).toBeTruthy();
  });

  it('点击返回按钮调用 onBack', () => {
    const onBack = vi.fn();
    render(<SubPageHeader title="测试" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
