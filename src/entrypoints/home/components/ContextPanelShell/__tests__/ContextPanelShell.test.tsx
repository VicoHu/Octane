import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(),
}));

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { ContextPanelShell } from '@/entrypoints/home/components/ContextPanelShell';

describe('ContextPanelShell — 响应式上下文面板', () => {
  beforeEach(() => {
    vi.mocked(useMediaQuery).mockReset();
  });

  it('桌面端使用右侧面板承载共享内容与可访问关闭按钮', () => {
    vi.mocked(useMediaQuery).mockReturnValue(false);

    render(
      <ContextPanelShell
        open
        title="上下文详情"
        onOpenChange={vi.fn()}
        footer={<span>共享页脚</span>}
      >
        <p>共享内容</p>
      </ContextPanelShell>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('w-screen', 'max-w-[1000px]', 'sm:max-w-[1000px]');
    expect(screen.getByText('共享内容')).toBeInTheDocument();
    expect(screen.getByText('共享页脚')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });

  it('移动端使用全高抽屉承载共享内容', () => {
    vi.mocked(useMediaQuery).mockReturnValue(true);

    render(
      <ContextPanelShell open title="上下文详情" onOpenChange={vi.fn()}>
        <p>共享内容</p>
      </ContextPanelShell>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('h-dvh', 'max-h-dvh', 'rounded-none');
    expect(screen.getByText('共享内容')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
  });
});
