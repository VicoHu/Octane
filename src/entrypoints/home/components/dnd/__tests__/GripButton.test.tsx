import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GripButton } from '../GripButton';

/**
 * GripButton 是 4 层拖拽的唯一触发器(D6):useSortable().listeners 收敛到此 button,
 * 整卡 onClick 保留。dnd-kit 真拖拽在 jsdom 难测(brief),这里只测 a11y affordance +
 * listener 透传 + 搜索态禁用,不测真实 pointer 拖拽序列。
 */
describe('GripButton — 拖拽手柄触发器(D6 唯一拖拽源)', () => {
  it('渲染 button,aria-roledescription=可拖拽项 + accessible name=拖拽排序', () => {
    render(<GripButton listeners={{ onPointerDown: vi.fn() }} />);
    const grip = screen.getByRole('button', { name: /拖拽排序/ });
    expect(grip).toBeInTheDocument();
    expect(grip).toHaveAttribute('aria-roledescription', '可拖拽项');
  });

  it('pointerdown 透传到 listeners(启动拖拽 sensor)', async () => {
    const user = userEvent.setup();
    const onPointerDown = vi.fn();
    render(<GripButton listeners={{ onPointerDown }} />);
    // [MouseLeft>] = 按下不释放,触发 onPointerDown
    await user.pointer({ target: screen.getByRole('button'), keys: '[MouseLeft>]' });
    expect(onPointerDown).toHaveBeenCalled();
  });

  it('disabled(搜索态/≤1 元素):title 变「清除搜索后可拖拽排序」+ 不透传 listeners', async () => {
    const user = userEvent.setup();
    const onPointerDown = vi.fn();
    render(<GripButton listeners={{ onPointerDown }} disabled />);
    const grip = screen.getByRole('button', { name: /清除搜索后可拖拽排序/ });
    expect(grip).toBeDisabled();
    // disabled button 不响应 pointer 事件 → listener 不触发
    await user.pointer({ target: grip, keys: '[MouseLeft>]' });
    expect(onPointerDown).not.toHaveBeenCalled();
  });
});
