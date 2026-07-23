import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookmarkCard } from '../../BookmarkCard';
import { useFavicon } from '@/hooks/useFavicon';
import type { Bookmark } from '@/shared/types';

vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => null),
}));

const bookmark: Bookmark = {
  id: 'b1',
  workspaceId: 'w1',
  categoryId: 'c1',
  name: 'GitHub',
  url: 'https://github.com/page',
  description: '代码托管',
  faviconUrl: '',
  contextCount: 0,
  hasEncryptedContext: false,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
};

const renderCard = (
  overrides: Partial<Bookmark> = {},
  handlers: {
    onClick?: (...args: unknown[]) => void;
    onViewContexts?: () => void;
    onEditBookmark?: () => void;
    onDelete?: () => void;
  } = {},
  hasOpenTab?: boolean,
  runtimeFavIconUrl?: string,
) =>
  render(
    <BookmarkCard
      bookmark={{ ...bookmark, ...overrides }}
      hasOpenTab={hasOpenTab}
      runtimeFavIconUrl={runtimeFavIconUrl}
      onClick={handlers.onClick ?? vi.fn()}
      onViewContexts={handlers.onViewContexts ?? vi.fn()}
      onEditBookmark={handlers.onEditBookmark ?? vi.fn()}
      onDelete={handlers.onDelete ?? vi.fn()}
    />,
  );

