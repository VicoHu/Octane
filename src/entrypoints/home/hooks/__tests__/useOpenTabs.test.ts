import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useOpenTabs } from '../useOpenTabs';

type TabLike = { id?: number; url?: string; lastAccessed?: number; title?: string; favIconUrl?: string; pinned?: boolean; index?: number; groupId?: number };
type TabGroupLike = { id: number; windowId: number; title?: string };

const workspaces = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000000', name: '工作', icon: 'briefcase', createdAt: 1, order: 0 },
  { id: 'bbbbbbbb-0000-0000-0000-000000000000', name: '学习', icon: 'book', createdAt: 2, order: 1 },
];

/**
 * mock chrome.tabs：query 可控，onCreated/onUpdated/onRemoved 可手动触发。
 * 参考 useCurrentTabContext.test.ts 的回调收集套路。
 */
function mockTabs(
  initial: TabLike[],
  options: { groups?: TabGroupLike[]; setting?: string; windowId?: number } = {},
) {
  let current = initial;
  let groups = options.groups ?? [];
  const listeners: Record<'onCreated' | 'onUpdated' | 'onRemoved', Array<() => void>> = {
    onCreated: [],
    onUpdated: [],
    onRemoved: [],
  };
  const groupListeners: Record<'onCreated' | 'onUpdated' | 'onMoved', Array<() => void>> = {
    onCreated: [],
    onUpdated: [],
    onMoved: [],
  };
  const queryMock = vi.fn(async () => current);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    windows: { getCurrent: vi.fn(async () => ({ id: options.windowId ?? 1 })) },
    storage: { local: { get: vi.fn(async () => ({ tabIsolationSetting: options.setting ?? 'off' })) } },
    tabs: {
      query: queryMock,
      onCreated: {
        addListener: vi.fn((cb: () => void) => listeners.onCreated.push(cb)),
        removeListener: vi.fn(),
      },
      onUpdated: {
        addListener: vi.fn((cb: () => void) => listeners.onUpdated.push(cb)),
        removeListener: vi.fn(),
      },
      onRemoved: {
        addListener: vi.fn((cb: () => void) => listeners.onRemoved.push(cb)),
        removeListener: vi.fn(),
      },
    },
    tabGroups: {
      query: vi.fn(async () => groups),
      onCreated: {
        addListener: vi.fn((cb: () => void) => groupListeners.onCreated.push(cb)),
        removeListener: vi.fn(),
      },
      onUpdated: {
        addListener: vi.fn((cb: () => void) => groupListeners.onUpdated.push(cb)),
        removeListener: vi.fn(),
      },
      onMoved: {
        addListener: vi.fn((cb: () => void) => groupListeners.onMoved.push(cb)),
        removeListener: vi.fn(),
      },
    },
  };
  return {
    queryMock,
    setQueryResult(next: TabLike[]) {
      current = next;
      queryMock.mockResolvedValue(next);
    },
    triggerCreated() {
      listeners.onCreated.forEach((cb) => cb());
    },
    triggerUpdated() {
      listeners.onUpdated.forEach((cb) => cb());
    },
    triggerRemoved() {
      listeners.onRemoved.forEach((cb) => cb());
    },
    setGroups(next: TabGroupLike[]) {
      groups = next;
    },
    triggerGroupCreated() {
      groupListeners.onCreated.forEach((cb) => cb());
    },
    triggerGroupUpdated() {
      groupListeners.onUpdated.forEach((cb) => cb());
    },
    triggerGroupMoved() {
      groupListeners.onMoved.forEach((cb) => cb());
    },
  };
}

