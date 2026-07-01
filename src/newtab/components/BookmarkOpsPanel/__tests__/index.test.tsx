import { describe, it, expect, vi, beforeEach } from 'vitest';
// Semi 组件链间接拉入 lottie-web；jsdom 无 canvas 会崩，mock 掉
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {}, play() {}, pause() {}, addEventListener() {}, removeEventListener() {},
    }),
    destroy() {}, registerAnimation() {},
  },
}));
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BookmarkOpsPanel, type BookmarkOpsPanelHandle } from '@/newtab/components/BookmarkOpsPanel';
import type { Bookmark, Workspace, Category } from '@/shared/types';

const bookmark: Bookmark = {
  id: 'b1',
  workspaceId: 'w1',
  categoryId: 'c1',
  name: 'GitHub',
  url: 'https://github.com',
  description: '',
  faviconUrl: '',
  contextCount: 0,
  hasEncryptedContext: false,
  createdAt: 0,
  updatedAt: 0,
};
const workspaces: Workspace[] = [
  { id: 'w1', name: '工作区A', icon: '💼', order: 0, createdAt: 0 },
  { id: 'w2', name: '工作区B', icon: '📚', order: 1, createdAt: 0 },
];
const w1Categories: Category[] = [
  { id: 'c1', workspaceId: 'w1', name: '分类1', icon: '📁', order: 0, createdAt: 0 },
];

const renderPanel = (
  categoriesLoader: (wsId: string) => Promise<Category[]>,
  onSubmit = vi.fn(),
) => {
  const ref = React.createRef<BookmarkOpsPanelHandle>();
  const utils = render(
    <BookmarkOpsPanel
      ref={ref}
      bookmark={bookmark}
      workspaces={workspaces}
      categoriesLoader={categoriesLoader}
      onSubmit={onSubmit}
    />,
  );
  return { ...utils, ref, onSubmit };
};

describe('BookmarkOpsPanel — 级联 Select 数据源 + 空分类防呆', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('T7 挂载时预载书签原属工作区的分类（categoriesLoader 为数据源，非 useWorkspace.categories）', async () => {
    const loader = vi.fn(async () => w1Categories);
    renderPanel(loader);

    await waitFor(() => {
      // 关键：级联 Select 的分类数据来自 categoriesLoader（当前工作区作用域的 useWorkspace.categories 无法跨工作区）
      expect(loader).toHaveBeenCalledWith('w1');
    });
  });

  it('T6 目标工作区无分类（loader 返回空）时显示 Banner 警告（防孤儿书签防呆）', async () => {
    // 切到空分类工作区 w2：loader 对 w2 返回 []
    const loader = vi.fn(async (wsId: string) =>
      wsId === 'w1' ? w1Categories : [],
    );
    renderPanel(loader);

    // 初始预载 w1（有分类）→ 等加载完
    await waitFor(() => {
      expect(loader).toHaveBeenCalledWith('w1');
    });

    // 直接断言防呆文案渲染机制存在（Banner 由 categoryEmpty 触发）：
    // 用 loader 返回空模拟空分类态——重新渲染一个空工作区场景
    document.body.innerHTML = '';
    const emptyLoader = vi.fn(async () => [] as Category[]);
    render(
      <BookmarkOpsPanel
        ref={React.createRef<BookmarkOpsPanelHandle>()}
        bookmark={{ ...bookmark, workspaceId: 'w-empty' }}
        workspaces={workspaces}
        categoriesLoader={emptyLoader}
        onSubmit={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('目标工作区无分类，请先创建')).toBeTruthy();
    });
  });
});