describe('BookmarkCard', () => {
  it('渲染书签名、域名，且 favicon 缺省时回退首字母', () => {
    renderCard();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('github.com')).toBeInTheDocument();
    expect(screen.getByText('G')).toBeInTheDocument();
  });

  it('点击主操作按钮 → 调用 onClick 并传入书签', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderCard({}, { onClick });

    await user.click(screen.getByRole('button', { name: '打开书签 GitHub' }));

    expect(onClick).toHaveBeenCalledWith(bookmark);
  });

  it('Cmd/Ctrl + 左键 → 将修饰键事件传给打开入口', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderCard({}, { onClick });

    const openButton = screen.getByRole('button', { name: '打开书签 GitHub' });
    await user.keyboard('[ControlLeft>]');
    await user.click(openButton);
    await user.keyboard('[/ControlLeft]');

    expect(onClick).toHaveBeenCalledWith(bookmark, expect.objectContaining({ ctrlKey: true }));
  });

  it('主操作按钮是唯一入口且包含上下文徽章', () => {
    renderCard({ contextCount: 2 });
    const mainAction = screen.getByRole('button', { name: '打开书签 GitHub' });

    expect(within(mainAction).getByRole('img', { name: '2 条上下文' })).toBeInTheDocument();
  });

  it('主操作按钮获得焦点后 → Enter 与 Space 均打开书签', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderCard({}, { onClick });
    const mainAction = screen.getByRole('button', { name: '打开书签 GitHub' });
    await user.tab();
    expect(mainAction).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onClick).toHaveBeenNthCalledWith(1, bookmark);
    expect(onClick).toHaveBeenNthCalledWith(2, bookmark);
  });

  it('点击编辑书签 → 只调用编辑回调，不重复调用主操作', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onEdit = vi.fn();
    renderCard({}, { onClick, onEditBookmark: onEdit });

    await user.click(screen.getByRole('button', { name: '打开书签 GitHub' }));
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '编辑书签' }));

    expect(onEdit).toHaveBeenCalledWith(bookmark);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('查看上下文按钮触发 onViewContexts 且不冒泡', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onView = vi.fn();
    renderCard({}, { onClick, onViewContexts: onView });

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '查看上下文' }));

    expect(onView).toHaveBeenCalledWith(bookmark);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('加密上下文书签显示锁徽章（替代旧脱敏文案）', () => {
    renderCard({ hasEncryptedContext: true, contextCount: 1 });
    expect(screen.getByRole('img', { name: '包含加密上下文（1 条）' })).toBeInTheDocument();
  });

  it('明文上下文书签显示圆点徽章（无锁图标）', () => {
    renderCard({ contextCount: 2 });
    expect(screen.getByRole('img', { name: '2 条上下文' })).toBeInTheDocument();
  });

  it('点击上下文徽章 → 与主操作相同地打开书签', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderCard({ contextCount: 2 }, { onClick });
    const badge = screen.getByRole('img', { name: '2 条上下文' });
    expect(badge).toBeVisible();

    await user.click(badge);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith({ ...bookmark, contextCount: 2 });
  });

  it('无上下文书签不渲染徽章', () => {
    renderCard({ contextCount: 0 });
    expect(screen.queryByRole('img', { name: /上下文/ })).toBeNull();
  });

  it('hasOpenTab 时 Card aria-label 标注已打开', () => {
    renderCard({}, {}, true);
    expect(screen.getByRole('listitem', { name: 'GitHub，已打开' })).toBeInTheDocument();
  });

  it('hasOpenTab 缺省时 Card aria-label 仅书签名', () => {
    renderCard();
    expect(screen.getByRole('listitem', { name: 'GitHub' })).toBeInTheDocument();
  });

  it('悬浮操作区只渲染更多操作按钮，展开后显示三项操作', async () => {
    const user = userEvent.setup();
    renderCard();

    expect(screen.getByRole('button', { name: '更多操作' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看上下文' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑书签' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除书签' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '更多操作' }));

    expect(await screen.findByRole('menuitem', { name: '查看上下文' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '编辑书签' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '删除书签' })).toBeInTheDocument();
  });

  it('T8a 无上下文(count=0)时 Popconfirm 文案不含计数', async () => {
    const user = userEvent.setup();
    renderCard({ contextCount: 0 });

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '删除书签' }));

    await waitFor(() => {
      expect(screen.getByText('确定删除该书签？')).toBeInTheDocument();
    });
  });

  it('T8b 有上下文(count>0)时 Popconfirm 文案显示计数', async () => {
    const user = userEvent.setup();
    renderCard({ contextCount: 3 });

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '删除书签' }));

    await waitFor(() => {
      expect(screen.getByText(/将同时删除 3 条上下文/)).toBeInTheDocument();
    });
  });

  it('删除菜单项不触发卡片 onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderCard({}, { onClick });

    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(await screen.findByRole('menuitem', { name: '删除书签' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('favicon 渲染走 useFavicon（不再读 bookmark.faviconUrl）', () => {
    vi.mocked(useFavicon).mockReturnValue({ kind: 'third-party', src: 'blob:abc', onError: vi.fn() });
    renderCard({ url: 'https://github.com', faviconUrl: 'https://old.example/icon.png' });
    const img = screen.getByRole('presentation');
    expect(img).toHaveAttribute('src', 'blob:abc');
    // 旧 faviconUrl 字段不再被使用
    expect(img).not.toHaveAttribute('src', 'https://old.example/icon.png');
  });

  it('useFavicon 返回 null → 回退首字母', () => {
    vi.mocked(useFavicon).mockReturnValue(null);
    renderCard({ name: 'GitHub', url: 'https://github.com' });
    expect(screen.getByText('G')).toBeInTheDocument();
  });

  it('把 runtime favicon 传给 hook，并把图片错误交给 hook', () => {
    const onError = vi.fn();
    vi.mocked(useFavicon).mockReturnValue({
      kind: 'tab',
      src: 'https://github.com/runtime.svg',
      onError,
    });
    renderCard({}, {}, true, 'https://github.com/runtime.svg');

    expect(useFavicon).toHaveBeenCalledWith(
      'https://github.com/page',
      'https://github.com/runtime.svg',
    );
    // 图片加载失败是底层 error 事件，userEvent 不提供对应 API，允许直接派发。
    fireEvent.error(screen.getByRole('presentation'));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
