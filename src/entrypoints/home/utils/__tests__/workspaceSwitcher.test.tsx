import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';

// 隔离下游编排：switchWorkspace 的职责是实时读 setting/windowId + 委托 + T4 Toast。
vi.mock('@/shared/tabs/workspaceSwitch', () => ({
  switchWorkspaceBySetting: vi.fn(),
  requestWorkspaceSwitch: vi.fn(),
  normalizeOnModeChange: vi.fn(async () => undefined),
}));
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), close: vi.fn() },
}));
vi.mock('@/services/CategoryService', () => ({
  listCategories: vi.fn(async () => []),
}));

import { render, screen, waitFor, renderHook, act } from '@testing-library/react';
import { switchWorkspaceBySetting, normalizeOnModeChange, type SwitchResult } from '@/shared/tabs/workspaceSwitch';
import { Toast } from '@/components/ui/toast';
import { useWorkspace } from '@/store/useWorkspace';
import { switchWorkspace, LoadingToastContent, useTabIsolationSetting } from '../workspaceSwitcher';

const NOOP_RESULT: SwitchResult = { undo: vi.fn(), fromId: null, closedCount: 0 };

function installChrome(initial: Record<string, unknown> = {}, windowId = 5) {
  installChromeStorageLocal({ initial });
  const chrome = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
  chrome.windows = { getCurrent: vi.fn(async () => ({ id: windowId })) };
}

