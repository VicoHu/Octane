import { describe, it, expect, vi } from 'vitest';
// Semi 加载动画依赖 lottie-web；jsdom 无 canvas，mock 掉
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({ destroy() {}, play() {}, pause() {}, addEventListener() {}, removeEventListener() {} }),
    destroy() {},
    registerAnimation() {},
  },
}));
import { render, screen, fireEvent } from '@testing-library/react';
import { StickyHeader } from '../StickyHeader';

describe('StickyHeader — 顶栏组件', () => {
  it('渲染 hostname + 命中数 + favicon 图片', () => {
    render(<StickyHeader hostname="github.com" matchCount={3} onAdd={vi.fn()} />);
    expect(screen.getByText('github.com')).toBeTruthy();
    expect(screen.getByText(/3 个书签命中/)).toBeTruthy();
    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toContain('github.com');
  });

  it('点击添加按钮调用 onAdd', () => {
    const onAdd = vi.fn();
    render(<StickyHeader hostname="a.com" matchCount={1} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: '添加书签' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('favicon 加载失败 → onError 隐藏图片可见性', () => {
    render(<StickyHeader hostname="a.com" matchCount={0} onAdd={vi.fn()} />);
    const img = document.querySelector('img')!;
    expect(img.style.visibility).not.toBe('hidden');
    fireEvent.error(img);
    expect(img.style.visibility).toBe('hidden');
  });
});
