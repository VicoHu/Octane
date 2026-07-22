import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';

// 隔离下游编排：switchWorkspace 的职责是「实时读 setting/windowId + 委托」，
// 分流逻辑由 switchWorkspaceBySetting 自己的测试覆盖。这里只验接线。
vi.mock('@/shared/tabs/workspaceSwitch', () => ({
  switchWorkspaceBySetting: vi.fn(),
  requestWorkspaceSwitch: vi.fn(),
}));

import { switchWorkspaceBySetting } from '@/shared/tabs/workspaceSwitch';
import { switchWorkspace } from '../workspaceSwitcher';

// 装完整 chrome：installChromeStorageLocal 装 storage.local，再补 windows.getCurrent。
function installChrome(initial: Record<string, unknown> = {}, windowId = 5) {
  installChromeStorageLocal({ initial });
  const chrome = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
  chrome.windows = { getCurrent: vi.fn(async () => ({ id: windowId })) };
}

describe('switchWorkspace — home 门控入口（实时读 setting/windowId + 委托）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('close setting + 本窗 id：读 storage 与 windows.getCurrent，委托 switchWorkspaceBySetting', async () => {
    installChrome({ tabIsolationSetting: 'close' }, 5);

    await switchWorkspace('ws-b');

    expect(switchWorkspaceBySetting).toHaveBeenCalledWith(
      expect.objectContaining({ toId: 'ws-b', setting: 'close', windowId: 5 }),
    );
  });

  it('off setting（默认，storage 无 key）：setting=off 传入', async () => {
    installChrome({}, 7);

    await switchWorkspace('ws-a');

    expect(switchWorkspaceBySetting).toHaveBeenCalledWith(
      expect.objectContaining({ toId: 'ws-a', setting: 'off', windowId: 7 }),
    );
  });

  it('非扩展环境（无 windows.getCurrent）→ windowId=null 传入（下游 fallback 纯 UI）', async () => {
    installChromeStorageLocal({ initial: { tabIsolationSetting: 'close' } });
    // 不装 chrome.windows → getCurrentWindowId 返回 null

    await switchWorkspace('ws-c');

    expect(switchWorkspaceBySetting).toHaveBeenCalledWith(
      expect.objectContaining({ toId: 'ws-c', setting: 'close', windowId: null }),
    );
  });
});
