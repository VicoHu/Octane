import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WEBDAV_PRESETS } from '../presets';
import { WebdavProvider } from '../providers/WebdavProvider';
import { setDeviceId } from '../utils';

/**
 * WebdavProvider 双层方案单测：mock 全局 fetch（网络边界）+ chrome.storage.local（getDeviceId 副作用边界），
 * 真实渲染被测 Provider。遵循 docs/standards/testing.md：不 mock 被测对象，仅 mock 副作用边界。
 */

const cfg = {
  webdavPreset: 'jianguoyun' as const,
  username: 'me@example.com',
  password: 'app-pwd-123',
};

const BASE_URL = WEBDAV_PRESETS.jianguoyun.baseUrl; // https://dav.jianguoyun.com/dav/
const DIR_URL = `${BASE_URL}octane`;
const LATEST_URL = `${BASE_URL}octane/octane-backup.json`;
/** 固定 deviceId，让 snapshot 文件名 dev8 = 110ec58a 可断言。 */
const DEVICE_ID = '110ec58a-a0f2-4ac4-8393-c866d8eeb9a5';
const DEV8 = DEVICE_ID.slice(0, 8);

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

/** 构造 WebDAV PROPFIND multistatus 响应。 */
function propfindResult(
  items: { href: string; size?: string; status?: string }[],
): string {
  const responses = items
    .map(
      (i) => `
    <D:response>
      <D:href>${i.href}</D:href>
      <D:propstat>
        <D:prop>
          <D:getcontentlength>${i.size ?? '0'}</D:getcontentlength>
        </D:prop>
        <D:status>${i.status ?? 'HTTP/1.1 200 OK'}</D:status>
      </D:propstat>
    </D:response>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${responses}</D:multistatus>`;
}

/** 期待并解码 Authorization 头为 `username:password`。 */
function decodeAuth(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  expect(auth.startsWith('Basic ')).toBe(true);
  return atob(auth.slice('Basic '.length));
}

/** 取 mock fetch 第 N 次调用的 Request（0-based）。 */
function reqAt(mockFetch: ReturnType<typeof vi.fn>, n: number): Request {
  return mockFetch.mock.calls[n]?.[0] as Request;
}

/** 构造受控 Response。204/205/304 等无 body 状态自动传 null。 */
function res(status: number, body: BodyInit | null = ''): Response {
  if ([204, 205, 304].includes(status)) {
    return new Response(null, { status });
  }
  return new Response(body, { status });
}

let fetchMock: ReturnType<typeof vi.fn>;
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

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  for (const k of Object.keys(localStore)) delete localStore[k];
  installChromeStorageLocal();
  await setDeviceId(DEVICE_ID);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebdavProvider', () => {
  const provider = new WebdavProvider();

  it('元信息：id=webdav，label 取自 jianguoyun preset，configFields 含 3 项', () => {
    expect(provider.id).toBe('webdav');
    expect(provider.label).toBe(WEBDAV_PRESETS.jianguoyun.label);
    const names = provider.configFields.map((f) => f.name);
    expect(names).toEqual(['webdavPreset', 'username', 'password']);

    const presetField = provider.configFields.find((f) => f.name === 'webdavPreset');
    expect(presetField?.type).toBe('select');
    expect(presetField?.options).toEqual(['jianguoyun']);
    expect(presetField?.required).toBe(true);

    const pwdField = provider.configFields.find((f) => f.name === 'password');
    expect(pwdField?.type).toBe('password');
    expect(pwdField?.required).toBe(true);
  });

  describe('testConnection', () => {
    it('PROPFIND baseUrl + Depth:1 头（试列目录权限）；2xx 通过', async () => {
      fetchMock.mockResolvedValueOnce(res(207));
      await provider.testConnection(cfg);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const req = fetchMock.mock.calls[0]?.[0] as Request;
      expect(req.method).toBe('PROPFIND');
      expect(req.url).toBe(BASE_URL);
      expect(req.headers.get('depth')).toBe('1');
      expect(decodeAuth(req)).toBe(`${cfg.username}:${cfg.password}`);
    });

    it('非 2xx → 抛错', async () => {
      fetchMock.mockResolvedValueOnce(res(401));
      await expect(provider.testConnection(cfg)).rejects.toThrow();
    });
  });

  describe('uploadBackup（MKCOL + PUT latest 覆盖 + PUT snapshot create-only）', () => {
    it('依次 MKCOL + PUT latest + PUT snapshot；URL 正确拼接', async () => {
      fetchMock
        .mockResolvedValueOnce(res(201)) // MKCOL
        .mockResolvedValueOnce(res(204)) // PUT latest
        .mockResolvedValueOnce(res(204)); // PUT snapshot

      await provider.uploadBackup(cfg, backupBlob());
      expect(fetchMock).toHaveBeenCalledTimes(3);

      expect(reqAt(fetchMock, 0).method).toBe('MKCOL');
      expect(reqAt(fetchMock, 0).url).toBe(DIR_URL);

      expect(reqAt(fetchMock, 1).method).toBe('PUT');
      expect(reqAt(fetchMock, 1).url).toBe(LATEST_URL);

      expect(reqAt(fetchMock, 2).method).toBe('PUT');
      expect(reqAt(fetchMock, 2).url).toMatch(
        new RegExp(`${BASE_URL}octane/octane-backup-${DEV8}-1784622432000-[0-9a-f]{8}\\.json`),
      );
    });

    it('返回 {latest, snapshot}（id/key/device/timestamp/size）', async () => {
      fetchMock
        .mockResolvedValueOnce(res(201))
        .mockResolvedValueOnce(res(204))
        .mockResolvedValueOnce(res(204));
      const blob = backupBlob(1784622432000);
      const result = await provider.uploadBackup(cfg, blob);
      expect(result.latest).toMatchObject({
        id: 'octane-backup',
        device: DEV8,
        timestamp: 1784622432000,
      });
      expect(result.latest.key).toBe(LATEST_URL);
      expect(result.latest.size).toBe(blob.size);
      expect(result.snapshot.device).toBe(DEV8);
      expect(result.snapshot.timestamp).toBe(1784622432000);
      expect(result.snapshot.id).toMatch(
        new RegExp(`^octane-backup-${DEV8}-1784622432000-[0-9a-f]{8}$`),
      );
      expect(result.snapshot.size).toBe(blob.size);
    });

    it('snapshot PUT 带 If-None-Match:*；latest 不带', async () => {
      fetchMock
        .mockResolvedValueOnce(res(201))
        .mockResolvedValueOnce(res(204))
        .mockResolvedValueOnce(res(204));
      await provider.uploadBackup(cfg, backupBlob());
      expect(reqAt(fetchMock, 1).headers.get('If-None-Match')).toBeNull();
      expect(reqAt(fetchMock, 2).headers.get('If-None-Match')).toBe('*');
    });

    it('snapshot create-only 412 → 重生成 rand8 重试（≤3），第 3 次成功', async () => {
      fetchMock
        .mockResolvedValueOnce(res(201)) // MKCOL
        .mockResolvedValueOnce(res(204)) // PUT latest
        .mockResolvedValueOnce(res(412)) // snap 412
        .mockResolvedValueOnce(res(412)) // snap 412
        .mockResolvedValueOnce(res(204)); // snap ok
      await provider.uploadBackup(cfg, backupBlob());
      // 1 MKCOL + 1 latest + 3 snapshot 尝试
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });

    it('snapshot create-only 连续 3 次 412 → 抛错', async () => {
      fetchMock
        .mockResolvedValueOnce(res(201))
        .mockResolvedValueOnce(res(204))
        .mockResolvedValueOnce(res(412))
        .mockResolvedValueOnce(res(412))
        .mockResolvedValueOnce(res(412));
      await expect(provider.uploadBackup(cfg, backupBlob())).rejects.toThrow();
    });

    it('MKCOL 幂等：405 视为目录已存在继续', async () => {
      fetchMock
        .mockResolvedValueOnce(res(405)) // MKCOL 已存在
        .mockResolvedValueOnce(res(204)) // PUT latest
        .mockResolvedValueOnce(res(204)); // PUT snapshot
      await provider.uploadBackup(cfg, backupBlob());
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(reqAt(fetchMock, 1).method).toBe('PUT');
    });

    it('MKCOL 幂等：409 视为目录已存在继续', async () => {
      fetchMock
        .mockResolvedValueOnce(res(409))
        .mockResolvedValueOnce(res(204))
        .mockResolvedValueOnce(res(204));
      await provider.uploadBackup(cfg, backupBlob());
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('MKCOL 其它非幂等状态（如 500）→ 抛错，不发起 PUT', async () => {
      fetchMock.mockResolvedValueOnce(res(500));
      await expect(provider.uploadBackup(cfg, backupBlob())).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('PUT latest 非 2xx → 抛错（不发起 snapshot）', async () => {
      fetchMock
        .mockResolvedValueOnce(res(201))
        .mockResolvedValueOnce(res(502));
      await expect(provider.uploadBackup(cfg, backupBlob())).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('listBackups（PROPFIND Depth:1 鲁棒解析，只列 snapshot，按 exportedAt 倒序）', () => {
    it('PROPFIND octane 目录 Depth:1 + propfind body', async () => {
      fetchMock.mockResolvedValueOnce(res(207, propfindResult([])));
      await provider.listBackups(cfg);
      const req = reqAt(fetchMock, 0);
      expect(req.method).toBe('PROPFIND');
      expect(req.url).toBe(`${BASE_URL}octane/`);
      expect(req.headers.get('depth')).toBe('1');
    });

    it('只纳入精确 snapshot，忽略目录自身/latest/无关；按 timestamp 倒序', async () => {
      fetchMock.mockResolvedValueOnce(
        res(
          207,
          propfindResult([
            { href: '/dav/octane/' }, // 目录自身（无 size）忽略
            { href: '/dav/octane/octane-backup.json', size: '100' }, // latest 忽略
            { href: `/dav/octane/octane-backup-${DEV8}-1784622432000-aaaaaaaa.json`, size: '200' },
            { href: `/dav/octane/octane-backup-${DEV8}-1784622000000-bbbbbbbb.json`, size: '300' },
            { href: '/dav/octane/readme.txt', size: '10' }, // 无关忽略
          ]),
        ),
      );
      const list = await provider.listBackups(cfg);
      expect(list).toHaveLength(2);
      const [first, second] = list;
      expect(first?.timestamp).toBe(1784622432000);
      expect(second?.timestamp).toBe(1784622000000);
      expect(first?.device).toBe(DEV8);
      expect(first?.size).toBe(200);
      expect(first?.id).toBe(`octane-backup-${DEV8}-1784622432000-aaaaaaaa`);
      expect(first?.key).toBe(
        `${BASE_URL}octane/octane-backup-${DEV8}-1784622432000-aaaaaaaa.json`,
      );
    });

    it('空 multistatus 返回 []', async () => {
      fetchMock.mockResolvedValueOnce(res(207, propfindResult([])));
      expect(await provider.listBackups(cfg)).toEqual([]);
    });

    it('非 2xx → 抛错', async () => {
      fetchMock.mockResolvedValueOnce(res(403));
      await expect(provider.listBackups(cfg)).rejects.toThrow();
    });
  });

  describe('downloadBackup', () => {
    it('不传 versionId → GET latest URL', async () => {
      fetchMock.mockResolvedValueOnce(res(200, '{"v":1}'));
      await provider.downloadBackup(cfg);
      const req = reqAt(fetchMock, 0);
      expect(req.method).toBe('GET');
      expect(req.url).toBe(LATEST_URL);
      expect(decodeAuth(req)).toBe(`${cfg.username}:${cfg.password}`);
    });

    it('传合法 versionId → GET snapshot 完整 URL', async () => {
      fetchMock.mockResolvedValueOnce(res(200, 'data'));
      await provider.downloadBackup(cfg, `octane-backup-${DEV8}-1784622432000-aaaaaaaa`);
      expect(reqAt(fetchMock, 0).url).toBe(
        `${BASE_URL}octane/octane-backup-${DEV8}-1784622432000-aaaaaaaa.json`,
      );
    });

    it('非法 versionId（含 /）→ 抛错，不发请求', async () => {
      await expect(provider.downloadBackup(cfg, '../etc')).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('latest 404 → 抛 EmptyBackupListError', async () => {
      fetchMock.mockResolvedValueOnce(res(404));
      await expect(provider.downloadBackup(cfg)).rejects.toThrow(/云端无备份/);
    });

    it('snapshot 404 → 抛错（陈旧）', async () => {
      fetchMock.mockResolvedValueOnce(res(404));
      await expect(
        provider.downloadBackup(cfg, `octane-backup-${DEV8}-1784622432000-aaaaaaaa`),
      ).rejects.toThrow(/陈旧|刷新/);
    });
  });

  describe('deleteBackup', () => {
    it('DELETE snapshot 完整 URL', async () => {
      fetchMock.mockResolvedValueOnce(res(204));
      await provider.deleteBackup(cfg, `octane-backup-${DEV8}-1784622432000-aaaaaaaa`);
      const req = reqAt(fetchMock, 0);
      expect(req.method).toBe('DELETE');
      expect(req.url).toBe(
        `${BASE_URL}octane/octane-backup-${DEV8}-1784622432000-aaaaaaaa.json`,
      );
    });

    it('latest id（0 段）→ 抛错，不发请求（防删 latest）', async () => {
      await expect(provider.deleteBackup(cfg, 'octane-backup')).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('非法 versionId（含 ..）→ 抛错，不发请求', async () => {
      await expect(provider.deleteBackup(cfg, '../etc/passwd')).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('非 2xx → 抛错', async () => {
      fetchMock.mockResolvedValueOnce(res(403));
      await expect(
        provider.deleteBackup(cfg, `octane-backup-${DEV8}-1784622432000-aaaaaaaa`),
      ).rejects.toThrow();
    });
  });

  describe('getRequired 校验', () => {
    it('缺 username → 抛错', async () => {
      await expect(
        provider.testConnection({ ...cfg, username: undefined }),
      ).rejects.toThrow(/username/);
    });

    it('缺 password → 抛错', async () => {
      await expect(
        provider.testConnection({ ...cfg, password: undefined }),
      ).rejects.toThrow(/password/);
    });
  });
});
