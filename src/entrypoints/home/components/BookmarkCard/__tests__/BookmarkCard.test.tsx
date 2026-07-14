import { describe, it, expect, vi } from 'vitest';
// Semi 组件链（Card 等）间接拉入 lottie-web；jsdom 无 canvas 会崩，mock 掉
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {}, play() {}, pause() {}, addEventListener() {}, removeEventListener() {},
    }),
    destroy() {}, registerAnimation() {},
  },
}));
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    onClick?: () => void;
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
    expect(screen.getByText('GitHub')).toBeTruthy();
    expect(screen.getByText('github.com')).toBeTruthy();
    expect(screen.getByText('G')).toBeTruthy();
  });

  it('点击卡片触发 onClick（透传到 Card）', () => {
    const onClick = vi.fn();
    renderCard({}, { onClick });
    fireEvent.click(screen.getByText('GitHub'));
    expect(onClick).toHaveBeenCalledWith(bookmark);
  });

  it('点击操作按钮不冒泡到卡片 onClick（Semi Button 合成事件 stopPropagation 有效）', () => {
    const onClick = vi.fn();
    const onEdit = vi.fn();
    renderCard({}, { onClick, onEditBookmark: onEdit });
    fireEvent.click(screen.getByRole('button', { name: '编辑书签' }));
    expect(onEdit).toHaveBeenCalledWith(bookmark);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('查看上下文按钮触发 onViewContexts 且不冒泡', () => {
    const onClick = vi.fn();
    const onView = vi.fn();
    renderCard({}, { onClick, onViewContexts: onView });
    fireEvent.click(screen.getByRole('button', { name: '查看上下文' }));
    expect(onView).toHaveBeenCalledWith(bookmark);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('加密上下文书签显示锁徽章（替代旧脱敏文案）', () => {
    renderCard({ hasEncryptedContext: true, contextCount: 1 });
    const badge = screen.getByRole('img', { name: '包含加密上下文（1 条）' });
    // 锁徽章内含 svg（IconLock）
    expect(badge.querySelector('svg')).toBeTruthy();
  });

  it('明文上下文书签显示圆点徽章（无锁图标）', () => {
    renderCard({ contextCount: 2 });
    const badge = screen.getByRole('img', { name: '2 条上下文' });
    // 圆点徽章不含 svg
    expect(badge.querySelector('svg')).toBeNull();
  });

  it('无上下文书签不渲染徽章', () => {
    renderCard({ contextCount: 0 });
    expect(screen.queryByRole('img', { name: /上下文/ })).toBeNull();
  });

  it('hasOpenTab 时 Card aria-label 标注已打开', () => {
    const { container } = renderCard({}, {}, true);
    expect(container.querySelector('[aria-label="GitHub，已打开"]')).toBeTruthy();
  });

  it('hasOpenTab 缺省时 Card aria-label 仅书签名', () => {
    const { container } = renderCard();
    expect(container.querySelector('[aria-label="GitHub"]')).toBeTruthy();
  });

  it('T9 渲染删除按钮且带 aria-label="删除书签"', () => {
    renderCard();
    expect(screen.getByRole('button', { name: '删除书签' })).toBeTruthy();
  });

  it('T8a 无上下文(count=0)时 Popconfirm 文案不含计数', async () => {
    renderCard({ contextCount: 0 });
    fireEvent.click(screen.getByRole('button', { name: '删除书签' }));
    await waitFor(() => {
      expect(screen.getByText('确定删除该书签？')).toBeTruthy();
    });
  });

  it('T8b 有上下文(count>0)时 Popconfirm 文案显示计数', async () => {
    renderCard({ contextCount: 3 });
    fireEvent.click(screen.getByRole('button', { name: '删除书签' }));
    await waitFor(() => {
      expect(screen.getByText(/将同时删除 3 条上下文/)).toBeTruthy();
    });
  });

  it('删除按钮点击不冒泡到卡片 onClick（容器级 stopPropagation）', () => {
    const onClick = vi.fn();
    renderCard({}, { onClick });
    fireEvent.click(screen.getByRole('button', { name: '删除书签' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('favicon 渲染走 useFavicon（不再读 bookmark.faviconUrl）', () => {
    vi.mocked(useFavicon).mockReturnValue({ kind: 'third-party', src: 'blob:abc', onError: vi.fn() });
    renderCard({ url: 'https://github.com', faviconUrl: 'https://old.example/icon.png' });
    const img = screen.getByRole('listitem').querySelector('img');
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
    fireEvent.error(screen.getByRole('listitem').querySelector('img')!);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
