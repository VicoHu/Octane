import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDB, getDB } from '@/shared/db/database';
import { setupTestKey, setTestKey } from '@/services/CryptoService';
import {
  saveCloudConfig,
  getCloudConfig,
  clearCloudConfig,
  getLastBackupAt,
  setLastBackupAt,
  testConnection,
  uploadBackup,
  downloadBackup,
} from '@/services/CloudStorageService';

// 编排测试用：mock provider 注册表（避免引入真实 SDK）。
const fakeProvider = vi.hoisted(() => ({
  testConnection: vi.fn(),
  uploadBackup: vi.fn(),
  downloadBackup: vi.fn(),
}));
vi.mock('@/services/cloud/providers', () => ({
  getCloudProvider: () => fakeProvider,
}));

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
  fakeProvider.testConnection.mockReset();
  fakeProvider.uploadBackup.mockReset();
  fakeProvider.downloadBackup.mockReset();
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
    expect((await getCloudConfig('oss'))?.bucket).toBe('octane-test');
    expect((await getCloudConfig('cos'))?.bucket).toBe('cos-bucket');
  });

  it('lastBackupAt 明文时间戳读写', async () => {
    await setLastBackupAt('oss', 1_700_000_000_000);
    expect(await getLastBackupAt('oss')).toBe(1_700_000_000_000);
    expect(await getLastBackupAt('cos')).toBeNull();
  });
});

describe('CloudStorageService 编排', () => {
  it('未配置时 testConnection 抛错', async () => {
    await setupTestKey('main-password-1234');
    await expect(testConnection('oss')).rejects.toThrow('未配置');
  });

  it('uploadBackup 解密凭证 → 委托 provider → 记录 lastBackupAt', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    fakeProvider.uploadBackup.mockResolvedValue(undefined);
    const blob = new Blob(['x']);
    await uploadBackup('oss', blob);
    expect(fakeProvider.uploadBackup).toHaveBeenCalledWith(cfg, blob);
    expect(await getLastBackupAt('oss')).toBeGreaterThan(0);
  });

  it('downloadBackup 返回 provider 的 Blob', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    const blob = new Blob(['data']);
    fakeProvider.downloadBackup.mockResolvedValue(blob);
    expect(await downloadBackup('oss')).toBe(blob);
    expect(fakeProvider.downloadBackup).toHaveBeenCalledWith(cfg);
  });

  it('testConnection 委托 provider 并传入解密后的凭证', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    fakeProvider.testConnection.mockResolvedValue(undefined);
    await testConnection('oss');
    expect(fakeProvider.testConnection).toHaveBeenCalledWith(cfg);
  });
});
