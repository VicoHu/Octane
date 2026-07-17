import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkspace } from '@/store/useWorkspace';
import { AppRail } from '..';

describe('AppRail — 工作区主导航', () => {
  const selectWorkspace = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    selectWorkspace.mockReset();
    selectWorkspace.mockResolvedValue();
    useWorkspace.setState({
      workspaces: [
        { id: 'w1', name: '主工作区', icon: '📁', createdAt: 0, order: 0 },
        { id: 'w2', name: '研究', icon: '🔬', createdAt: 0, order: 1 },
      ],
      currentWorkspaceId: 'w1',
      selectWorkspace,
    });
  });

  it('渲染全部工作区、当前状态和分隔线', () => {
    render(<AppRail />);

    expect(screen.getByText('📁')).toBeInTheDocument();
    expect(screen.getByText('🔬')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换到工作区 主工作区' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '切换到工作区 研究' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('点击工作区 → 切换到对应工作区', async () => {
    const user = userEvent.setup();
    render(<AppRail />);

    await user.click(screen.getByRole('button', { name: '切换到工作区 研究' }));

    expect(selectWorkspace).toHaveBeenCalledWith('w2');
  });

  it('悬停工作区 → 显示名称提示', async () => {
    const user = userEvent.setup();
    render(<AppRail />);

    await user.hover(screen.getByRole('button', { name: '切换到工作区 主工作区' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('主工作区');
  });
});
