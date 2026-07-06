import { describe, it, expect, vi } from 'vitest';
// lottie-web 由 vitest.config.ts 全局 alias 处理（见 docs/standards/testing.md §4.4.1），无需 vi.mock
// useFavicon 走真实 IDB/网络副作用，本组件测试只需静态 src 占位
vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: (url: string) => ({ kind: 'remote', src: `https://mock-favicon/${url}` }),
}));
import { render, screen, fireEvent } from '@testing-library/react';
import { StickyHeader } from '../StickyHeader';

describe('StickyHeader — 顶栏组件', () => {
  it('渲染 hostname + 命中数 + favicon 图片', () => {
    render(<StickyHeader hostname="github.com" matchCount={3} onAdd={vi.fn()} onPin={vi.fn()} />);
    expect(screen.getByText('github.com')).toBeTruthy();
    expect(screen.getByText(/3 个书签命中/)).toBeTruthy();
    const img = document.querySelector('img');
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toContain('github.com');
  });

  it('点击添加按钮调用 onAdd', () => {
    const onAdd = vi.fn();
    render(<StickyHeader hostname="a.com" matchCount={1} onAdd={onAdd} onPin={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '添加书签' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('点击 Pin 图标按钮调用 onPin', () => {
    const onPin = vi.fn();
    render(<StickyHeader hostname="a.com" matchCount={1} onAdd={vi.fn()} onPin={onPin} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin 当前 Tab' }));
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  it('favicon 加载失败 → onError 隐藏图片可见性', () => {
    render(<StickyHeader hostname="a.com" matchCount={0} onAdd={vi.fn()} onPin={vi.fn()} />);
    const img = document.querySelector('img')!;
    expect(img.style.visibility).not.toBe('hidden');
    fireEvent.error(img);
    expect(img.style.visibility).toBe('hidden');
  });
});
