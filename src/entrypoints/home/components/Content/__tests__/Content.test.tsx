import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
// Semi 组件链间接拉入 lottie-web；jsdom 无 canvas 会崩，mock 掉
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({ destroy() {}, play() {}, pause() {}, addEventListener() {}, removeEventListener() {} }),
    destroy() {}, registerAnimation() {},
  },
}));
const contentMocks = vi.hoisted(() => ({ bookmarkCardSpy: vi.fn() }));
// 隔离子组件依赖
vi.mock('../../ContextList', () => ({ ContextList: () => null }));
vi.mock('../../BookmarkCard', () => ({
  BookmarkCard: (props: unknown) => { contentMocks.bookmarkCardSpy(props); return null; },
}));

// 可控 useBookmarks 状态(测试间重置)
let bookmarksState: Record<string, unknown>;
vi.mock('@/store/useBookmarks', () => ({
  useBookmarks: (sel: (s: Record<string, unknown>) => unknown) => sel(bookmarksState),
}));
vi.mock('@/store/useSearch', () => ({
  useSearch: (sel: (s: Record<string, unknown>) => unknown) => sel({ query: '', setQuery: vi.fn() }),
}));

import { Content } from '../../Content';
import type { OpenTab } from '../../../hooks/useOpenTabs';
import { useWorkspace } from '@/store/useWorkspace';

beforeEach(() => {
  contentMocks.bookmarkCardSpy.mockClear();
  bookmarksState = {
    loading: false,
    bookmarks: [],
    allBookmarks: [],
    loadBookmarks: vi.fn(),
    loadAllByWorkspace: vi.fn(),
    createBookmark: vi.fn(async () => ({ id: 'b1' })),
    refreshBookmark: vi.fn(),
  };
  useWorkspace.setState({
    categories: [{ id: 'c1', workspaceId: 'w1', name: '工作', icon: '💼', order: 0, createdAt: 0 }],
    currentCategoryId: 'c1',
    currentWorkspaceId: 'w1',
    workspaces: [],
  });

});


describe('Content runtime favicon 分发', () => {
  it('匹配打开 Tab 后把 runtime favicon 传给 BookmarkCard', () => {
    bookmarksState.bookmarks = [{
      id: 'b1', workspaceId: 'w1', categoryId: 'c1', name: 'GitHub',
      url: 'https://github.com', description: '', faviconUrl: '', contextCount: 0,
      hasEncryptedContext: false, createdAt: 1, updatedAt: 1,
    }];
    const openTabs: OpenTab[] = [{
      url: 'https://github.com/settings', tabId: 7, lastAccessed: 100,
      favIconUrl: 'https://github.com/runtime.svg',
    }];

    render(<Content openTabs={openTabs} />);

    expect(contentMocks.bookmarkCardSpy).toHaveBeenCalledWith(expect.objectContaining({
      hasOpenTab: true,
      runtimeFavIconUrl: 'https://github.com/runtime.svg',
    }));
  });

});

describe('Content 骨架屏（T2）', () => {
  it('loading=true 且书签视图时渲染 Semi Skeleton 骨架', () => {
    bookmarksState.loading = true;
    const { container } = render(<Content openTabs={[]} />);
    expect(container.querySelector('.semi-skeleton')).toBeTruthy();
  });
});

describe('Content 视图切换状态机(Tabs type=card)', () => {
  // Semi Tabs:每个切换项 role="tab";[0]=书签 [1]=标签页
  const tab = (container: HTMLElement, index: number) =>
    container.querySelectorAll('[role="tab"]')[index] as HTMLElement;

  it('默认书签视图:Tabs 含「书签」与「标签页(N)」两项', () => {
    const { container } = render(<Content openTabs={[]} />);
    expect(container.querySelectorAll('[role="tab"]').length).toBe(2);
    // jsdom 无 chrome → useOpenTabs 返回 [] → 标签页计数 0
    expect(container.textContent).toContain('标签页(0)');
    // 默认书签视图:不应出现 tabs 视图的空状态文案(keepDOM=false 仅渲染活动面板)
    expect(container.textContent).not.toContain('当前窗口没有其他标签页');
  });

  it('切到标签页视图:点击 标签页 tab → 渲染 TabList 空状态 + 保存至提示', () => {
    const { container } = render(<Content openTabs={[]} />);
    fireEvent.click(tab(container, 1));

    expect(container.textContent).toContain('当前窗口没有其他标签页');
    expect(container.textContent).toContain('保存至');
  });

  it('切回书签视图:不再渲染 TabList', () => {
    const { container } = render(<Content openTabs={[]} />);
    fireEvent.click(tab(container, 1));
    expect(container.textContent).toContain('当前窗口没有其他标签页');

    fireEvent.click(tab(container, 0));
    expect(container.textContent).not.toContain('当前窗口没有其他标签页');
  });
});
