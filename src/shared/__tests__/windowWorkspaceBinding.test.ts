import { describe, it, expect } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';
import {
  getWorkspaceBinding,
  setWorkspaceBinding,
  clearWorkspaceBinding,
} from '../windowWorkspaceBinding';

// windowWorkspaceBinding：窗口↔工作区绑定存 chrome.storage.local 分键
// windowWorkspaceBinding.<windowId> → workspaceId。用 installChromeStorageLocal 装真实
// in-memory storage.local 往返（规范 §6：只 mock 副作用边界，不 mock 被测逻辑）。

describe('windowWorkspaceBinding — 窗口↔工作区绑定 storage.local 分键 CRUD', () => {
  it('get 不存在的 window → 返回 null', async () => {
    installChromeStorageLocal({});
    expect(await getWorkspaceBinding(1)).toBeNull();
  });

  it('set 后 get → 返回绑定的 workspaceId', async () => {
    installChromeStorageLocal({});
    await setWorkspaceBinding(2, 'ws-1');
    expect(await getWorkspaceBinding(2)).toBe('ws-1');
  });

  it('clear window 后 get → 返回 null', async () => {
    installChromeStorageLocal({});
    await setWorkspaceBinding(3, 'ws-1');
    await clearWorkspaceBinding(3);
    expect(await getWorkspaceBinding(3)).toBeNull();
  });

  it('分键：不同 window 绑定互不覆盖（rev4 核心 invariant）', async () => {
    installChromeStorageLocal({});
    await setWorkspaceBinding(1, 'ws-a');
    await setWorkspaceBinding(2, 'ws-b');
    expect(await getWorkspaceBinding(1)).toBe('ws-a');
    expect(await getWorkspaceBinding(2)).toBe('ws-b');
  });
});
