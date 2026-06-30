import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../hooks/useCurrentTabContext', () => ({
  useCurrentTabContext: vi.fn(),
}));
vi.mock('../hooks/useHostBookmarks', () => ({
  useHostBookmarks: vi.fn(),
}));
vi.mock('../hooks/useSourceMap', () => ({
  useSourceMap: vi.fn(),
}));
vi.mock('../hooks/useEncryptedContexts', () => ({
  // BookmarkGroup 内部调用；App 测试聚焦四状态 + 分组结构，上下文层默认空
  useEncryptedContexts: vi.fn(() => ({ contexts: [], locked: false, error: null, loading: false })),
}));

import App from '../App';
import { useCurrentTabContext } from '../hooks/useCurrentTabContext';
import { useHostBookmarks } from '../hooks/useHostBookmarks';
import { useSourceMap } from '../hooks/useSourceMap';
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
const sourceMock = useSourceMap as ReturnType<typeof vi.fn>;

describe('App — 四状态 + 分组渲染', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 sourceMap 就绪空数据（四状态测试不依赖来源）
    sourceMock.mockReturnValue({ workspaces: [], categories: [], ready: true });
  });

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

  it('有命中 + sourceMap 就绪 → StickyHeader + 工作区/分类段头 + 书签卡（含分类 chip）', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    const matched = [makeBookmark('b1', 'Google'), makeBookmark('b2', 'Gmail')];
    hostMock.mockReturnValue({ matched, loading: false });
    sourceMock.mockReturnValue({
      workspaces: [{ id: 'w1', name: '工作区1', icon: '🗂', createdAt: 0, order: 0 }],
      categories: [{ id: 'c1', workspaceId: 'w1', name: '分类1', icon: '📁', order: 0, createdAt: 0 }],
      ready: true,
    });
    render(<App />);
    expect(screen.getByText('a.com')).toBeTruthy();
    expect(screen.getByText(/2 个书签命中/)).toBeTruthy();
    // 工作区段头（仅段头出现，唯一）；分类名同时出现在段头 + 卡片 chip（R1 常驻）
    expect(screen.getByText(/工作区1/)).toBeTruthy();
    expect(screen.getAllByText(/分类1/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.getByText('Gmail')).toBeTruthy();
  });
});
