import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(),
}));

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ContextPanelShell } from '@/entrypoints/home/components/ContextPanelShell';
import styles from '@/entrypoints/home/components/ContextPanelShell/index.module.css';

describe('ContextPanelShell — 响应式上下文面板', () => {
  beforeEach(() => {
    vi.mocked(useMediaQuery).mockReset();
  });

  it('桌面端使用右侧面板承载共享内容并标记底部安全区结构', () => {
    vi.mocked(useMediaQuery).mockReturnValue(false);

    render(
      <ContextPanelShell
        open
        title="上下文详情"
        encrypted
        onOpenChange={vi.fn()}
        footer={<span>共享页脚</span>}
      >
        <p>共享内容</p>
      </ContextPanelShell>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass(
      'data-[side=right]:w-screen',
      'data-[side=right]:sm:max-w-[1000px]',
    );
    expect(dialog).toHaveAttribute('data-has-footer', 'true');
    expect(screen.getByRole('main')).toHaveClass(styles.content!);
    expect(screen.getByText('共享内容')).toBeInTheDocument();
    expect(screen.getByText('共享页脚')).toBeInTheDocument();
    expect(screen.getByLabelText('包含加密上下文')).toBeInTheDocument();
  });

  it('移动端使用全高抽屉并标记无底部操作区的安全区结构', () => {
    vi.mocked(useMediaQuery).mockReturnValue(true);

    render(
      <ContextPanelShell open title="上下文详情" onOpenChange={vi.fn()}>
        <p>共享内容</p>
      </ContextPanelShell>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass(
      'h-dvh',
      'max-h-dvh',
      'data-[swipe-direction=down]:rounded-none',
    );
    expect(dialog).toHaveAttribute('data-has-footer', 'false');
    expect(screen.getByRole('main')).toHaveClass(styles.content!);
    expect(screen.getByText('共享内容')).toBeInTheDocument();
  });

  it('点击关闭按钮时请求关闭面板', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    vi.mocked(useMediaQuery).mockReturnValue(false);

    render(
      <ContextPanelShell open title="上下文详情" onOpenChange={onOpenChange}>
        <p>共享内容</p>
      </ContextPanelShell>,
    );

    await user.click(screen.getByRole('button', { name: '关闭上下文面板' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
