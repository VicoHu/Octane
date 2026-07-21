import { describe, test, expect, beforeEach } from 'vitest';
import {
  getRequired,
  getDeviceId,
  setDeviceId,
  parseExportedAt,
  rand8,
  encodePrefix,
  computeId,
  assertValidVersionId,
  parseSnapshotMeta,
} from '../utils';
import { DEVICE_ID_KEY } from '../constants';
import type { CloudStorageConfig } from '../types';

/**
 * cloud/utils 单测。
 * 纯函数（rand8/encodePrefix/computeId/assertValidVersionId/parseExportedAt/getRequired）不 mock 被测对象；
 * getDeviceId/setDeviceId 命中 chrome.storage.local 副作用边界 → 内存 mock（遵循 testing.md §2 原则 3）。
 */

// chrome.storage.local 内存 mock（getDeviceId/setDeviceId 的副作用边界）
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
      },
    },
  };
}

beforeEach(() => {
  for (const k of Object.keys(localStore)) delete localStore[k];
  installChromeStorageLocal();
});

describe('getRequired', () => {
  test('返回所请求键的 string 值（全部存在）', () => {
    const cfg: CloudStorageConfig = {
      region: 'oss-cn-hangzhou',
      bucket: 'mybucket',
      accessKeyId: 'AK',
      accessKeySecret: 'SK',
    };
    const got = getRequired(cfg, ['region', 'bucket', 'accessKeyId', 'accessKeySecret']);
    expect(got).toEqual({
      region: 'oss-cn-hangzhou',
      bucket: 'mybucket',
      accessKeyId: 'AK',
      accessKeySecret: 'SK',
    });
  });

  test('缺失字段时抛错并指名缺失字段', () => {
    const cfg: CloudStorageConfig = { region: 'oss-cn-hangzhou' };
    expect(() => getRequired(cfg, ['region', 'bucket'])).toThrow(/bucket/);
  });

  test('空字符串视为缺失并抛错', () => {
    const cfg: CloudStorageConfig = { region: '  ', bucket: 'b' };
    expect(() => getRequired(cfg, ['region', 'bucket'])).toThrow(/region/);
  });

  test('未请求的字段不包含在返回值中', () => {
    const cfg: CloudStorageConfig = { region: 'r', bucket: 'b', accessKeyId: 'AK' };
    const got = getRequired(cfg, ['region']);
    expect(got).toEqual({ region: 'r' });
    expect(got).not.toHaveProperty('bucket');
  });
});

describe('getDeviceId / setDeviceId', () => {
  test('首次：storage 无 → 生成 UUID 并持久化', async () => {
    const id = await getDeviceId();
    // crypto.randomUUID 标准 UUID v4 格式
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(localStore[DEVICE_ID_KEY]).toBe(id);
  });

  test('复用：storage 已有 → 返回已存值，不重新生成', async () => {
    await setDeviceId('pre-set-uuid-1234');
    const id = await getDeviceId();
    expect(id).toBe('pre-set-uuid-1234');
    expect(localStore[DEVICE_ID_KEY]).toBe('pre-set-uuid-1234');
  });

  test('setDeviceId 写入 storage', async () => {
    await setDeviceId('explicit-id');
    expect(localStore[DEVICE_ID_KEY]).toBe('explicit-id');
  });
});

describe('parseExportedAt', () => {
  test('blob 含 exportedAt → 返回该数字', async () => {
    const blob = new Blob([JSON.stringify({ exportedAt: 1784622432000 })]);
    expect(await parseExportedAt(blob)).toBe(1784622432000);
  });

  test('blob 缺 exportedAt → throw', async () => {
    const blob = new Blob([JSON.stringify({ foo: 1 })]);
    await expect(parseExportedAt(blob)).rejects.toThrow(/exportedAt/);
  });

  test('blob 非 JSON → throw', async () => {
    const blob = new Blob(['not-json']);
    await expect(parseExportedAt(blob)).rejects.toThrow();
  });
});

describe('rand8', () => {
  test('返回 8 位 hex 字符串', () => {
    expect(rand8()).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('encodePrefix', () => {
  test('保留 / 不编码（S3 LIST prefix 期望 / 原样）', () => {
    expect(encodePrefix('octane/backup/')).toBe('octane/backup/');
  });

  test('段内特殊字符编码（空格 → %20）', () => {
    expect(encodePrefix('a b/c')).toBe('a%20b/c');
  });
});

describe('computeId', () => {
  test('S3 相对 key → 末段去 .json', () => {
    expect(
      computeId('octane/backup/octane-backup-110ec58a-1784622432000-deadbeef.json'),
    ).toBe('octane-backup-110ec58a-1784622432000-deadbeef');
  });

  test('WebDAV 完整 URL → 末段去 .json', () => {
    expect(
      computeId(
        'https://dav.jianguoyun.com/dav/octane/octane-backup-110ec58a-1784622432000-deadbeef.json',
      ),
    ).toBe('octane-backup-110ec58a-1784622432000-deadbeef');
  });

  test('latest key → octane-backup', () => {
    expect(computeId('octane/backup/octane-backup.json')).toBe('octane-backup');
  });
});

describe('assertValidVersionId', () => {
  test('合法 snapshot id（3 段）通过', () => {
    expect(() =>
      assertValidVersionId('octane-backup-110ec58a-1784622432000-deadbeef'),
    ).not.toThrow();
  });

  test('含 / → throw（路径注入）', () => {
    expect(() => assertValidVersionId('octane-backup-x/y')).toThrow();
  });

  test('含 .. → throw', () => {
    expect(() => assertValidVersionId('../etc/passwd')).toThrow();
  });

  test('latest id octane-backup（0 段）→ throw（防删 latest）', () => {
    expect(() => assertValidVersionId('octane-backup')).toThrow();
  });

  test('空串 → throw', () => {
    expect(() => assertValidVersionId('')).toThrow();
  });
});

describe('parseSnapshotMeta', () => {
  test('合法 snapshot 文件名 → {device, timestamp}', () => {
    expect(
      parseSnapshotMeta('octane-backup-110ec58a-1784622432000-deadbeef.json'),
    ).toEqual({ device: '110ec58a', timestamp: 1784622432000 });
  });

  test('合法 snapshot id（无 .json）→ {device, timestamp}', () => {
    expect(parseSnapshotMeta('octane-backup-110ec58a-1784622432000-deadbeef')).toEqual({
      device: '110ec58a',
      timestamp: 1784622432000,
    });
  });

  test('latest octane-backup.json → null（不纳入 listBackups）', () => {
    expect(parseSnapshotMeta('octane-backup.json')).toBeNull();
  });

  test('latest id octane-backup → null', () => {
    expect(parseSnapshotMeta('octane-backup')).toBeNull();
  });

  test('无关文件 → null', () => {
    expect(parseSnapshotMeta('readme.txt')).toBeNull();
  });
});
