import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refreshBookmark: vi.fn(),
}));

vi.mock('@/services/ContextService', () => ({
  getContexts: vi.fn(),
  createContext: vi.fn(),
  deleteContext: vi.fn(),
  updateContext: vi.fn(),
}));
vi.mock('@/store/useBookmarks', () => ({
  useBookmarks: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ refreshBookmark: mocks.refreshBookmark }),
}));
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (sel: (s: { unlocked: boolean }) => unknown) => sel({ unlocked: true }),
}));
vi.mock('@/components/ui/toast', () => ({
  Toast: {
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextList } from '../../ContextList';
import { createContext, deleteContext, getContexts } from '@/services/ContextService';
import { ContextType, type Bookmark, type Context } from '@/shared/types';

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    id: 'ctx1',
    bookmarkId: 'b1',
    title: '上下文一',
    content: '正文内容',
    isEncrypted: false,
    updatedAt: 0,
    type: ContextType.NOTE,
    order: 0,
    createdAt: 0,
    ...overrides,
  };
}

const defaultContext = makeContext();

const bookmark = {
  id: 'b1', workspaceId: 'w1', categoryId: 'c1', name: '测试书签',
  url: 'https://github.com', description: '', faviconUrl: '',
  contextCount: 1, hasEncryptedContext: false, createdAt: 0, updatedAt: 0, order: 0,
} satisfies Bookmark;

beforeEach(() => {
  vi.mocked(getContexts).mockReset().mockResolvedValue([defaultContext]);
  vi.mocked(createContext).mockReset();
  vi.mocked(deleteContext).mockReset().mockResolvedValue(undefined);
  mocks.refreshBookmark.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ContextList（T6 Semi List 迁移）', () => {
  it('书签失效后不再渲染旧上下文内容', async () => {
    const { rerender } = render(
      <ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />,
    );
    expect(await screen.findByText('上下文一')).toBeInTheDocument();

    rerender(<ContextList bookmark={null} visible={false} onClose={vi.fn()} />);

    expect(screen.queryByText('上下文一')).not.toBeInTheDocument();
  });

  it('列表态显示内容标题、记录数与新增操作', async () => {
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: '上下文' })).toBeInTheDocument();
    expect(screen.getByText('1 条记录')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增上下文' })).toBeInTheDocument();
  });

  it('长连续标题不会挤出右侧删除操作', async () => {
    const longTitle = '这是一个没有任何空格且非常非常非常非常非常非常非常长的上下文标题';
    vi.mocked(getContexts).mockResolvedValueOnce([
      makeContext({ id: 'ctx-long', title: longTitle, isEncrypted: true }),
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

  it('点击列表项后显示真实上下文编辑器', async () => {
    const user = userEvent.setup();
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: '编辑上下文 上下文一' }));

    expect(screen.getByRole('textbox', { name: '上下文标题' })).toHaveValue('上下文一');
    expect(screen.getByRole('textbox', { name: '上下文内容' })).toHaveValue('正文内容');
  });

  it('点击关闭上下文面板后调用一次关闭回调', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ContextList bookmark={bookmark} visible={true} onClose={onClose} />);
    await screen.findByText('上下文一');

    await user.click(screen.getByRole('button', { name: '关闭上下文面板' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('从真实编辑器返回后重新加载上下文', async () => {
    const user = userEvent.setup();
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: '编辑上下文 上下文一' }));
    await user.click(screen.getByRole('button', { name: '返回' }));

    await waitFor(() => expect(getContexts).toHaveBeenCalledTimes(2));
  });

  it('新增上下文后进入真实编辑器', async () => {
    const user = userEvent.setup();
    vi.mocked(createContext).mockResolvedValueOnce(
      makeContext({ id: 'ctx-created', title: '上下文 2', content: '' }),
    );
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);
    await screen.findByText('上下文一');

    await user.click(screen.getByRole('button', { name: '新增上下文' }));

    expect(await screen.findByRole('textbox', { name: '上下文标题' })).toHaveValue('上下文 2');
  });

  it('确认删除后刷新书签并更新列表与计数', async () => {
    const user = userEvent.setup();
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: '编辑上下文 上下文一' });

    await user.click(screen.getByRole('button', { name: '删除上下文 上下文一' }));
    await user.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(deleteContext).toHaveBeenCalledWith('ctx1'));
    await waitFor(() => expect(mocks.refreshBookmark).toHaveBeenCalledWith('b1'));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '编辑上下文 上下文一' })).not.toBeInTheDocument();
      expect(screen.getByText('0 条记录')).toBeInTheDocument();
    });
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
