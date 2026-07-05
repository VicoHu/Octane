import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Toast partial mock（保留其余 Semi 组件真实渲染，含 Modal/Select/Button）
vi.mock('@douyinfe/semi-ui', async (importActual) => {
  const actual = await importActual<typeof import('@douyinfe/semi-ui')>();
  return {
    ...actual,
    Toast: { ...actual.Toast, success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  };
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
  useEncryptedContexts: vi.fn(() => ({ contexts: [], locked: false, error: null, loading: false })),
}));
vi.mock('../components/SidePanelUnlockModal', () => ({
  SidePanelUnlockModal: () => <div data-testid="unlock-modal-stub" />,
}));
vi.mock('../hooks/useSidePanelUnlockLifecycle', () => ({
  useSidePanelUnlockLifecycle: () => {},
}));
vi.mock('@/services/UnlockSession', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getUnlockPrerequisite: vi.fn(() => Promise.resolve('ok')) };
});

// 数据层边界 mock（不 mock 被测对象 App 本身）
vi.mock('@/services/WorkspaceService', () => ({
  listWorkspaces: vi.fn(),
}));
// zustand store —— 仅 mock getState().createPinnedTab（副作用边界）
vi.mock('@/store/usePinnedTabs', () => ({
  usePinnedTabs: {
    getState: vi.fn(() => ({ createPinnedTab: vi.fn() })),
  },
}));

import App from '../App';
import { Toast } from '@douyinfe/semi-ui';
import { useCurrentTabContext } from '../hooks/useCurrentTabContext';
import { useHostBookmarks } from '../hooks/useHostBookmarks';
import { useSourceMap } from '../hooks/useSourceMap';
import { listWorkspaces } from '@/services/WorkspaceService';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import type { Bookmark } from '@/shared/types';

const tabMock = useCurrentTabContext as ReturnType<typeof vi.fn>;
const hostMock = useHostBookmarks as ReturnType<typeof vi.fn>;
const sourceMock = useSourceMap as ReturnType<typeof vi.fn>;

function makeBookmark(id: string, name: string, wsId = 'w1', catId = 'c1'): Bookmark {
  return {
    id, workspaceId: wsId, categoryId: catId, name, url: `https://${id}.com`,
    description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: false,
    createdAt: 0, updatedAt: 0,
  };
}

/** 注入 chrome.tabs.query 返回值（active tab url+title） */
function mockActiveTab(url: string, title = '页面标题') {
  const query = vi.fn().mockResolvedValue([{ id: 1, url, title }]);
  (globalThis as unknown as { chrome: unknown }).chrome = { tabs: { query } };
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  sourceMock.mockReturnValue({ workspaces: [], categories: [], ready: true });
  vi.mocked(listWorkspaces).mockResolvedValue([]);
});

