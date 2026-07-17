import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
const contentMocks = vi.hoisted(() => ({ bookmarkCardSpy: vi.fn() }));
// 隔离子组件依赖
vi.mock('../../ContextList', () => ({ ContextList: () => null }));
vi.mock('../../BookmarkCard', () => ({
  BookmarkCard: (props: unknown) => { contentMocks.bookmarkCardSpy(props); return null; },
}));
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), close: vi.fn() },
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
import { Toast } from '@/components/ui/toast';
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
    render(<Content openTabs={[]} />);
    expect(screen.getAllByText((_, element) => element?.getAttribute('data-slot') === 'skeleton').length)
      .toBeGreaterThan(0);
  });
});

describe('Content 视图切换状态机(Tabs type=card)', () => {
  // Semi Tabs:每个切换项 role="tab";[0]=书签 [1]=标签页
  it('默认书签视图:Tabs 含「书签」与「标签页(N)」两项', () => {
    render(<Content openTabs={[]} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    // jsdom 无 chrome → useOpenTabs 返回 [] → 标签页计数 0
    expect(screen.getByRole('tab', { name: '标签页 0' })).toBeInTheDocument();
    // 默认书签视图:不应出现 tabs 视图的空状态文案(keepDOM=false 仅渲染活动面板)
    expect(screen.queryByText('当前窗口没有其他标签页')).not.toBeInTheDocument();
  });

  it('切到标签页视图:点击 标签页 tab → 渲染 TabList 空状态 + 保存至提示', async () => {
    const user = userEvent.setup();
    render(<Content openTabs={[]} />);
    await user.click(screen.getByRole('tab', { name: '标签页 0' }));

    expect(screen.getByText('当前窗口没有其他标签页')).toBeInTheDocument();
    expect(screen.getByText(/保存至/)).toBeInTheDocument();
  });

  it('切回书签视图:不再渲染 TabList', async () => {
    const user = userEvent.setup();
    render(<Content openTabs={[]} />);
    await user.click(screen.getByRole('tab', { name: '标签页 0' }));
    expect(screen.getByText('当前窗口没有其他标签页')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '书签 0' }));
    expect(screen.queryByText('当前窗口没有其他标签页')).not.toBeInTheDocument();
  });
});

describe('Content 添加书签反馈', () => {
  it('保存成功后的「添加上下文」为真实按钮', async () => {
    const user = userEvent.setup();
    render(<Content openTabs={[]} />);
    await user.click(screen.getAllByRole('button', { name: '添加书签' })[0]!);
    await user.type(await screen.findByPlaceholderText('https://example.com'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => expect(Toast.success).toHaveBeenCalledTimes(1));
    const toast = vi.mocked(Toast.success).mock.calls[0]![0] as { content: ReactNode };
    render(toast.content);

    expect(screen.getByRole('button', { name: '添加上下文' })).toBeInTheDocument();
  });
});
