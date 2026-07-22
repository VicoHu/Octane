import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkspace } from '@/store/useWorkspace';

// 门控入口 mock：AppRail 的职责是「点击工作区 → 调切换入口」，
// switchWorkspace 的分流行为（off/close）由 workspaceSwitcher.test.ts 独立覆盖。
vi.mock('@/entrypoints/home/utils/workspaceSwitcher', () => ({
  switchWorkspace: vi.fn(),
}));

import { switchWorkspace } from '@/entrypoints/home/utils/workspaceSwitcher';
import { AppRail } from '..';

describe('AppRail — 工作区主导航', () => {
  beforeEach(() => {
    vi.mocked(switchWorkspace).mockReset();
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
    render(<AppRail />);

    expect(screen.getByText('📁')).toBeInTheDocument();
    expect(screen.getByText('🔬')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换到工作区 主工作区' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '切换到工作区 研究' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('点击工作区 → 调门控切换入口 switchWorkspace', async () => {
    const user = userEvent.setup();
    render(<AppRail />);

    await user.click(screen.getByRole('button', { name: '切换到工作区 研究' }));

    expect(switchWorkspace).toHaveBeenCalledWith('w2');
  });

  it('T8：切换中（switching != null）→ 工作区按钮禁用（防重复点击）', () => {
    useWorkspace.setState({
      switching: { toId: 'w2', phase: 'dispose', count: 1, total: 2 },
    });
    render(<AppRail />);

    expect(screen.getByRole('button', { name: '切换到工作区 主工作区' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '切换到工作区 研究' })).toBeDisabled();
  });

  it('悬停工作区 → 显示名称提示', async () => {
    const user = userEvent.setup();
    render(<AppRail />);

    await user.hover(screen.getByRole('button', { name: '切换到工作区 主工作区' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('主工作区');
  });

  it('快速切换工作区后移出 → 只显示当前提示且最终全部关闭', async () => {
    const user = userEvent.setup();
    render(<AppRail />);
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
});
