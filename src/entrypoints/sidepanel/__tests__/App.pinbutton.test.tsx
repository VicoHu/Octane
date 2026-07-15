import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Toast mock 为副作用边界（其余 ui 组件真实渲染，含 Dialog/Select/Button）
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), close: vi.fn() },
}));

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

// 数据层边界 mock：service（DB 边界），保留真实 usePinnedTabs store —— 测到 store→service 接线
vi.mock('@/services/WorkspaceService', () => ({
  listWorkspaces: vi.fn(),
}));
vi.mock('@/services/PinnedTabService', () => ({
  createPinnedTab: vi.fn(),
  listByWorkspace: vi.fn(async () => []),
  deletePinnedTab: vi.fn(async () => undefined),
  PINNED_TAB_CAP: 8,
}));

import App from '../App';
import { Toast } from '@/components/ui/toast';
import { useCurrentTabContext } from '../hooks/useCurrentTabContext';
import { useHostBookmarks } from '../hooks/useHostBookmarks';
import { useSourceMap } from '../hooks/useSourceMap';
import { listWorkspaces } from '@/services/WorkspaceService';
import * as PinnedTabService from '@/services/PinnedTabService';
import type { Bookmark } from '@/shared/types';

const tabMock = useCurrentTabContext as ReturnType<typeof vi.fn>;
const hostMock = useHostBookmarks as ReturnType<typeof vi.fn>;
const sourceMock = useSourceMap as ReturnType<typeof vi.fn>;

function makeBookmark(id: string, name: string, wsId = 'w1', catId = 'c1'): Bookmark {
  return {
    id, workspaceId: wsId, categoryId: catId, name, url: `https://${id}.com`,
    description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: false, order: 0,
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
  vi.mocked(PinnedTabService.createPinnedTab).mockResolvedValue({
    id: 'pin-1', workspaceId: 'w1', name: 'n', url: 'u', order: 0, createdAt: 0,
  });
});

describe('App — Pin 当前 Tab 图标按钮（empty 管理旁 + StickyHeader addBtn 旁）', () => {
  it('空状态（matched=[]）下 Pin 按钮在「在 Octane 管理」旁可见', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    hostMock.mockReturnValue({ matched: [], loading: false });
    render(<App />);
    expect(screen.getByRole('button', { name: /Pin 当前 Tab/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /在 Octane 管理/ })).toBeInTheDocument();
  });

  it('matched 状态下 Pin 按钮在 StickyHeader（与 addBtn 同行）', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    hostMock.mockReturnValue({ matched: [makeBookmark('b1', '工具', 'w1', 'c1')], loading: false });
    sourceMock.mockReturnValue({
      workspaces: [{ id: 'w1', name: '工作区1', icon: '🗂', createdAt: 0, order: 0 }],
      categories: [{ id: 'c1', workspaceId: 'w1', name: '分类1', icon: '📁', order: 0, createdAt: 0 }],
      ready: true,
    });
    render(<App />);
    expect(screen.getByRole('button', { name: /Pin 当前 Tab/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加书签' })).toBeInTheDocument();
  });

  it('loading / no-hostname / matching 瞬态不渲染 Pin 按钮', () => {
    tabMock.mockReturnValue({ hostname: null, loading: false });
    hostMock.mockReturnValue({ matched: [], loading: false });
    render(<App />);
    expect(screen.queryByRole('button', { name: /Pin 当前 Tab/ })).not.toBeInTheDocument();
  });

  it('groups===1 → 点击直接 pin 到命中工作区 + Toast.success', async () => {
    const user = userEvent.setup();
    mockActiveTab('https://chatgpt.com/c/1', 'ChatGPT 会话');

    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    hostMock.mockReturnValue({ matched: [makeBookmark('b1', '工具', 'w1', 'c1')], loading: false });
    sourceMock.mockReturnValue({
      workspaces: [{ id: 'w1', name: '工作区1', icon: '🗂', createdAt: 0, order: 0 }],
      categories: [{ id: 'c1', workspaceId: 'w1', name: '分类1', icon: '📁', order: 0, createdAt: 0 }],
      ready: true,
    });

    render(<App />);
    await user.click(screen.getByRole('button', { name: /Pin 当前 Tab/ }));

    await waitFor(() => expect(PinnedTabService.createPinnedTab).toHaveBeenCalled());
    expect(PinnedTabService.createPinnedTab).toHaveBeenCalledWith('w1', { name: 'ChatGPT 会话', url: 'https://chatgpt.com/c/1' });
    expect(Toast.success).toHaveBeenCalledWith('已常驻到 工作区1');
  });

  it('groups===0 → 弹 Modal + 调 listWorkspaces（全量 picker，Issue 2A），确认后 pin', async () => {
    const user = userEvent.setup();
    mockActiveTab('https://t.com', 'T');
    vi.mocked(listWorkspaces).mockResolvedValue([
      { id: 'full-1', name: '全量工作区', icon: '🗂', createdAt: 0, order: 0 },
    ]);

    tabMock.mockReturnValue({ hostname: 't.com', loading: false });
    hostMock.mockReturnValue({ matched: [], loading: false });

    render(<App />);
    await user.click(screen.getByRole('button', { name: /Pin 当前 Tab/ }));

    await waitFor(() => expect(listWorkspaces).toHaveBeenCalled());
    expect(await screen.findByText(/选择目标工作区/)).toBeInTheDocument();
    // Dialog 确认按钮 accessible name = 按钮文本「确定」
    await user.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => expect(PinnedTabService.createPinnedTab).toHaveBeenCalled());
    expect(PinnedTabService.createPinnedTab).toHaveBeenCalledWith('full-1', { name: 'T', url: 'https://t.com' });
    expect(Toast.success).toHaveBeenCalledWith('已常驻到 全量工作区');
  });

  it('cap 失败 → Toast.warning（错误 message 含「上限」）', async () => {
    const user = userEvent.setup();
    mockActiveTab('https://cap.com', 'Cap');
    vi.mocked(PinnedTabService.createPinnedTab).mockRejectedValue(new Error('常驻标签已达上限（8）'));

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
});
