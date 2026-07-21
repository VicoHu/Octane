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
  listBackups,
  deleteBackup,
  computeRetention,
} from '@/services/CloudStorageService';
import type { BackupVersion } from '@/services/cloud/types';

// 编排测试用：mock provider 注册表（避免引入真实 SDK）。
const fakeProvider = vi.hoisted(() => ({
  testConnection: vi.fn(),
  uploadBackup: vi.fn(),
  downloadBackup: vi.fn(),
  listBackups: vi.fn(),
  deleteBackup: vi.fn(),
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

/** 构造 snapshot BackupVersion（listBackups mock 用，已倒序）。 */
function snap(id: string, device: string, timestamp: number, size = 100): BackupVersion {
  return { id, key: `octane/backup/${id}.json`, device, timestamp, size };
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
  fakeProvider.listBackups.mockReset();
  fakeProvider.deleteBackup.mockReset();
});

describe('CloudStorageService 凭证层', () => {
  it('saveCloudConfig → getCloudConfig 往返还原（密文落盘，内存读出明文）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    const got = await getCloudConfig('s3');
    expect(got).toEqual(cfg);
  });

  it('凭证在 storage.local 中为密文（不可读明文 accessKeySecret）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    const raw = localStore['octane.cloudCreds.s3'] as { encryptedData: string; iv: string };
    expect(raw.encryptedData).not.toContain(cfg.accessKeySecret);
    expect(raw.iv).toBeTruthy();
  });

  it('未配置时 getCloudConfig 返回 null', async () => {
    await setupTestKey('main-password-1234');
    expect(await getCloudConfig('webdav')).toBeNull();
  });

  it('未解锁时 getCloudConfig 抛错', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    setTestKey(null); // 模拟锁定
    await expect(getCloudConfig('s3')).rejects.toThrow();
  });

  it('clearCloudConfig 移除凭证', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    await clearCloudConfig('s3');
    expect(await getCloudConfig('s3')).toBeNull();
  });

  it('凭证按 provider 分键（s3/webdav 互不干扰）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    await saveCloudConfig('webdav', { ...cfg, bucket: 'cos-bucket' });
    expect((await getCloudConfig('s3'))?.bucket).toBe('octane-test');
    expect((await getCloudConfig('webdav'))?.bucket).toBe('cos-bucket');
  });

  it('lastBackupAt 明文时间戳读写', async () => {
    await setLastBackupAt('s3', 1_700_000_000_000);
    expect(await getLastBackupAt('s3')).toBe(1_700_000_000_000);
    expect(await getLastBackupAt('webdav')).toBeNull();
  });
});

describe('computeRetention（retention 纯逻辑：per-device 5 + 全局兜底 100）', () => {
  const DEV = '110ec58a';

  it('per-device：6 个同设备 → 返回最旧 1 个', () => {
    const list = [
      snap(`octane-backup-${DEV}-6-aaaa1111`, DEV, 6),
      snap(`octane-backup-${DEV}-5-bbbb2222`, DEV, 5),
      snap(`octane-backup-${DEV}-4-cccc3333`, DEV, 4),
      snap(`octane-backup-${DEV}-3-dddd4444`, DEV, 3),
      snap(`octane-backup-${DEV}-2-eeee5555`, DEV, 2),
      snap(`octane-backup-${DEV}-1-ffff6666`, DEV, 1),
    ]; // 倒序（最新在前）
    const del = computeRetention(list);
    expect(del).toHaveLength(1);
    expect(del[0]?.timestamp).toBe(1); // 最旧
  });

  it('per-device：5 个同设备 → 返回 []（正好达上限不删）', () => {
    const list = [5, 4, 3, 2, 1].map((ts) =>
      snap(`octane-backup-${DEV}-${ts}-${ts}0000000`, DEV, ts),
    );
    expect(computeRetention(list)).toEqual([]);
  });

  it('多设备 A6+B2 → 只删 A 的最旧 1，B 全保留', () => {
    const list = [
      snap('octane-backup-aaaaaaaa-6-a', 'aaaaaaaa', 6),
      snap('octane-backup-aaaaaaaa-5-a', 'aaaaaaaa', 5),
      snap('octane-backup-aaaaaaaa-4-a', 'aaaaaaaa', 4),
      snap('octane-backup-aaaaaaaa-3-a', 'aaaaaaaa', 3),
      snap('octane-backup-aaaaaaaa-2-a', 'aaaaaaaa', 2),
      snap('octane-backup-aaaaaaaa-1-a', 'aaaaaaaa', 1),
      snap('octane-backup-bbbbbbbb-2-b', 'bbbbbbbb', 2),
      snap('octane-backup-bbbbbbbb-1-b', 'bbbbbbbb', 1),
    ];
    const del = computeRetention(list);
    expect(del).toHaveLength(1);
    expect(del[0]?.device).toBe('aaaaaaaa');
  });

  it('全局兜底：总数超 100 → 删除最旧到 100（per-device 不触发时）', () => {
    // 21 设备 × 5 = 105，每设备正好 5（per-device 不删），但总数 105 > 100 → 删最旧 5
    const list: BackupVersion[] = [];
    for (let d = 0; d < 21; d++) {
      const dev = d.toString(16).padStart(8, '0');
      for (let t = 0; t < 5; t++) {
        const ts = 1000 + d * 10 + t;
        list.push(snap(`octane-backup-${dev}-${ts}-${dev}`, dev, ts));
      }
    }
    list.sort((a, b) => b.timestamp - a.timestamp); // 倒序
    expect(list).toHaveLength(105);
    const del = computeRetention(list);
    expect(del).toHaveLength(5); // 105 - 100
    // 删除的是 timestamp 最小的 5 个
    const delTs = del.map((v) => v.timestamp).sort((a, b) => a - b);
    expect(delTs).toEqual([1000, 1001, 1002, 1003, 1004]);
  });
});

