import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AwsClient } from 'aws4fetch';
import { S3Provider } from '../providers/S3Provider';
import { BACKUP_OBJECT_KEY, BACKUP_PREFIX } from '../constants';
import { setDeviceId } from '../utils';
import type { CloudStorageConfig } from '../types';

/**
 * S3Provider 双层方案测试（D4=B 结构断言）。
 * mock `fetch`；aws4fetch 真实签名产出真 Request 供断言；getDeviceId 命中 chrome.storage.local 副作用边界 → 内存 mock。
 * 遵循 docs/standards/testing.md：不 mock 被测对象，仅 mock 副作用边界（网络 fetch / chrome.storage）。
 */

const AK = 'AKIDMOCKACCESSKEYID00';
const SK = 'mock00secretAccessKey//PLUSxxxxx';
const BUCKET = 'octane-mock-bucket';
const REGION = 'oss-cn-hangzhou';
const VHOST = `https://${BUCKET}.s3.${REGION}.aliyuncs.com`;
/** 固定 deviceId，让 snapshot 文件名 dev8 = 110ec58a 可断言。 */
const DEVICE_ID = '110ec58a-a0f2-4ac4-8393-c866d8eeb9a5';
const DEV8 = DEVICE_ID.slice(0, 8);

function baseCfg(overrides: Partial<CloudStorageConfig> = {}): CloudStorageConfig {
  return {
    s3Preset: 'aliyun',
    region: REGION,
    bucket: BUCKET,
    accessKeyId: AK,
    accessKeySecret: SK,
    ...overrides,
  };
}

/** 构造合法 backup blob（含 exportedAt）。 */
function backupBlob(exportedAt = 1784622432000): Blob {
  return new Blob(
    [
      JSON.stringify({
        schema: 'octane-backup',
        version: 4,
        kind: 'backup',
        exportedAt,
        appVersion: '0.1.13.1',
        data: {},
      }),
    ],
    { type: 'application/json' },
  );
}

