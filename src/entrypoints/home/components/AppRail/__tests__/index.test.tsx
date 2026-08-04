import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkspace } from '@/store/useWorkspace';

import { AppRail } from '..';

const onNavigate = vi.fn();
const onWorkspaceSelect = vi.fn();

describe('AppRail — 工作区主导航', () => {
  beforeEach(() => {
    onNavigate.mockReset();
    onWorkspaceSelect.mockReset();
    useWorkspace.setState({
      workspaces: [
        { id: 'w1', name: '主工作区', icon: '📁', createdAt: 0, order: 0 },
        { id: 'w2', name: '研究', icon: '🔬', createdAt: 0, order: 1 },
      ],
      currentWorkspaceId: 'w1',
      switching: null,
    });
  });

  it('渲染全部工作区、当前状态和分隔线', () => {
    render(<AppRail activePage="home" onNavigate={onNavigate} onWorkspaceSelect={onWorkspaceSelect} />);

    expect(screen.getByText('📁')).toBeInTheDocument();
    expect(screen.getByText('🔬')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换到工作区 主工作区' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '切换到工作区 研究' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('点击工作区 → 通知 App 执行门控切换', async () => {
    const user = userEvent.setup();
    render(<AppRail activePage="home" onNavigate={onNavigate} onWorkspaceSelect={onWorkspaceSelect} />);

    await user.click(screen.getByRole('button', { name: '切换到工作区 研究' }));

    expect(onWorkspaceSelect).toHaveBeenCalledWith('w2');
  });

  it('T8：切换中（switching != null）→ 工作区按钮禁用（防重复点击）', () => {
    useWorkspace.setState({
      switching: { toId: 'w2', phase: 'dispose', count: 1, total: 2 },
    });
    render(<AppRail activePage="home" onNavigate={onNavigate} onWorkspaceSelect={onWorkspaceSelect} />);

    expect(screen.getByRole('button', { name: '切换到工作区 主工作区' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '切换到工作区 研究' })).toBeDisabled();
  });

  it('悬停工作区 → 显示名称提示', async () => {
    const user = userEvent.setup();
    render(<AppRail activePage="home" onNavigate={onNavigate} onWorkspaceSelect={onWorkspaceSelect} />);

    await user.hover(screen.getByRole('button', { name: '切换到工作区 主工作区' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('主工作区');
  });

  it('快速切换工作区后移出 → 只显示当前提示且最终全部关闭', async () => {
    const user = userEvent.setup();
    render(<AppRail activePage="home" onNavigate={onNavigate} onWorkspaceSelect={onWorkspaceSelect} />);
    const first = screen.getByRole('button', { name: '切换到工作区 主工作区' });
    const second = screen.getByRole('button', { name: '切换到工作区 研究' });

    await user.hover(first);
    await user.hover(second);

    await waitFor(() => {
      const tooltips = screen.getAllByRole('tooltip');
      expect(tooltips).toHaveLength(1);
      expect(tooltips[0]).toHaveTextContent('研究');
    });

    await user.unhover(second);
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it('主页与待办事项互斥激活，并提供当前页语义', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AppRail activePage="home" onNavigate={onNavigate} onWorkspaceSelect={onWorkspaceSelect} />,
    );

    const homeButton = screen.getByRole('button', { name: '主页' });
    const tasksButton = screen.getByRole('button', { name: '待办事项' });
    expect(homeButton).toHaveAttribute('aria-current', 'page');
    expect(homeButton).toHaveClass('is-active');
    expect(tasksButton).not.toHaveAttribute('aria-current');
    expect(tasksButton).not.toHaveClass('is-active');

    await user.hover(tasksButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('待办事项');
    await user.click(tasksButton);
    expect(onNavigate).toHaveBeenCalledWith('tasks');

    rerender(<AppRail activePage="tasks" onNavigate={onNavigate} onWorkspaceSelect={onWorkspaceSelect} />);
    expect(screen.getByRole('button', { name: '待办事项' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '主页' })).not.toHaveAttribute('aria-current');
  });
});
