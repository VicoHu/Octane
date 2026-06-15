import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../hooks/useCurrentTabContext', () => ({
  useCurrentTabContext: vi.fn(),
}));
vi.mock('../hooks/useHostBookmarks', () => ({
  useHostBookmarks: vi.fn(),
}));
vi.mock('../hooks/useEncryptedContexts', () => ({
  // BookmarkGroup 内部调用；App 测试聚焦四状态 + 分组结构，上下文层默认空
  useEncryptedContexts: vi.fn(() => ({ contexts: [], locked: false, error: null, loading: false })),
}));

import App from '../App';
import { useCurrentTabContext } from '../hooks/useCurrentTabContext';
import { useHostBookmarks } from '../hooks/useHostBookmarks';
import type { Bookmark } from '@/shared/types';

function makeBookmark(id: string, name: string): Bookmark {
  return {
    id, workspaceId: 'w1', categoryId: 'c1', name, url: `https://${id}.com`,
    description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: false,
    createdAt: 0, updatedAt: 0,
  };
}
const tabMock = useCurrentTabContext as ReturnType<typeof vi.fn>;
const hostMock = useHostBookmarks as ReturnType<typeof vi.fn>;

describe('App — 四状态 + 分组渲染', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tab loading → 显示加载中', () => {
    tabMock.mockReturnValue({ hostname: null, loading: true });
    hostMock.mockReturnValue({ matched: [], loading: false });
    render(<App />);
    expect(screen.getByText('加载中…')).toBeTruthy();
  });

  it('hostname 为 null（非 http(s)）→ 此页面不支持联动', () => {
    tabMock.mockReturnValue({ hostname: null, loading: false });
    hostMock.mockReturnValue({ matched: [], loading: false });
    render(<App />);
    expect(screen.getByText('此页面不支持联动')).toBeTruthy();
  });

  it('匹配中 → 显示匹配态', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    hostMock.mockReturnValue({ matched: [], loading: true });
    render(<App />);
    expect(screen.getByText('匹配中…')).toBeTruthy();
  });

  it('无命中 → 空状态 + 在 Octane 管理', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    hostMock.mockReturnValue({ matched: [], loading: false });
    render(<App />);
    expect(screen.getByText(/无匹配书签/)).toBeTruthy();
    expect(screen.getByText('在 Octane 管理')).toBeTruthy();
  });

  it('有命中 → StickyHeader + 按书签分组渲染', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    const matched = [makeBookmark('b1', 'Google'), makeBookmark('b2', 'Gmail')];
    hostMock.mockReturnValue({ matched, loading: false });
    render(<App />);
    expect(screen.getByText('a.com')).toBeTruthy();
    expect(screen.getByText(/2 个书签命中/)).toBeTruthy();
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.getByText('Gmail')).toBeTruthy();
  });
});
