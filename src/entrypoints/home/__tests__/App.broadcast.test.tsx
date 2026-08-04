import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

// lottie-web 由 vitest.config.ts 全局 alias 指向 tests/stubs/lottie-web.ts，无需在此 vi.mock。
const appMocks = vi.hoisted(() => {
  const openTabs = [{
    url: 'https://example.com', tabId: 1, lastAccessed: 10,
    favIconUrl: 'https://example.com/icon.svg',
  }];
  return {
    openTabs,
    useOpenTabs: vi.fn(() => openTabs),
    appRailSpy: vi.fn(),
    sidebarSpy: vi.fn(),
    contentSpy: vi.fn(),
    contentMounts: 0,
    todoPageSpy: vi.fn(),
    todoLeaveGuard: null as null | ((action: () => void | Promise<void>) => Promise<void>),
  };
});

// 隔离子组件依赖：仅验证 App 装配 + 广播分发，不测内部
vi.mock('../hooks/useOpenTabs', () => ({ useOpenTabs: appMocks.useOpenTabs }));
vi.mock('../components/AppRail', () => ({
  AppRail: (props: {
    activePage: 'home' | 'tasks';
    onNavigate: (page: 'home' | 'tasks') => void;
    onWorkspaceSelect: (workspaceId: string) => void;
  }) => {
    appMocks.appRailSpy(props);
    return (
      <nav>
        <button aria-label="测试主页入口" onClick={() => props.onNavigate('home')}>主页</button>
        <button aria-label="测试待办入口" onClick={() => props.onNavigate('tasks')}>待办事项</button>
        <button aria-label="测试切换工作区" onClick={() => props.onWorkspaceSelect('w2')}>切换工作区</button>
      </nav>
    );
  },
}));
vi.mock('../components/Sidebar', () => ({
  Sidebar: (props: unknown) => { appMocks.sidebarSpy(props); return null; },
}));
vi.mock('../components/Content', () => ({
  Content: (props: unknown) => {
    appMocks.contentSpy(props);
    const [mountId] = useState(() => ++appMocks.contentMounts);
    return <div aria-label={`书签页面实例 ${mountId}`}>书签内容</div>;
  },
}));
vi.mock('../components/TodoPage', () => ({
  TodoPage: (props: { onRegisterLeaveGuard?: (guard: ((action: () => void | Promise<void>) => Promise<void>) | null) => void }) => {
    appMocks.todoPageSpy(props);
    props.onRegisterLeaveGuard?.(appMocks.todoLeaveGuard);
    return <div>待办内容</div>;
  },
}));
vi.mock('../utils/workspaceSwitcher', () => ({ switchWorkspace: vi.fn(async () => {}) }));
vi.mock('@/components/UnlockModal', () => ({ UnlockModal: () => null }));

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

import App from '../App';
import { useWorkspace } from '@/store/useWorkspace';
import { useTodoData } from '@/store/useTodoData';
import { useTodoView } from '@/store/useTodoView';
import { switchWorkspace } from '../utils/workspaceSwitcher';

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
  appMocks.useOpenTabs.mockReturnValue(appMocks.openTabs);
  appMocks.contentMounts = 0;
  appMocks.todoLeaveGuard = null;
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


describe('App OpenTabs 装配', () => {
  it('挂载工作区应用栏', () => {
    render(<App />);
    expect(appMocks.appRailSpy).toHaveBeenCalledTimes(1);
  });

  it('只查询一次，并把同一数组传给 Sidebar 与 Content', () => {
    render(<App />);
    expect(appMocks.useOpenTabs).toHaveBeenCalledTimes(1);
    expect(appMocks.sidebarSpy).toHaveBeenLastCalledWith({ openTabs: appMocks.openTabs });
    expect(appMocks.contentSpy).toHaveBeenLastCalledWith({ openTabs: appMocks.openTabs, active: true });
  });
});

describe('App 页面切换', () => {
  it('切换页面不改变 URL，主页 subtree 保留且返回后可见', async () => {
    const user = userEvent.setup();
    const initialUrl = window.location.href;
    render(<App />);
    const homeInstance = screen.getByLabelText('书签页面实例 1');

    await user.click(screen.getByRole('button', { name: '测试待办入口' }));
    expect(window.location.href).toBe(initialUrl);
    expect(screen.getByText('待办内容')).toBeVisible();
    expect(homeInstance).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: '测试主页入口' }));
    expect(screen.getByLabelText('书签页面实例 1')).toBeVisible();
    expect(appMocks.contentMounts).toBe(1);
  });

  it('重新挂载时默认显示主页', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: '测试待办入口' }));
    unmount();

    render(<App />);
    expect(screen.getByText('书签内容')).toBeVisible();
    expect(screen.queryByText('待办内容')).not.toBeInTheDocument();
  });

  it('待办草稿 gate 拒绝时 AppRail 离开与 Workspace 切换都不执行动作', async () => {
    const user = userEvent.setup();
    appMocks.todoLeaveGuard = vi.fn(async () => {});
    render(<App />);
    await user.click(screen.getByRole('button', { name: '测试待办入口' }));
    await user.click(screen.getByRole('button', { name: '测试主页入口' }));
    expect(screen.getByText('待办内容')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '测试切换工作区' }));
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it('待办草稿 gate 执行动作时 AppRail 离开与 Workspace 切换正常完成', async () => {
    const user = userEvent.setup();
    appMocks.todoLeaveGuard = async (action) => { await action(); };
    render(<App />);
    await user.click(screen.getByRole('button', { name: '测试待办入口' }));
    await user.click(screen.getByRole('button', { name: '测试切换工作区' }));
    expect(switchWorkspace).toHaveBeenCalledWith('w2');
    await user.click(screen.getByRole('button', { name: '测试主页入口' }));
    expect(screen.getByText('书签内容')).toBeVisible();
  });

  it('待办页选择工作区 → 成功切换后通知 TodoView', async () => {
    const user = userEvent.setup();
    const onWorkspaceSelected = vi.spyOn(useTodoView.getState(), 'onWorkspaceSelected');
    render(<App />);
    await user.click(screen.getByRole('button', { name: '测试待办入口' }));
    await user.click(screen.getByRole('button', { name: '测试切换工作区' }));

    expect(switchWorkspace).toHaveBeenCalledWith('w2');
    expect(onWorkspaceSelected).toHaveBeenCalledWith('w2', undefined);
  });
});

describe('App 全量导入订阅', () => {
  it('导入完成 → 失效 TodoData 并清除任务选择', async () => {
    const invalidate = vi.spyOn(useTodoData.getState(), 'invalidate');
    useTodoView.getState().selectTask('task-1');
    render(<App />);

    TestBC.emit('octane-import', { kind: 'replace-all' });
    await Promise.resolve();
    await Promise.resolve();

    expect(invalidate).toHaveBeenCalledOnce();
    expect(useTodoView.getState().selectedTaskId).toBeNull();
  });
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

  it('待办表广播 → 标记 TodoData 失效', async () => {
    const invalidate = vi.spyOn(useTodoData.getState(), 'invalidate');
    render(<App />);
    TestBC.emit('octane-db', { store: 'tasks', action: 'put' });
    await Promise.resolve();

    expect(invalidate).toHaveBeenCalledOnce();
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
