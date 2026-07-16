import { describe, it, expect, vi } from 'vitest';
vi.mock('@/services/ContextService', () => ({
  getContexts: vi.fn().mockResolvedValue([
    { id: 'ctx1', title: '上下文一', isEncrypted: false, updatedAt: 0, type: 'note', order: 0, createdAt: 0 },
  ]),
  createContext: vi.fn(),
  deleteContext: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/store/useBookmarks', () => ({
  useBookmarks: (sel: (s: Record<string, unknown>) => unknown) => sel({ refreshBookmark: vi.fn() }),
}));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('../../ContextEditor', () => ({ ContextEditor: () => null }));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextList } from '../../ContextList';
import { getContexts } from '@/services/ContextService';
import type { Bookmark } from '@/shared/types';

const bookmark = {
  id: 'b1', workspaceId: 'w1', categoryId: 'c1', name: '测试书签',
  url: 'https://github.com', description: '', faviconUrl: '',
  contextCount: 1, hasEncryptedContext: false, createdAt: 0, updatedAt: 0,
} as Bookmark;

describe('ContextList（T6 Semi List 迁移）', () => {
  it('列表态显示内容标题、记录数与新增操作', async () => {
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: '上下文' })).toBeInTheDocument();
    expect(screen.getByText('1 条记录')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增上下文' })).toBeInTheDocument();
  });

  it('长连续标题不会挤出右侧删除操作', async () => {
    const longTitle = '这是一个没有任何空格且非常非常非常非常非常非常非常长的上下文标题';
    vi.mocked(getContexts).mockResolvedValueOnce([
      {
        id: 'ctx-long',
        title: longTitle,
        isEncrypted: true,
        updatedAt: 0,
        type: 'note',
        order: 0,
        createdAt: 0,
      } as never,
    ]);
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);

    const mainAction = await screen.findByRole('button', { name: `编辑上下文 ${longTitle}` });
    const deleteAction = screen.getByRole('button', { name: `删除上下文 ${longTitle}` });

    expect(mainAction).toHaveClass('min-w-0', 'overflow-hidden');
    expect(screen.getByText(longTitle)).toHaveClass('min-w-0', 'truncate');
    expect(deleteAction).toHaveClass('shrink-0');
  });

  it.each(['{Enter}', ' '])('聚焦上下文主操作后按 %s 进入编辑态', async (key) => {
    const user = userEvent.setup();
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);
    const editButton = await screen.findByRole('button', { name: '编辑上下文 上下文一' });

    editButton.focus();
    await user.keyboard(key);

    expect(screen.queryByRole('button', { name: '编辑上下文 上下文一' })).not.toBeInTheDocument();
  });

  it('点击删除按钮只打开确认框，不进入编辑态', async () => {
    const user = userEvent.setup();
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);
    const editButton = await screen.findByRole('button', { name: '编辑上下文 上下文一' });

    await user.click(screen.getByRole('button', { name: '删除上下文 上下文一' }));

    expect(screen.getByText('确认删除该上下文？')).toBeInTheDocument();
    expect(editButton).toBeInTheDocument();
  });

  it('加载后渲染上下文列表项', async () => {
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);
    expect(await screen.findByText('上下文一')).toBeInTheDocument();
  });
});