/** 构造 S3 LIST v2 XML 响应。 */
function listResult(
  items: { key: string; size: string; lm?: string }[],
  truncated = false,
): string {
  const contents = items
    .map(
      (i) =>
        `<Contents><Key>${i.key}</Key><LastModified>${i.lm ?? '2026-07-21T00:00:00.000Z'}</LastModified><Size>${i.size}</Size></Contents>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>${truncated}</IsTruncated>${contents}</ListBucketResult>`;
}

/** 取 mock fetch 第 N 次调用的 Request（0-based）。 */
function reqAt(mockFetch: ReturnType<typeof vi.fn>, n: number): Request {
  return mockFetch.mock.calls[n]?.[0] as Request;
}

/** chrome.storage.local 内存 mock（getDeviceId 副作用边界）。 */
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

describe('S3Provider', () => {
  let provider: S3Provider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    provider = new S3Provider();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    for (const k of Object.keys(localStore)) delete localStore[k];
    installChromeStorageLocal();
    await setDeviceId(DEVICE_ID);
  });

  describe('静态契约', () => {
    it('id 为 s3', () => {
      expect(provider.id).toBe('s3');
    });

    it('label 为 S3 兼容存储', () => {
      expect(provider.label).toBe('S3 兼容存储');
    });

    it('configFields 含 s3Preset/region/bucket/accessKeyId/accessKeySecret 五个必填字段', () => {
      const names = provider.configFields.map((f) => f.name);
      expect(names).toEqual([
        's3Preset',
        'region',
        'bucket',
        'accessKeyId',
        'accessKeySecret',
      ]);
      for (const f of provider.configFields) {
        expect(f.required).toBe(true);
      }
    });

    it('s3Preset 字段为 select，options 含 aliyun 与 tencent', () => {
      const preset = provider.configFields.find((f) => f.name === 's3Preset');
      expect(preset?.type).toBe('select');
      expect(preset?.options).toEqual(['aliyun', 'tencent']);
    });

    it('accessKeySecret 字段为 password 类型', () => {
      const sk = provider.configFields.find((f) => f.name === 'accessKeySecret');
      expect(sk?.type).toBe('password');
    });
  });

  describe('getRequired 与 preset 校验', () => {
    it('缺 s3Preset 抛错（消息含 preset）', async () => {
      await expect(provider.testConnection(baseCfg({ s3Preset: undefined }))).rejects.toThrow(
        /preset/,
      );
    });

    it('缺 region 抛错', async () => {
      await expect(provider.testConnection(baseCfg({ region: undefined }))).rejects.toThrow(
        /region/,
      );
    });

    it('缺 bucket 抛错', async () => {
      await expect(provider.testConnection(baseCfg({ bucket: undefined }))).rejects.toThrow(
        /bucket/,
      );
    });

    it('缺 accessKeyId 抛错', async () => {
      await expect(
        provider.testConnection(baseCfg({ accessKeyId: undefined })),
      ).rejects.toThrow(/accessKeyId/);
    });

    it('缺 accessKeySecret 抛错', async () => {
      await expect(
        provider.testConnection(baseCfg({ accessKeySecret: undefined })),
      ).rejects.toThrow(/accessKeySecret/);
    });
  });

  describe('preset → endpoint 推导（vhost）', () => {
    it('aliyun：HEAD URL 含 ${bucket}.s3.${region}.aliyuncs.com', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // HEAD
        .mockResolvedValueOnce(new Response(listResult([]), { status: 200 })); // LIST
      await provider.testConnection(baseCfg({ s3Preset: 'aliyun' }));
      expect(reqAt(mockFetch, 0).url).toContain(VHOST);
      expect(reqAt(mockFetch, 0).method).toBe('HEAD');
    });

    it('tencent：HEAD URL 含 ${bucket}.cos.${region}.myqcloud.com', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(listResult([]), { status: 200 }));
      await provider.testConnection(baseCfg({ s3Preset: 'tencent', region: 'ap-guangzhou' }));
      expect(reqAt(mockFetch, 0).url).toContain(`https://${BUCKET}.cos.ap-guangzhou.myqcloud.com`);
    });
  });

  describe('testConnection（HEAD bucket + LIST prefix 试权限）', () => {
    it('HEAD 200 + LIST 200 → 通过', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(listResult([]), { status: 200 }));
      await expect(provider.testConnection(baseCfg())).resolves.toBeUndefined();
    });

    it('HEAD 403 → 抛错（消息含凭证）', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
      await expect(provider.testConnection(baseCfg())).rejects.toThrow(/凭证/);
    });

    it('HEAD 404 → 抛错（消息含桶）', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
      await expect(provider.testConnection(baseCfg())).rejects.toThrow(/桶/);
    });

    it('HEAD 200 + LIST 403 → 抛错（缺 ListBucket 权限）', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 403 }));
      await expect(provider.testConnection(baseCfg())).rejects.toThrow(/权限|ListBucket|列/);
    });

    it('HEAD 500 → 抛错', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
      await expect(provider.testConnection(baseCfg())).rejects.toThrow();
    });
  });

  describe('uploadBackup（latest 覆盖 + snapshot create-only）', () => {
    it('2 PUT：latest 到 BACKUP_OBJECT_KEY + snapshot 到 octane-backup-{dev8}-{ts}-{rand8}.json', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // latest PUT
        .mockResolvedValueOnce(new Response(null, { status: 200 })); // snapshot PUT
      await provider.uploadBackup(baseCfg(), backupBlob());
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const latestReq = reqAt(mockFetch, 0);
      expect(latestReq.method).toBe('PUT');
      expect(latestReq.url).toBe(`${VHOST}/${BACKUP_OBJECT_KEY}`);
      const snapReq = reqAt(mockFetch, 1);
      expect(snapReq.method).toBe('PUT');
      expect(snapReq.url).toMatch(
        new RegExp(
          `${VHOST}/octane/backup/octane-backup-${DEV8}-1784622432000-[0-9a-f]{8}\\.json`,
        ),
      );
    });

    it('返回 {latest, snapshot}（id/key/device/timestamp/size）', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      const blob = backupBlob(1784622432000);
      const result = await provider.uploadBackup(baseCfg(), blob);
      expect(result.latest).toMatchObject({
        id: 'octane-backup',
        key: BACKUP_OBJECT_KEY,
        device: DEV8,
        timestamp: 1784622432000,
      });
      expect(result.latest.size).toBe(blob.size);
      expect(result.snapshot).toMatchObject({
        device: DEV8,
        timestamp: 1784622432000,
      });
      expect(result.snapshot.id).toMatch(
        new RegExp(`^octane-backup-${DEV8}-1784622432000-[0-9a-f]{8}$`),
      );
      expect(result.snapshot.key).toBe(`${BACKUP_PREFIX}${result.snapshot.id}.json`);
      expect(result.snapshot.size).toBe(blob.size);
    });

    it('snapshot create-only 412 → 重生成 rand8 重试（≤3），第 3 次成功', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // latest
        .mockResolvedValueOnce(new Response(null, { status: 412 })) // snap 412
        .mockResolvedValueOnce(new Response(null, { status: 412 })) // snap 412
        .mockResolvedValueOnce(new Response(null, { status: 200 })); // snap ok
      await provider.uploadBackup(baseCfg(), backupBlob());
      // 1 latest + 3 snapshot 尝试
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('snapshot create-only 连续 3 次 412 → 抛错', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 })) // latest
        .mockResolvedValueOnce(new Response(null, { status: 412 }))
        .mockResolvedValueOnce(new Response(null, { status: 412 }))
        .mockResolvedValueOnce(new Response(null, { status: 412 }));
      await expect(provider.uploadBackup(baseCfg(), backupBlob())).rejects.toThrow();
    });

    it('latest PUT 非 2xx → 抛错（不发起 snapshot）', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
      await expect(provider.uploadBackup(baseCfg(), backupBlob())).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('snapshot PUT 带 If-None-Match:*；latest 不带', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      await provider.uploadBackup(baseCfg(), backupBlob());
      expect(reqAt(mockFetch, 0).headers.get('If-None-Match')).toBeNull();
      expect(reqAt(mockFetch, 1).headers.get('If-None-Match')).toBe('*');
    });

    it('两 PUT 均带 x-amz-content-sha256: UNSIGNED-PAYLOAD', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      await provider.uploadBackup(baseCfg(), backupBlob());
      expect(reqAt(mockFetch, 0).headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
      expect(reqAt(mockFetch, 1).headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
    });
  });

  describe('listBackups（LIST v2 + DOMParser，只列 snapshot，按 exportedAt 倒序）', () => {
    it('GET ?list-type=2&prefix=octane/backup/&max-keys=1000', async () => {
      mockFetch.mockResolvedValueOnce(new Response(listResult([]), { status: 200 }));
      await provider.listBackups(baseCfg());
      const u = new URL(reqAt(mockFetch, 0).url);
      expect(reqAt(mockFetch, 0).method).toBe('GET');
      expect(u.searchParams.get('list-type')).toBe('2');
      expect(u.searchParams.get('prefix')).toBe('octane/backup/');
      expect(u.searchParams.get('max-keys')).toBe('1000');
    });

    it('只纳入精确 snapshot，忽略 latest/无关；按 timestamp 倒序', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          listResult([
            { key: 'octane/backup/octane-backup.json', size: '100' }, // latest 忽略
            { key: `octane/backup/octane-backup-${DEV8}-1784622432000-aaaaaaaa.json`, size: '200' },
            { key: `octane/backup/octane-backup-${DEV8}-1784622000000-bbbbbbbb.json`, size: '300' },
            { key: 'octane/backup/readme.txt', size: '10' }, // 无关忽略
          ]),
          { status: 200 },
        ),
      );
      const list = await provider.listBackups(baseCfg());
      expect(list).toHaveLength(2);
      const [first, second] = list;
      expect(first?.timestamp).toBe(1784622432000); // 倒序最新在前
      expect(second?.timestamp).toBe(1784622000000);
      expect(first?.device).toBe(DEV8);
      expect(first?.size).toBe(200);
      expect(first?.id).toBe(`octane-backup-${DEV8}-1784622432000-aaaaaaaa`);
    });

    it('空列表返回 []', async () => {
      mockFetch.mockResolvedValueOnce(new Response(listResult([]), { status: 200 }));
      expect(await provider.listBackups(baseCfg())).toEqual([]);
    });

    it('IsTruncated=true → console.warn（V1 不分页处理）', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      mockFetch.mockResolvedValueOnce(new Response(listResult([], true), { status: 200 }));
      await provider.listBackups(baseCfg());
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('非 2xx → 抛错', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
      await expect(provider.listBackups(baseCfg())).rejects.toThrow();
    });
  });

  describe('downloadBackup', () => {
    it('不传 versionId → GET latest（BACKUP_OBJECT_KEY）', async () => {
      mockFetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      await provider.downloadBackup(baseCfg());
      expect(reqAt(mockFetch, 0).method).toBe('GET');
      expect(reqAt(mockFetch, 0).url).toBe(`${VHOST}/${BACKUP_OBJECT_KEY}`);
    });

    it('传合法 versionId → GET snapshot key', async () => {
      mockFetch.mockResolvedValueOnce(new Response('data', { status: 200 }));
      await provider.downloadBackup(
        baseCfg(),
        `octane-backup-${DEV8}-1784622432000-aaaaaaaa`,
      );
      expect(reqAt(mockFetch, 0).url).toContain(
        `octane/backup/octane-backup-${DEV8}-1784622432000-aaaaaaaa.json`,
      );
    });

    it('非法 versionId（含 /）→ 抛错，不发请求', async () => {
      await expect(provider.downloadBackup(baseCfg(), '../etc')).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('latest 404 → 抛 EmptyBackupListError（云端无备份）', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
      await expect(provider.downloadBackup(baseCfg())).rejects.toThrow(/云端无备份/);
    });

    it('snapshot 404 → 抛错（陈旧）', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
      await expect(
        provider.downloadBackup(baseCfg(), `octane-backup-${DEV8}-1784622432000-aaaaaaaa`),
      ).rejects.toThrow(/陈旧|刷新/);
    });
  });

  describe('deleteBackup', () => {
    it('DELETE snapshot key', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await provider.deleteBackup(baseCfg(), `octane-backup-${DEV8}-1784622432000-aaaaaaaa`);
      expect(reqAt(mockFetch, 0).method).toBe('DELETE');
      expect(reqAt(mockFetch, 0).url).toContain(
        `octane/backup/octane-backup-${DEV8}-1784622432000-aaaaaaaa.json`,
      );
    });

    it('latest id（0 段）→ 抛错，不发请求（防删 latest）', async () => {
      await expect(provider.deleteBackup(baseCfg(), 'octane-backup')).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('非法 versionId（含 ..）→ 抛错，不发请求', async () => {
      await expect(provider.deleteBackup(baseCfg(), '../etc/passwd')).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('非 2xx → 抛错', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
      await expect(
        provider.deleteBackup(baseCfg(), `octane-backup-${DEV8}-1784622432000-aaaaaaaa`),
      ).rejects.toThrow();
    });
  });

  describe('AwsClient 构造（隐式：签名可用即说明 client 正确构造）', () => {
    it('真实 AwsClient.sign 产出可用 Request（端到端结构）', async () => {
      const client = new AwsClient({
        accessKeyId: AK,
        secretAccessKey: SK,
        region: REGION,
        service: 's3',
      });
      const signed = (await client.sign(`${VHOST}/x`, { method: 'GET' })) as Request;
      expect(signed.headers.get('Authorization')!).toMatch(/^AWS4-HMAC-SHA256/);
    });
  });
});