describe('CloudStorageService 编排', () => {
  const UPLOADED = {
    latest: {
      id: 'octane-backup',
      key: 'octane/backup/octane-backup.json',
      device: '110ec58a',
      timestamp: 1784622432000,
      size: 100,
    },
    snapshot: {
      id: 'octane-backup-110ec58a-1784622432000-deadbeef',
      key: 'octane/backup/octane-backup-110ec58a-1784622432000-deadbeef.json',
      device: '110ec58a',
      timestamp: 1784622432000,
      size: 100,
    },
  } as const;

  it('未配置时 testConnection 抛错', async () => {
    await setupTestKey('main-password-1234');
    await expect(testConnection('s3')).rejects.toThrow('未配置');
  });

  it('uploadBackup 返回 {latest,snapshot} + setLastBackupAt(latest.timestamp)', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    fakeProvider.uploadBackup.mockResolvedValue(UPLOADED);
    fakeProvider.listBackups.mockResolvedValue([]);
    const blob = new Blob(['x']);
    const result = await uploadBackup('s3', blob);
    expect(fakeProvider.uploadBackup).toHaveBeenCalledWith(cfg, blob);
    expect(result.latest.timestamp).toBe(1784622432000);
    // latest.timestamp（exportedAt），非 Date.now()
    expect(await getLastBackupAt('s3')).toBe(1784622432000);
  });

  it('uploadBackup retention：6 个同设备 snapshot → delete 最旧 1', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    fakeProvider.uploadBackup.mockResolvedValue(UPLOADED);
    fakeProvider.listBackups.mockResolvedValue([
      snap('octane-backup-110ec58a-6-a', '110ec58a', 6),
      snap('octane-backup-110ec58a-5-b', '110ec58a', 5),
      snap('octane-backup-110ec58a-4-c', '110ec58a', 4),
      snap('octane-backup-110ec58a-3-d', '110ec58a', 3),
      snap('octane-backup-110ec58a-2-e', '110ec58a', 2),
      snap('octane-backup-110ec58a-1-f', '110ec58a', 1),
    ]);
    fakeProvider.deleteBackup.mockResolvedValue(undefined);
    await uploadBackup('s3', new Blob(['x']));
    expect(fakeProvider.deleteBackup).toHaveBeenCalledTimes(1);
    expect(fakeProvider.deleteBackup).toHaveBeenCalledWith(cfg, 'octane-backup-110ec58a-1-f');
  });

  it('retention 失败 → console.warn 不阻断上传（上传已成功是第一要务）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    fakeProvider.uploadBackup.mockResolvedValue(UPLOADED);
    fakeProvider.listBackups.mockRejectedValue(new Error('list 失败'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(uploadBackup('s3', new Blob(['x']))).resolves.toBeDefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('downloadBackup 不传 versionId → 透传 (cfg, undefined)（GET latest）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    const blob = new Blob(['data']);
    fakeProvider.downloadBackup.mockResolvedValue(blob);
    expect(await downloadBackup('s3')).toBe(blob);
    expect(fakeProvider.downloadBackup).toHaveBeenCalledWith(cfg, undefined);
  });

  it('downloadBackup 传 versionId → 透传', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    fakeProvider.downloadBackup.mockResolvedValue(new Blob(['d']));
    await downloadBackup('s3', 'octane-backup-110ec58a-1784622432000-deadbeef');
    expect(fakeProvider.downloadBackup).toHaveBeenCalledWith(
      cfg,
      'octane-backup-110ec58a-1784622432000-deadbeef',
    );
  });

  it('listBackups 薄封装（解密凭证后委托）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    const list = [snap('octane-backup-110ec58a-1-a', '110ec58a', 1)];
    fakeProvider.listBackups.mockResolvedValue(list);
    expect(await listBackups('s3')).toBe(list);
    expect(fakeProvider.listBackups).toHaveBeenCalledWith(cfg);
  });

  it('deleteBackup 薄封装（解密凭证后委托）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    fakeProvider.deleteBackup.mockResolvedValue(undefined);
    await deleteBackup('s3', 'octane-backup-110ec58a-1784622432000-deadbeef');
    expect(fakeProvider.deleteBackup).toHaveBeenCalledWith(
      cfg,
      'octane-backup-110ec58a-1784622432000-deadbeef',
    );
  });

  it('testConnection 委托 provider 并传入解密后的凭证', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('s3', cfg);
    fakeProvider.testConnection.mockResolvedValue(undefined);
    await testConnection('s3');
    expect(fakeProvider.testConnection).toHaveBeenCalledWith(cfg);
  });
});
