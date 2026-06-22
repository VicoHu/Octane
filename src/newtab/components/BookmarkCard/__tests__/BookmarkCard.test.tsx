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
import { render, screen, fireEvent } from '@testing-library/react';
import { BookmarkCard } from '@/newtab/components/BookmarkCard';
import type { Bookmark } from '@/shared/types';

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
  createdAt: 0,
  updatedAt: 0,
};

const renderCard = (overrides: Partial<Bookmark> = {}, handlers = {}, hasOpenTab?: boolean) =>
  render(
    <BookmarkCard
      bookmark={{ ...bookmark, ...overrides }}
      hasOpenTab={hasOpenTab}
      onClick={handlers.onClick ?? vi.fn()}
      onViewContexts={handlers.onViewContexts ?? vi.fn()}
      onEditBookmark={handlers.onEditBookmark ?? vi.fn()}
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
});
