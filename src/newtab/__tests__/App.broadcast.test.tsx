import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

// lottie-web 由 vitest.config.ts 全局 alias 指向 tests/stubs/lottie-web.ts，无需在此 vi.mock。
// 隔离子组件依赖：仅验证 App 装配 + 广播分发，不测内部
vi.mock('@/newtab/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/newtab/components/Content', () => ({ Content: () => null }));
vi.mock('@/newtab/components/UnlockModal', () => ({ UnlockModal: () => null }));

// 可控 store：实例化时捕获方法用于断言
const loadWorkspaces = vi.fn(async () => {});
const loadBookmarks = vi.fn(async () => {});
const checkStatus = vi.fn();
const loadPinnedTabs = vi.fn(async () => {});

const workspaceState: Record<string, unknown> = {
  currentWorkspaceId: 'w1',
  currentCategoryId: 'c1',
  workspaces: [],
  categories: [],
  loadWorkspaces,
};

vi.mock('@/store/useWorkspace', () => ({
  useWorkspace: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel(workspaceState),
    {
      setState: (s: Record<string, unknown>) => Object.assign(workspaceState, s),
      getState: () => workspaceState,
    },
  ),
}));
vi.mock('@/store/useBookmarks', () => ({
  useBookmarks: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ loadBookmarks }),
}));
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (sel: (s: Record<string, unknown>) => unknown) => sel({ checkStatus }),
}));
vi.mock('@/store/usePinnedTabs', () => ({
  usePinnedTabs: Object.assign(() => null, {
    getState: () => ({ loadPinnedTabs }),
  }),
}));

import App from '@/newtab/App';
import { useWorkspace } from '@/store/useWorkspace';

// ---- BroadcastChannel 打桩：把 listener 暴露出来供测试手动 fire ----
type BcListener = (e: { data: unknown }) => void;
class TestBC {
  static instances: Record<string, TestBC[]> = {};
  listeners: BcListener[] = [];
  constructor(public name: string) {
    (TestBC.instances[name] ??= []).push(this);
  }
  postMessage() {}
  addEventListener(_type: string, cb: BcListener) {
    this.listeners.push(cb);
  }
  removeEventListener(_type: string, cb: BcListener) {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }
  close() {
    this.listeners = [];
    TestBC.instances[this.name] = TestBC.instances[this.name]!.filter((c) => c !== this);
  }
  // 测试辅助：在该 channel 上广播一条消息给所有实例（不含自身——模拟跨 context）
  static emit(name: string, data: unknown) {
    (TestBC.instances[name] ??= []).forEach((c) =>
      c.listeners.forEach((l) => l({ data })),
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  TestBC.instances = {};
  (globalThis as unknown as { BroadcastChannel: typeof TestBC }).BroadcastChannel =
    TestBC;
  useWorkspace.setState({
    currentWorkspaceId: 'w1',
    currentCategoryId: 'c1',
    workspaces: [],
    categories: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App DB_NAME 订阅（T6）', () => {
  it('store=pinnedTabs → 调用 loadPinnedTabs(currentWorkspaceId)', async () => {
    render(<App />);
    TestBC.emit('octane-db', { store: 'pinnedTabs', action: 'put' });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadPinnedTabs).toHaveBeenCalledWith('w1');
  });

  it('store=bookmarks → 调用 loadBookmarks(currentCategoryId)', async () => {
    render(<App />);
    TestBC.emit('octane-db', { store: 'bookmarks', action: 'put' });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadBookmarks).toHaveBeenCalledWith('c1');
  });

  it('store=workspaces → 调用 loadWorkspaces', async () => {
    render(<App />);
    TestBC.emit('octane-db', { store: 'workspaces', action: 'put' });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadWorkspaces).toHaveBeenCalled();
  });

  it('store=categories → 也调用 loadWorkspaces（连带重载分类）', async () => {
    render(<App />);
    TestBC.emit('octane-db', { store: 'categories', action: 'put' });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadWorkspaces).toHaveBeenCalled();
  });

  it('store 为未处理的切片 → 不触发任何 load', async () => {
    render(<App />);
    vi.clearAllMocks(); // 清掉挂载时的初始 load
    TestBC.emit('octane-db', { store: 'cryptoMetadata', action: 'put' });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadWorkspaces).not.toHaveBeenCalled();
    expect(loadPinnedTabs).not.toHaveBeenCalled();
    expect(loadBookmarks).not.toHaveBeenCalled();
  });

  it('卸载后关闭 channel：不再响应广播', async () => {
    const { unmount } = render(<App />);
    unmount();
    // 卸载后 TestBC.instances 应已清空对应 channel
    expect((TestBC.instances['octane-db'] ?? []).length).toBe(0);
  });
});
