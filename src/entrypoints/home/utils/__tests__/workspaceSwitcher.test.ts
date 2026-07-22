import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';

// 隔离下游编排：switchWorkspace 的职责是实时读 setting/windowId + 委托 + T4 Toast。
vi.mock('@/shared/tabs/workspaceSwitch', () => ({
  switchWorkspaceBySetting: vi.fn(),
  requestWorkspaceSwitch: vi.fn(),
}));
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), close: vi.fn() },
}));

import { switchWorkspaceBySetting, type SwitchResult } from '@/shared/tabs/workspaceSwitch';
import { Toast } from '@/components/ui/toast';
import { useWorkspace } from '@/store/useWorkspace';
import { switchWorkspace } from '../workspaceSwitcher';

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

  it('T4：关闭 tab（N>0）→ 弹结果 Toast（action 切回，非撤销）', async () => {
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
    const input = vi.mocked(Toast.success).mock.calls[0]![0] as unknown as { content: string; action: { label: string } };
    expect(input.content).toContain('工作区B');
    expect(input.content).toContain('3');
    expect(input.action.label).toBe('切回「工作区A」');
  });

  it('T4：N=0（未关 tab）→ 不弹 Toast', async () => {
    installChrome({ tabIsolationSetting: 'close' }, 5);
    vi.mocked(switchWorkspaceBySetting).mockResolvedValue({ undo: vi.fn(), fromId: 'ws-a', closedCount: 0 });

    await switchWorkspace('ws-b');

    expect(Toast.success).not.toHaveBeenCalled();
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

    // 进度期间 switching 非 null（toId + onProgress 更新的 phase/count/total）
    expect(switchingDuringProgress).toEqual({ toId: 'ws-b', phase: 'dispose', count: 2, total: 5 });
    // 完成后清
    expect(useWorkspace.getState().switching).toBeNull();
  });

  it('T8：off 模式不设 switching（无 tab 编排）', async () => {
    installChrome({}, 5);

    await switchWorkspace('ws-b');

    expect(useWorkspace.getState().switching).toBeNull();
  });
});