describe('useOpenTabs — 返回当前窗口 tab 列表（按浏览器位置 index 升序）', () => {
  it('query 返回的 tab 映射为 OpenTab，按 index(浏览器位置)升序，不按 lastAccessed', async () => {
    // 设计决策:tab 列表须与浏览器 tab 栏顺序一致,避免用户困惑。
    // lastAccessed 不再作为默认排序,仅保留为字段(供书签"最近活跃"匹配等显式使用)。
    mockTabs([
      { id: 1, url: 'https://a.com', lastAccessed: 300, index: 2 }, // 最近活跃但最右
      { id: 2, url: 'https://b.com', lastAccessed: 100, index: 0 }, // 最左但最久未活跃
      { id: 3, url: 'https://c.com', lastAccessed: 200, index: 1 },
    ]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current.length).toBe(3));
    // 顺序 = index 升序 [b=0, c=1, a=2];若是 lastAccessed 降序会是 [a, c, b] → 用此区分
    expect(result.current.map((t) => t.tabId)).toEqual([2, 3, 1]);
    expect(result.current.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it('过滤无 url 或无 id 的 tab', async () => {
    mockTabs([
      { id: 1, url: 'https://a.com', lastAccessed: 100 },
      { id: undefined, url: 'https://b.com', lastAccessed: 200 },
      { id: 3, url: undefined, lastAccessed: 300 },
    ]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current).toEqual([
      { url: 'https://a.com', tabId: 1, lastAccessed: 100 },
    ]);
  });

  it('onCreated 触发刷新（重新 query 后列表更新）', async () => {
    const ctl = mockTabs([{ id: 1, url: 'https://a.com', lastAccessed: 100 }]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current.length).toBe(1));

    ctl.setQueryResult([
      { id: 1, url: 'https://a.com', lastAccessed: 100 },
      { id: 2, url: 'https://b.com', lastAccessed: 200 },
    ]);
    ctl.triggerCreated();
    await waitFor(() => expect(result.current.length).toBe(2));
  });

  it('onUpdated 触发刷新（tab 导航后 url 同步）', async () => {
    const ctl = mockTabs([{ id: 1, url: 'https://a.com', lastAccessed: 100 }]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current[0]?.url).toBe('https://a.com'));

    ctl.setQueryResult([{ id: 1, url: 'https://a.com/archives', lastAccessed: 100 }]);
    ctl.triggerUpdated();
    await waitFor(() => expect(result.current[0]?.url).toBe('https://a.com/archives'));
  });

  it('onRemoved 触发刷新（关闭 tab 后列表缩短）', async () => {
    const ctl = mockTabs([
      { id: 1, url: 'https://a.com', lastAccessed: 100 },
      { id: 2, url: 'https://b.com', lastAccessed: 200 },
    ]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current.length).toBe(2));

    ctl.setQueryResult([{ id: 1, url: 'https://a.com', lastAccessed: 100 }]);
    ctl.triggerRemoved();
    await waitFor(() => expect(result.current.length).toBe(1));
  });

  it('chrome 不可用 → 返回空列表，不抛错', () => {
    (globalThis as unknown as { chrome: unknown }).chrome = undefined;
    const { result } = renderHook(() => useOpenTabs());
    expect(result.current).toEqual([]);
  });
});

describe('useOpenTabs — R3 扩展（内部页过滤 + 新字段）', () => {
  // 内部页/扩展页 tab 形状：带 url 但属浏览器内部或扩展自身
  type TabLike = { id?: number; url?: string; lastAccessed?: number; title?: string; favIconUrl?: string; pinned?: boolean; index?: number };

  function mockTabs(initial: TabLike[]) {
    const queryMock = vi.fn(async () => initial);
    (globalThis as unknown as { chrome: unknown }).chrome = {
      tabs: {
        query: queryMock,
        onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    };
    return { queryMock };
  }

  it('过滤浏览器内部页：chrome:// / edge:// / about: / chrome-extension:// 不进列表', async () => {
    mockTabs([
      { id: 1, url: 'chrome://newtab/', lastAccessed: 100 },
      { id: 2, url: 'chrome://settings/extensions', lastAccessed: 200 },
      { id: 3, url: 'edge://favorites', lastAccessed: 300 },
      { id: 4, url: 'about:blank', lastAccessed: 400 },
      { id: 5, url: 'chrome-extension://abc123/home.html', lastAccessed: 500 },
      { id: 6, url: 'https://example.com', lastAccessed: 600 },
      { id: 7, url: 'https://vicohu.com/archives', lastAccessed: 700 },
    ]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current.length).toBe(2));
    // 仅验证过滤结果(顺序无关——排序策略由专门用例覆盖)
    expect(result.current.map((t) => t.url).sort()).toEqual([
      'https://example.com',
      'https://vicohu.com/archives',
    ]);
  });

  it('投影新字段 title / favIconUrl / pinned / index（源有值时携带，无值时省略）', async () => {
    mockTabs([
      {
        id: 1,
        url: 'https://example.com',
        lastAccessed: 100,
        title: '示例站',
        favIconUrl: 'https://example.com/favicon.ico',
        pinned: true,
        index: 2,
      } as TabLike,
      { id: 2, url: 'https://other.com', lastAccessed: 50 } as TabLike,
    ]);
    const { result } = renderHook(() => useOpenTabs());
    await waitFor(() => expect(result.current.length).toBe(2));
    const ex = result.current.find((t) => t.tabId === 1)!;
    expect(ex.title).toBe('示例站');
    expect(ex.favIconUrl).toBe('https://example.com/favicon.ico');
    expect(ex.pinned).toBe(true);
    expect(ex.index).toBe(2); // 浏览器 tab 位置,为稳定排序/0.2.x 会话保存前置
    // 未提供这些字段的 tab 不应携带
    const other = result.current.find((t) => t.tabId === 2)!;
    expect(other.title).toBeUndefined();
    expect(other.index).toBeUndefined();
  });
});

