import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkspace } from '@/store/useWorkspace';
import { WorkspaceCreateButton } from '..';

describe('WorkspaceCreateButton — 新建工作区', () => {
  const createWorkspace = vi.fn<() => Promise<void>>();

  beforeEach(() => {
    createWorkspace.mockReset();
    createWorkspace.mockResolvedValue();
    useWorkspace.setState({ createWorkspace });
  });

  it('填写名称并确定 → 创建工作区并关闭弹窗', async () => {
    const user = userEvent.setup();
    render(<WorkspaceCreateButton />);

    await user.click(screen.getByRole('button', { name: '新建工作区' }));
    await user.type(screen.getByPlaceholderText('工作区名称'), '研究');
    await user.click(screen.getByRole('button', { name: '确定' }));

    expect(createWorkspace).toHaveBeenCalledWith('研究', '📁');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
