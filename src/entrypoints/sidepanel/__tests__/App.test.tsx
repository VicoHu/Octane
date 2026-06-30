import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Semi Collapse 依赖 lottie-web，在 jsdom 模块加载时触发 canvas null 错误。
// 用轻量 mock 替代：所有 panel header 恒渲染，仅 active panel 的 children 渲染
// （匹配 Semi Collapse keepDOM=false 的折叠语义，用于验证默认展开/折叠逻辑）。
vi.mock('@douyinfe/semi-ui', () => {
  const Collapse: any = ({ activeKey, children }: any) => {
    const active = Array.isArray(activeKey) ? activeKey : activeKey ? [activeKey] : [];
    const arr = Array.isArray(children) ? children : children ? [children] : [];
    return arr.map((p: any, i: number) => (
      <div key={p.props.itemKey ?? i}>
        {p.props.header}
        {active.includes(p.props.itemKey) ? p.props.children : null}
      </div>
    ));
  };
  Collapse.Panel = () => null;
  return { Collapse };
});

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

function makeBookmark(id: string, name: string, wsId = 'w1', catId = 'c1'): Bookmark {
  return {
    id, workspaceId: wsId, categoryId: catId, name, url: `https://${id}.com`,
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

  it('≥2 工作区 + 总命中>6 → Collapse 默认仅展开命中最多者，其余折叠（T2）', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    // ws1: 6 书签，ws2: 1 书签 → 总命中 7 >6 → 默认仅展开 ws1
    const matched = [
      ...Array.from({ length: 6 }, (_, i) => makeBookmark(`b1-${i}`, `WS1-${i}`, 'w1', 'c1')),
      makeBookmark('b2-0', 'WS2-ONLY', 'w2', 'c2'),
    ];
    hostMock.mockReturnValue({ matched, loading: false });
    sourceMock.mockReturnValue({
      workspaces: [
        { id: 'w1', name: '工作区1', icon: '🗂', createdAt: 0, order: 0 },
        { id: 'w2', name: '工作区2', icon: '🗂', createdAt: 0, order: 1 },
      ],
      categories: [
        { id: 'c1', workspaceId: 'w1', name: '分类1', icon: '📁', order: 0, createdAt: 0 },
        { id: 'c2', workspaceId: 'w2', name: '分类2', icon: '📁', order: 0, createdAt: 0 },
      ],
      ready: true,
    });
    render(<App />);
    // 两个段头恒在（Collapse panel header）
    expect(screen.getByText(/工作区1/)).toBeTruthy();
    expect(screen.getByText(/工作区2/)).toBeTruthy();
    // ws1 展开 → 内容可见
    expect(screen.getByText('WS1-0')).toBeTruthy();
    // ws2 折叠 → 内容不可见（keepDOM=false，折叠面板内容不在 DOM）
    expect(screen.queryByText('WS2-ONLY')).toBeNull();
  });
});