describe('App — Pin 当前 Tab 按钮（Codex #4 根级位置 + Issue 2A picker）', () => {
  it('空状态（matched=[]）下 Pin 按钮可见（根级，早返回之前）', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    hostMock.mockReturnValue({ matched: [], loading: false });
    render(<App />);
    expect(screen.getByRole('button', { name: /Pin 当前 Tab/ })).toBeInTheDocument();
  });

  it('groups===1 → 点击直接 pin 到命中工作区 + Toast.success', async () => {
    const user = userEvent.setup();
    mockActiveTab('https://chatgpt.com/c/1', 'ChatGPT 会话');
    const createPinnedTab = vi.fn().mockResolvedValue({ id: 'pin-1' });
    vi.mocked(usePinnedTabs.getState).mockReturnValue({ createPinnedTab } as never);

    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    hostMock.mockReturnValue({ matched: [makeBookmark('b1', '工具', 'w1', 'c1')], loading: false });
    sourceMock.mockReturnValue({
      workspaces: [{ id: 'w1', name: '工作区1', icon: '🗂', createdAt: 0, order: 0 }],
      categories: [{ id: 'c1', workspaceId: 'w1', name: '分类1', icon: '📁', order: 0, createdAt: 0 }],
      ready: true,
    });

    render(<App />);
    await user.click(screen.getByRole('button', { name: /Pin 当前 Tab/ }));

    await waitFor(() => expect(createPinnedTab).toHaveBeenCalled());
    expect(createPinnedTab).toHaveBeenCalledWith('w1', { name: 'ChatGPT 会话', url: 'https://chatgpt.com/c/1' });
    expect(Toast.success).toHaveBeenCalledWith('已常驻到 工作区1');
  });

  it('groups===0 → 弹 Modal + 调 listWorkspaces（全量 picker，Issue 2A），确认后 pin', async () => {
    const user = userEvent.setup();
    mockActiveTab('https://t.com', 'T');
    const createPinnedTab = vi.fn().mockResolvedValue({ id: 'pin-x' });
    vi.mocked(usePinnedTabs.getState).mockReturnValue({ createPinnedTab } as never);
    vi.mocked(listWorkspaces).mockResolvedValue([
      { id: 'full-1', name: '全量工作区', icon: '🗂', createdAt: 0, order: 0 },
    ]);

    tabMock.mockReturnValue({ hostname: 't.com', loading: false });
    hostMock.mockReturnValue({ matched: [], loading: false });

    render(<App />);
    await user.click(screen.getByRole('button', { name: /Pin 当前 Tab/ }));

    // listWorkspaces 被调（全量数据源，非 useWorkspace.categories）
    await waitFor(() => expect(listWorkspaces).toHaveBeenCalled());
    // Modal 出现，候选工作区可见
    expect(await screen.findByText(/选择目标工作区/)).toBeInTheDocument();
    // 默认选中第一个候选 → 确定（Semi Modal 确定按钮 aria-label=confirm）
    const okBtn = screen.getByRole('button', { name: 'confirm' });
    await user.click(okBtn);

    await waitFor(() => expect(createPinnedTab).toHaveBeenCalled());
    expect(createPinnedTab).toHaveBeenCalledWith('full-1', { name: 'T', url: 'https://t.com' });
    expect(Toast.success).toHaveBeenCalledWith('已常驻到 全量工作区');
  });

  it('cap 失败 → Toast.warning（错误 message 含「上限」）', async () => {
    const user = userEvent.setup();
    mockActiveTab('https://cap.com', 'Cap');
    const createPinnedTab = vi.fn().mockRejectedValue(new Error('常驻标签已达上限（8）'));
    vi.mocked(usePinnedTabs.getState).mockReturnValue({ createPinnedTab } as never);

    tabMock.mockReturnValue({ hostname: 'cap.com', loading: false });
    hostMock.mockReturnValue({ matched: [makeBookmark('b1', '工具', 'w1', 'c1')], loading: false });
    sourceMock.mockReturnValue({
      workspaces: [{ id: 'w1', name: '工作区1', icon: '🗂', createdAt: 0, order: 0 }],
      categories: [{ id: 'c1', workspaceId: 'w1', name: '分类1', icon: '📁', order: 0, createdAt: 0 }],
      ready: true,
    });

    render(<App />);
    await user.click(screen.getByRole('button', { name: /Pin 当前 Tab/ }));

    await waitFor(() => expect(Toast.warning).toHaveBeenCalledWith(expect.stringContaining('上限')));
    expect(Toast.success).not.toHaveBeenCalled();
  });

  it('非 http(s) URL → Toast.warning + 不创建', async () => {
    const user = userEvent.setup();
    mockActiveTab('chrome://settings', '设置');
    const createPinnedTab = vi.fn().mockResolvedValue({ id: 'pin-1' });
    vi.mocked(usePinnedTabs.getState).mockReturnValue({ createPinnedTab } as never);

    tabMock.mockReturnValue({ hostname: null, loading: false });
    hostMock.mockReturnValue({ matched: [], loading: false });

    render(<App />);
    await user.click(screen.getByRole('button', { name: /Pin 当前 Tab/ }));

    await waitFor(() => expect(Toast.warning).toHaveBeenCalledWith(expect.stringContaining('http')));
    expect(createPinnedTab).not.toHaveBeenCalled();
  });
});