describe('switchWorkspace — home 门控入口（实时读 setting/windowId + 委托 + T4 Toast）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(switchWorkspaceBySetting).mockResolvedValue(NOOP_RESULT);
  });

  it('close setting + 本窗 id：读 storage/windows，委托 switchWorkspaceBySetting', async () => {
    installChrome({ tabIsolationSetting: 'close' }, 5);

    await switchWorkspace('ws-b');

    expect(switchWorkspaceBySetting).toHaveBeenCalledWith(
      expect.objectContaining({ toId: 'ws-b', setting: 'close', windowId: 5 }),
    );
  });

  it('fromName 从 currentWorkspaceId 派生传入（供建组 title，GAP-4）', async () => {
    installChrome({ tabIsolationSetting: 'close' }, 5);
    useWorkspace.setState({
      workspaces: [
        { id: 'ws-a', name: '工作区A', icon: '📁', createdAt: 0, order: 0 },
        { id: 'ws-b', name: '工作区B', icon: '🔬', createdAt: 0, order: 1 },
      ],
      currentWorkspaceId: 'ws-a',
    });

    await switchWorkspace('ws-b');

    // fromName = 当前工作区名（currentWorkspaceId 反查），传 switchWorkspaceBySetting
    expect(switchWorkspaceBySetting).toHaveBeenCalledWith(
      expect.objectContaining({ toId: 'ws-b', fromName: '工作区A' }),
    );
  });

  it('off setting（默认）：setting=off 传入', async () => {
    installChrome({}, 7);

    await switchWorkspace('ws-a');

    expect(switchWorkspaceBySetting).toHaveBeenCalledWith(
      expect.objectContaining({ toId: 'ws-a', setting: 'off', windowId: 7 }),
    );
  });

  it('非扩展环境（无 windows.getCurrent）→ windowId=null 传入', async () => {
    installChromeStorageLocal({ initial: { tabIsolationSetting: 'close' } });

    await switchWorkspace('ws-c');

    expect(switchWorkspaceBySetting).toHaveBeenCalledWith(
      expect.objectContaining({ toId: 'ws-c', setting: 'close', windowId: null }),
    );
  });

  // T8：hide / hide-discard setting 透传 switchWorkspaceBySetting（mode 映射在 shared 层测）
  it('hide setting：setting=hide 传入 switchWorkspaceBySetting', async () => {
    installChrome({ tabIsolationSetting: 'hide' }, 5);

    await switchWorkspace('ws-b');

    expect(switchWorkspaceBySetting).toHaveBeenCalledWith(
      expect.objectContaining({ toId: 'ws-b', setting: 'hide', windowId: 5 }),
    );
  });

  it('hide-discard setting：setting=hide-discard 传入 switchWorkspaceBySetting', async () => {
    installChrome({ tabIsolationSetting: 'hide-discard' }, 5);

    await switchWorkspace('ws-a');

    expect(switchWorkspaceBySetting).toHaveBeenCalledWith(
      expect.objectContaining({ toId: 'ws-a', setting: 'hide-discard', windowId: 5 }),
    );
  });

  it('T4：关闭 tab（N>0）→ 弹结果 Toast（仅通知，无切回 action）', async () => {
    installChrome({ tabIsolationSetting: 'close' }, 5);
    useWorkspace.setState({
      workspaces: [
        { id: 'ws-a', name: '工作区A', icon: '📁', createdAt: 0, order: 0 },
        { id: 'ws-b', name: '工作区B', icon: '🔬', createdAt: 0, order: 1 },
      ],
    });
    vi.mocked(switchWorkspaceBySetting).mockResolvedValue({
      undo: vi.fn(),
      fromId: 'ws-a',
      closedCount: 3,
    });

    await switchWorkspace('ws-b');

    expect(Toast.success).toHaveBeenCalledTimes(1);
    const input = vi.mocked(Toast.success).mock.calls[0]![0] as unknown as { content: string; action?: undefined };
    expect(input.content).toContain('工作区B');
    expect(input.content).toContain('3');
    expect(input.content).toContain('已关闭');
    expect(input.action).toBeUndefined(); // 仅通知，无切回按钮
  });

  // T8 fix②：Toast 文案动词按 setting 适配（hide=已折叠 / hide-discard=已折叠并释放 / close=已关闭）
  it('T8 fix②：hide 模式 Toast 含「已折叠」（非「已关闭」）', async () => {
    installChrome({ tabIsolationSetting: 'hide' }, 5);
    useWorkspace.setState({
      workspaces: [
        { id: 'ws-a', name: '工作区A', icon: '📁', createdAt: 0, order: 0 },
        { id: 'ws-b', name: '工作区B', icon: '🔬', createdAt: 0, order: 1 },
      ],
    });
    vi.mocked(switchWorkspaceBySetting).mockResolvedValue({
      undo: vi.fn(),
      fromId: 'ws-a',
      closedCount: 3,
    });

    await switchWorkspace('ws-b');

    expect(Toast.success).toHaveBeenCalledTimes(1);
    const input = vi.mocked(Toast.success).mock.calls[0]![0] as unknown as { content: string };
    expect(input.content).toContain('已折叠');
    expect(input.content).not.toContain('已关闭');
  });

  it('T8 fix②：hide-discard 模式 Toast 含「已折叠并释放」', async () => {
    installChrome({ tabIsolationSetting: 'hide-discard' }, 5);
    useWorkspace.setState({
      workspaces: [
        { id: 'ws-a', name: '工作区A', icon: '📁', createdAt: 0, order: 0 },
        { id: 'ws-b', name: '工作区B', icon: '🔬', createdAt: 0, order: 1 },
      ],
    });
    vi.mocked(switchWorkspaceBySetting).mockResolvedValue({
      undo: vi.fn(),
      fromId: 'ws-a',
      closedCount: 2,
    });

    await switchWorkspace('ws-b');

    const input = vi.mocked(Toast.success).mock.calls[0]![0] as unknown as { content: string };
    expect(input.content).toContain('已折叠并释放');
  });

  it('T4：N=0（未关 tab）→ 不弹 Toast', async () => {
    installChrome({ tabIsolationSetting: 'close' }, 5);
    vi.mocked(switchWorkspaceBySetting).mockResolvedValue({ undo: vi.fn(), fromId: 'ws-a', closedCount: 0 });

    await switchWorkspace('ws-b');

    expect(Toast.success).not.toHaveBeenCalled();
  });

  it('T4：切回 action 已移除（仅通知，无 undo 入口）', async () => {
    installChrome({ tabIsolationSetting: 'close' }, 5);
    useWorkspace.setState({
      workspaces: [
        { id: 'ws-a', name: '工作区A', icon: '📁', createdAt: 0, order: 0 },
        { id: 'ws-b', name: '工作区B', icon: '🔬', createdAt: 0, order: 1 },
      ],
      currentWorkspaceId: 'ws-b',
    });
    vi.mocked(switchWorkspaceBySetting).mockResolvedValue({ undo: vi.fn(), fromId: 'ws-a', closedCount: 3 });

    await switchWorkspace('ws-b');

    const input = vi.mocked(Toast.success).mock.calls[0]![0] as { action?: undefined };
    expect(input.action).toBeUndefined(); // 切回按钮已移除，仅通知
  });

  // ===== T8：切换进度 state（switching）=====
  it('T8：close 切换设/更新/清 switching state（onProgress 驱动）', async () => {
    installChrome({ tabIsolationSetting: 'close' }, 5);
    let switchingDuringProgress: unknown = undefined;
    vi.mocked(switchWorkspaceBySetting).mockImplementation(async (params) => {
      params.onProgress?.({ phase: 'dispose', count: 2, total: 5 });
      switchingDuringProgress = useWorkspace.getState().switching;
      return NOOP_RESULT;
    });

    await switchWorkspace('ws-b');

    // 进度期间 switching 非 null（toId + setting + onProgress 更新的 phase/count/total）
    expect(switchingDuringProgress).toEqual({ toId: 'ws-b', phase: 'dispose', count: 2, total: 5, setting: 'close' });
    // 完成后清
    expect(useWorkspace.getState().switching).toBeNull();
  });

  it('T8：off 模式不设 switching（无 tab 编排）', async () => {
    installChrome({}, 5);

    await switchWorkspace('ws-b');

    expect(useWorkspace.getState().switching).toBeNull();
  });

  // T8 fix①：hide 模式也触发进度门控（switching state + onProgress），不遗漏
  it('T8 fix①：hide 切换设/更新/清 switching state（进度门控覆盖 hide）', async () => {
    installChrome({ tabIsolationSetting: 'hide' }, 5);
    useWorkspace.setState({ switching: null });
    let switchingDuringProgress: unknown = undefined;
    vi.mocked(switchWorkspaceBySetting).mockImplementation(async (params) => {
      params.onProgress?.({ phase: 'dispose', count: 2, total: 5 });
      switchingDuringProgress = useWorkspace.getState().switching;
      return NOOP_RESULT;
    });

    await switchWorkspace('ws-b');

    // hide 模式也应触发 switching state（修复前 onProgress=undefined → switching 留 null）
    expect(switchingDuringProgress).toEqual({ toId: 'ws-b', phase: 'dispose', count: 2, total: 5, setting: 'hide' });
    expect(useWorkspace.getState().switching).toBeNull();
  });

  it('T8 fix①：hide-discard 切换也触发进度门控', async () => {
    installChrome({ tabIsolationSetting: 'hide-discard' }, 5);
    useWorkspace.setState({ switching: null });
    let onProgressCalled = false;
    vi.mocked(switchWorkspaceBySetting).mockImplementation(async (params) => {
      if (params.onProgress) onProgressCalled = true;
      return NOOP_RESULT;
    });

    await switchWorkspace('ws-b');

    expect(onProgressCalled).toBe(true);
  });
});

