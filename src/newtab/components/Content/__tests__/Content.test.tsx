import { describe, it, expect, vi, beforeEach } from 'vitest';
// Semi 组件链间接拉入 lottie-web；jsdom 无 canvas 会崩，mock 掉
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({ destroy() {}, play() {}, pause() {}, addEventListener() {}, removeEventListener() {} }),
    destroy() {}, registerAnimation() {},
  },
}));
// 隔离子组件依赖，聚焦 loading 骨架分支
vi.mock('@/newtab/components/ContextList', () => ({ ContextList: () => null }));
vi.mock('@/newtab/components/BookmarkCard', () => ({ BookmarkCard: () => null }));
vi.mock('@/store/useBookmarks', () => ({
  useBookmarks: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ loading: true, bookmarks: [], contextPreviews: {}, loadBookmarks: vi.fn(), createBookmark: vi.fn() }),
}));
vi.mock('@/store/useSearch', () => ({
  useSearch: (sel: (s: Record<string, unknown>) => unknown) => sel({ query: '', setQuery: vi.fn() }),
}));

import { render } from '@testing-library/react';
import { Content } from '@/newtab/components/Content';
import { useWorkspace } from '@/store/useWorkspace';

beforeEach(() => {
  useWorkspace.setState({
    categories: [{ id: 'c1', name: '工作', icon: '💼' }],
    currentCategoryId: 'c1',
    currentWorkspaceId: 'w1',
    workspaces: [],
  });
});

describe('Content 骨架屏（T2）', () => {
  it('loading=true 时渲染 Semi Skeleton 骨架', () => {
    const { container } = render(<Content />);
    expect(container.querySelector('.semi-skeleton')).toBeTruthy();
  });
});
