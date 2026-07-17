import { describe, it, expect, vi } from 'vitest';
// lottie-web 由 vitest.config.ts 全局 alias 处理（见 docs/standards/testing.md §4.4.1），无需 vi.mock
// useFavicon 走真实 IDB/网络副作用，本组件测试只需静态 src 占位
vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: (url: string) => ({
    kind: 'chrome', src: `https://mock-favicon/${url}`, onError: vi.fn(),
  }),
}));
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StickyHeader } from '../StickyHeader';

describe('StickyHeader — 顶栏组件', () => {
  it('渲染 hostname 与命中数', () => {
    render(<StickyHeader hostname="github.com" matchCount={3} onAdd={vi.fn()} onPin={vi.fn()} />);
    expect(screen.getByText('github.com')).toBeInTheDocument();
    expect(screen.getByText(/3 个书签命中/)).toBeInTheDocument();
  });

  it('点击添加书签按钮 → 调用 onAdd', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<StickyHeader hostname="a.com" matchCount={1} onAdd={onAdd} onPin={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '添加书签' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('键盘激活 Pin 当前 Tab 按钮 → 调用 onPin', async () => {
    const user = userEvent.setup();
    const onPin = vi.fn();
    render(<StickyHeader hostname="a.com" matchCount={1} onAdd={vi.fn()} onPin={onPin} />);
    const pinButton = screen.getByRole('button', { name: 'Pin 当前 Tab' });
    pinButton.focus();
    await user.keyboard('{Enter}');
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  // useFavicon 的网络/IDB 回退属于 hook 自身职责，顶栏只消费其返回值。
});
