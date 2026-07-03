import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WEBDAV_PRESETS } from '../presets';
import { WebdavProvider } from '../providers/WebdavProvider';

/**
 * WebdavProvider 单测：mock 全局 fetch（网络边界），真实渲染被测 Provider。
 * 遵循 docs/standards/testing.md：不 mock 被测对象，仅 mock 副作用边界。
 */

const cfg = {
  webdavPreset: 'jianguoyun' as const,
  username: 'me@example.com',
  password: 'app-pwd-123',
};

const BASE_URL = WEBDAV_PRESETS.jianguoyun.baseUrl; // https://dav.jianguoyun.com/dav/
const DIR_URL = `${BASE_URL}octane`;
const FILE_URL = `${BASE_URL}octane/octane-backup.json`;

/** 期待并解码 Authorization 头为 `username:password`。 */
function decodeAuth(req: Request): string {
  const auth = req.headers.get('authorization') ?? '';
  expect(auth.startsWith('Basic ')).toBe(true);
  const encoded = auth.slice('Basic '.length);
  return atob(encoded);
}

/** 构造受控 Response。204/205 等无 body 状态自动传 null。 */
function res(status: number, body: BodyInit | null = ''): Response {
  if ([204, 205, 304].includes(status)) {
    return new Response(null, { status });
  }
  return new Response(body, { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
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
    it('PROPFIND baseUrl + Depth:0 头；2xx 通过', async () => {
      fetchMock.mockResolvedValueOnce(res(207));
      await provider.testConnection(cfg);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const req = fetchMock.mock.calls[0]?.[0] as Request;
      expect(req.method).toBe('PROPFIND');
      expect(req.url).toBe(BASE_URL);
      expect(req.headers.get('depth')).toBe('0');
      expect(decodeAuth(req)).toBe(`${cfg.username}:${cfg.password}`);
    });

    it('非 2xx → 抛错', async () => {
      fetchMock.mockResolvedValueOnce(res(401));
      await expect(provider.testConnection(cfg)).rejects.toThrow();
    });
  });

  describe('uploadBackup', () => {
    it('依次 MKCOL + PUT；PUT 收到 blob body；URL 正确拼接 octane/octane-backup.json', async () => {
      fetchMock
        .mockResolvedValueOnce(res(201)) // MKCOL
        .mockResolvedValueOnce(res(204)); // PUT

      const blob = new Blob(['backup-content'], { type: 'application/json' });
      await provider.uploadBackup(cfg, blob);

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const mkcol = fetchMock.mock.calls[0]?.[0] as Request;
      expect(mkcol.method).toBe('MKCOL');
      expect(mkcol.url).toBe(DIR_URL);
      expect(decodeAuth(mkcol)).toBe(`${cfg.username}:${cfg.password}`);

      const put = fetchMock.mock.calls[1]?.[0] as Request;
      expect(put.method).toBe('PUT');
      expect(put.url).toBe(FILE_URL);
      expect(decodeAuth(put)).toBe(`${cfg.username}:${cfg.password}`);
      // jsdom 中 Blob→Request body 内容读取链路损坏（text/arrayBuffer 均返回 undefined），
      // 仅断言 body 已挂载（非 null）；真实内容验证留给落地步骤 9 的云端 e2e。
      expect(put.body).not.toBeNull();
      expect(put.bodyUsed).toBe(false);
    });

    it('MKCOL 幂等：405 视为目录已存在继续 PUT', async () => {
      fetchMock
        .mockResolvedValueOnce(res(405)) // MKCOL 已存在
        .mockResolvedValueOnce(res(204)); // PUT

      await provider.uploadBackup(cfg, new Blob(['x']));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const put = fetchMock.mock.calls[1]?.[0] as Request;
      expect(put.method).toBe('PUT');
    });

    it('MKCOL 幂等：409 视为目录已存在继续 PUT', async () => {
      fetchMock
        .mockResolvedValueOnce(res(409))
        .mockResolvedValueOnce(res(204));

      await provider.uploadBackup(cfg, new Blob(['x']));
      expect(fetchMock.mock.calls[1]?.[0]).toBeInstanceOf(Request);
    });

    it('MKCOL 其它非幂等状态（如 500）→ 抛错，不发起 PUT', async () => {
      fetchMock.mockResolvedValueOnce(res(500));
      await expect(provider.uploadBackup(cfg, new Blob(['x']))).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('PUT 非 2xx → 抛错', async () => {
      fetchMock
        .mockResolvedValueOnce(res(201))
        .mockResolvedValueOnce(res(502));
      await expect(provider.uploadBackup(cfg, new Blob(['x']))).rejects.toThrow();
    });
  });

  describe('downloadBackup', () => {
    it('GET 正确 URL；返回 Blob 内容与 mock 响应体一致', async () => {
      fetchMock.mockResolvedValueOnce(res(200, '{"v":1}'));

      const blob = await provider.downloadBackup(cfg);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const req = fetchMock.mock.calls[0]?.[0] as Request;
      expect(req.method).toBe('GET');
      expect(req.url).toBe(FILE_URL);
      expect(decodeAuth(req)).toBe(`${cfg.username}:${cfg.password}`);

      const text = await blob.text();
      expect(text).toBe('{"v":1}');
    });

    it('非 2xx → 抛错', async () => {
      fetchMock.mockResolvedValueOnce(res(404));
      await expect(provider.downloadBackup(cfg)).rejects.toThrow();
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