describe('useOpenTabs — 工作区上下文过滤', () => {
  const tabs = [
    { id: 1, url: 'https://current.example.com', groupId: 10 },
    { id: 2, url: 'https://other.example.com', groupId: 20 },
    { id: 3, url: 'https://loose.example.com', groupId: -1 },
    { id: 4, url: 'https://manual-group.example.com', groupId: 30 },
  ];
  const groups = [
    { id: 10, windowId: 1, title: '工作 ·aaaaaaaa' },
    { id: 20, windowId: 1, title: '学习 ·bbbbbbbb' },
    { id: 30, windowId: 1, title: '用户自建组' },
  ];

  it('off 档 → 保留当前窗口全部标签页', async () => {
    mockTabs(tabs, { groups, setting: 'off' });
    const { result } = renderHook(() => useOpenTabs({ currentWorkspaceId: workspaces[0]!.id, workspaces }));

    await waitFor(() => expect(result.current.map((tab) => tab.tabId)).toEqual([1, 2, 3, 4]));
  });

  it.each(['close', 'hide-discard', 'hide'] as const)(
    '%s 档 → 保留当前工作区、游离和用户自建组标签页',
    async (setting) => {
      mockTabs(tabs, { groups, setting });
      const { result } = renderHook(() => useOpenTabs({ currentWorkspaceId: workspaces[0]!.id, workspaces }));

      await waitFor(() => expect(result.current.map((tab) => tab.tabId)).toEqual([1, 3, 4]));
    },
  );

  it('标签组 onCreated/onUpdated/onMoved → 按最新标识组刷新结果', async () => {
    const ctl = mockTabs(tabs, { groups, setting: 'hide' });
    const { result } = renderHook(() => useOpenTabs({ currentWorkspaceId: workspaces[0]!.id, workspaces }));
    await waitFor(() => expect(result.current.map((tab) => tab.tabId)).toEqual([1, 3, 4]));

    ctl.setGroups(groups.map((group) => group.id === 20 ? { ...group, title: '工作副本 ·aaaaaaaa' } : group));
    ctl.triggerGroupCreated();
    await waitFor(() => expect(result.current.map((tab) => tab.tabId)).toEqual([1, 2, 3, 4]));

    ctl.setGroups(groups);
    ctl.triggerGroupUpdated();
    await waitFor(() => expect(result.current.map((tab) => tab.tabId)).toEqual([1, 3, 4]));

    ctl.setGroups(groups.map((group) => group.id === 20 ? { ...group, title: '工作副本 ·aaaaaaaa' } : group));
    ctl.triggerGroupMoved();
    await waitFor(() => expect(result.current.map((tab) => tab.tabId)).toEqual([1, 2, 3, 4]));
  });

  it('当前工作区切换 → 刷新过滤后的标签页', async () => {
    mockTabs(tabs, { groups, setting: 'hide' });
    const { result, rerender } = renderHook(
      ({ currentWorkspaceId }) => useOpenTabs({ currentWorkspaceId, workspaces }),
      { initialProps: { currentWorkspaceId: workspaces[0]!.id } },
    );
    await waitFor(() => expect(result.current.map((tab) => tab.tabId)).toEqual([1, 3, 4]));

    rerender({ currentWorkspaceId: workspaces[1]!.id });
    await waitFor(() => expect(result.current.map((tab) => tab.tabId)).toEqual([2, 3, 4]));
  });
});
