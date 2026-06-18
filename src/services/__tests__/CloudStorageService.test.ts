import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, getDB } from '@/shared/db/database';
import { setupTestKey, setTestKey } from '@/services/CryptoService';
import {
  saveCloudConfig,
  getCloudConfig,
  clearCloudConfig,
  getLastBackupAt,
  setLastBackupAt,
} from '@/services/CloudStorageService';

const cfg = {
  region: 'oss-cn-hangzhou',
  bucket: 'octane-test',
  accessKeyId: 'AKIDxxx',
  accessKeySecret: 'SKyyy',
};

// chrome.storage.local 内存 mock
const localStore: Record<string, unknown> = {};
function installChromeStorageLocal() {
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in localStore) out[k] = localStore[k];
          return out;
        },
        set: async (data: Record<string, unknown>) => {
          Object.assign(localStore, data);
        },
        remove: async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete localStore[k];
        },
      },
    },
  };
}

async function clearAllStores() {
  const db = await getDB();
  const names = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) await tx.objectStore(n).clear();
  await tx.done;
}

beforeEach(async () => {
  resetDB();
  setTestKey(null);
  await getDB();
  await clearAllStores();
  for (const k of Object.keys(localStore)) delete localStore[k];
  installChromeStorageLocal();
});

describe('CloudStorageService 凭证层', () => {
  it('saveCloudConfig → getCloudConfig 往返还原（密文落盘，内存读出明文）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    const got = await getCloudConfig('oss');
    expect(got).toEqual(cfg);
  });

  it('凭证在 storage.local 中为密文（不可读明文 accessKeySecret）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    const raw = localStore['octane.cloudCreds.oss'] as { encryptedData: string; iv: string };
    expect(raw.encryptedData).not.toContain(cfg.accessKeySecret);
    expect(raw.iv).toBeTruthy();
  });

  it('未配置时 getCloudConfig 返回 null', async () => {
    await setupTestKey('main-password-1234');
    expect(await getCloudConfig('cos')).toBeNull();
  });

  it('未解锁时 getCloudConfig 抛错', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    setTestKey(null); // 模拟锁定
    await expect(getCloudConfig('oss')).rejects.toThrow();
  });

  it('clearCloudConfig 移除凭证', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    await clearCloudConfig('oss');
    expect(await getCloudConfig('oss')).toBeNull();
  });

  it('凭证按 provider 分键（oss/cos 互不干扰）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    await saveCloudConfig('cos', { ...cfg, bucket: 'cos-bucket' });
    expect((await getCloudConfig('oss')).bucket).toBe('octane-test');
    expect((await getCloudConfig('cos')).bucket).toBe('cos-bucket');
  });

  it('lastBackupAt 明文时间戳读写', async () => {
    await setLastBackupAt('oss', 1_700_000_000_000);
    expect(await getLastBackupAt('oss')).toBe(1_700_000_000_000);
    expect(await getLastBackupAt('cos')).toBeNull();
  });
});