describe('LoadingToastContent — T8 Progress 进度条（订阅 switching）', () => {
  beforeEach(() => {
    useWorkspace.setState({
      workspaces: [{ id: 'w1', name: '工作区1', icon: '📁', createdAt: 0, order: 0 }],
    });
  });

  it('dispose 阶段（total>0）显示 Progress + 文案（count/total → 40%）', () => {
    useWorkspace.setState({ switching: { toId: 'w1', phase: 'dispose', count: 2, total: 5 } });
    render(<LoadingToastContent toId="w1" />);

    expect(screen.getByText(/关闭当前标签 2\/5/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
  });

  it('archive 阶段（total=0）不显示 Progress，仅文案', () => {
    useWorkspace.setState({ switching: { toId: 'w1', phase: 'archive', count: 0, total: 0 } });
    render(<LoadingToastContent toId="w1" />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText(/保存当前标签/)).toBeInTheDocument();
  });

  // T8 fix附带：dispose 阶段文案按 setting 适配（hide=正在折叠 / hide-discard=正在折叠并释放 / close=正在关闭）
  it('dispose 阶段 hide 模式显示「正在折叠」文案（非「正在关闭」）', () => {
    useWorkspace.setState({ switching: { toId: 'w1', phase: 'dispose', count: 2, total: 5, setting: 'hide' } });
    render(<LoadingToastContent toId="w1" />);

    expect(screen.getByText(/折叠当前标签 2\/5/)).toBeInTheDocument();
    expect(screen.queryByText(/关闭当前标签/)).not.toBeInTheDocument();
  });

  it('dispose 阶段 hide-discard 模式显示「正在折叠并释放」文案', () => {
    useWorkspace.setState({ switching: { toId: 'w1', phase: 'dispose', count: 1, total: 3, setting: 'hide-discard' } });
    render(<LoadingToastContent toId="w1" />);

    expect(screen.getByText(/折叠并释放当前标签 1\/3/)).toBeInTheDocument();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// T7: useTabIsolationSetting.updateSetting —— setting 变更为 close 时调 normalize
// hide→close 清非当前 ws 组（窗口回归 close 干净语义）。
// ──────────────────────────────────────────────────────────────────────────
describe('useTabIsolationSetting — T7 normalize 调用（hide→close 触发）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updateSetting(close)：调 normalizeOnModeChange(windowId, close)', async () => {
    installChrome({}, 5);

    const { result } = renderHook(() => useTabIsolationSetting());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.updateSetting('close');
    });

    expect(normalizeOnModeChange).toHaveBeenCalledWith(5, 'close');
  });

  it('updateSetting(hide)：不调 normalizeOnModeChange（非 close 档）', async () => {
    installChrome({}, 5);

    const { result } = renderHook(() => useTabIsolationSetting());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.updateSetting('hide');
    });

    expect(normalizeOnModeChange).not.toHaveBeenCalled();
  });

  it('updateSetting(off)：不调 normalizeOnModeChange（非 close 档）', async () => {
    installChrome({}, 5);

    const { result } = renderHook(() => useTabIsolationSetting());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.updateSetting('off');
    });

    expect(normalizeOnModeChange).not.toHaveBeenCalled();
  });
});
