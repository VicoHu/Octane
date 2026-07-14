import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { SortableBookmarkCard } from '../SortableBookmarkCard';
import type { Bookmark } from '@/shared/types';

// BookmarkCard 走 useFavicon;mock 返回 null → 首字母回退,不触发网络
vi.mock('@/hooks/useFavicon', () => ({ useFavicon: vi.fn(() => null) }));

const makeBookmark = (id: string): Bookmark => ({
  id,
  workspaceId: 'w1',
  categoryId: 'c1',
  name: `书签${id}`,
  url: 'https://x.com',
  description: '',
  faviconUrl: '',
  contextCount: 0,
  hasEncryptedContext: false,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
});

const renderSortables = (items: Bookmark[], disabled = false) =>
  render(
    <DndContext>
      <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
        {items.map((item) => (
          <SortableBookmarkCard
            key={item.id}
            bookmark={item}
            disabled={disabled}
            onClick={vi.fn()}
            onViewContexts={vi.fn()}
            onEditBookmark={vi.fn()}
            onDelete={vi.fn()}
          />
        ))}
      </SortableContext>
    </DndContext>,
  );

/**
 * dnd-kit 真拖拽在 jsdom 难测(pointer events,brief),这里测 affordance + disabled + 整卡 onClick 保留,
 * 不测真实 pointer 拖拽序列(留给真机 QA)。
 */
describe('SortableBookmarkCard — BookmarkCard grid 拖拽 wrapper(T4)', () => {
  it('渲染 grip 手柄:aria-roledescription=可拖拽项 + name=拖拽排序,且书签内容可见', () => {
    renderSortables([makeBookmark('1'), makeBookmark('2')]);
    const grips = screen.getAllByRole('button', { name: /拖拽排序/ });
    expect(grips).toHaveLength(2);
    expect(grips[0]!).toHaveAttribute('aria-roledescription', '可拖拽项');
    expect(screen.getByText('书签1')).toBeInTheDocument();
  });

  it('disabled(搜索态):grip 禁用 + aria-label=清除搜索后可拖拽排序', () => {
    renderSortables([makeBookmark('1'), makeBookmark('2')], true);
    // disabled button 嵌套在 Semi Card 内时,jsdom dom-accessibility-api 跳过 accessible-name 计算,
    // getByRole({name}) 不可靠(已知 jsdom 局限);用 aria-roledescription 定位 grip + jest-dom 属性断言
    const grips = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-roledescription') === '可拖拽项');
    expect(grips).toHaveLength(2);
    expect(grips[0]).toBeDisabled();
    expect(grips[0]).toHaveAttribute('aria-label', '清除搜索后可拖拽排序');
  });

  it('整卡点击跳转保留(D6:grip 只接管拖拽,不破坏 BookmarkCard onClick)', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <DndContext>
        <SortableContext items={['1']} strategy={rectSortingStrategy}>
          <SortableBookmarkCard
            bookmark={makeBookmark('1')}
            onClick={onClick}
            onViewContexts={vi.fn()}
            onEditBookmark={vi.fn()}
            onDelete={vi.fn()}
          />
        </SortableContext>
      </DndContext>,
    );
    await user.click(screen.getByText('书签1'));
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });
});
