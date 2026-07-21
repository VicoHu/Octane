import { describe, it, expect } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';
import { savePendingUpdate, clearPendingUpdate, readPendingUpdate } from '../UpdateStore';

// readPendingUpdate 读 getManifest().version 做兜底；installChromeStorageLocal 会重设
// globalThis.chrome = { storage: { local } }（覆盖 runtime），故每次 install 后补 runtime。
function setRuntimeVersion(v: string) {
  const existing = (globalThis as Record<string, unknown>).chrome ?? {};
  (globalThis as Record<string, unknown>).chrome = {
    ...existing,
    runtime: { getManifest: () => ({ version: v }) },
  };
}

describe('UpdateStore', () => {
  it('savePendingUpdate → 写 storage.local.pendingUpdate', async () => {
    const { store } = installChromeStorageLocal({});
    setRuntimeVersion('0.1.13.0');
    await savePendingUpdate('0.1.14.0');
    expect(store.pendingUpdate).toEqual({ version: '0.1.14.0' });
  });

  it('clearPendingUpdate → 删 pendingUpdate', async () => {
    const { store } = installChromeStorageLocal({
      initial: { pendingUpdate: { version: '0.1.14.0' } },
    });
    setRuntimeVersion('0.1.13.0');
    await clearPendingUpdate();
    expect(store.pendingUpdate).toBeUndefined();
  });

  it('readPendingUpdate：pending 超前本地 → 返回版本', async () => {
    installChromeStorageLocal({
      initial: { pendingUpdate: { version: '0.1.14.0' } },
    });
    setRuntimeVersion('0.1.13.0');
    expect(await readPendingUpdate()).toBe('0.1.14.0');
  });

  it('readPendingUpdate：无 pending → null', async () => {
    installChromeStorageLocal({});
    setRuntimeVersion('0.1.13.0');
    expect(await readPendingUpdate()).toBeNull();
  });

  it('readPendingUpdate：pending 不超前（残留）→ null 并清除', async () => {
    const { store, local } = installChromeStorageLocal({
      initial: { pendingUpdate: { version: '0.1.12.0' } },
    });
    setRuntimeVersion('0.1.13.0');
    expect(await readPendingUpdate()).toBeNull();
    expect(local.remove).toHaveBeenCalledWith(['pendingUpdate']);
    expect(store.pendingUpdate).toBeUndefined();
  });

  it('readPendingUpdate：容忍 v 前缀', async () => {
    installChromeStorageLocal({
      initial: { pendingUpdate: { version: 'v0.1.14.0' } },
    });
    setRuntimeVersion('0.1.13.0');
    expect(await readPendingUpdate()).toBe('v0.1.14.0');
  });
});
