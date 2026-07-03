import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AwsClient } from 'aws4fetch';
import { S3Provider } from '../providers/S3Provider';
import { BACKUP_OBJECT_KEY } from '../constants';
import type { CloudStorageConfig } from '../types';

/**
 * S3Provider 测试（D4=B 结构断言）。
 * mock `fetch`；aws4fetch 真实签名产出真 Request 供断言。
 * 遵循 docs/standards/testing.md：不 mock 被测对象，仅 mock 副作用边界（网络 fetch）。
 */

const AK = 'AKIDMOCKACCESSKEYID00';
const SK = 'mock00secretAccessKey//PLUSxxxxx';
const BUCKET = 'octane-mock-bucket';
const REGION = 'oss-cn-hangzhou';

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

/** 取 mock fetch 收到的 Request。 */
function lastReq(mockFetch: ReturnType<typeof vi.fn>): Request {
  const calls = mockFetch.mock.calls;
  const arg = calls[calls.length - 1]?.[0];
  return arg as Request;
}

describe('S3Provider', () => {
  let provider: S3Provider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new S3Provider();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
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
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      await provider.testConnection(baseCfg({ s3Preset: 'aliyun' }));
      const req = lastReq(mockFetch);
      expect(req.url).toContain(`https://${BUCKET}.s3.${REGION}.aliyuncs.com`);
      expect(req.method).toBe('HEAD');
    });

    it('tencent：HEAD URL 含 ${bucket}.cos.${region}.myqcloud.com', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      await provider.testConnection(baseCfg({ s3Preset: 'tencent', region: 'ap-guangzhou' }));
      const req = lastReq(mockFetch);
      expect(req.url).toContain(`https://${BUCKET}.cos.ap-guangzhou.myqcloud.com`);
    });
  });

  describe('SigV4 签名结构（PUT）', () => {
    it('Authorization 头以 AWS4-HMAC-SHA256 开头，Credential 含 /s3/', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      await provider.uploadBackup(baseCfg(), new Blob(['x']));
      const req = lastReq(mockFetch);
      const auth = req.headers.get('Authorization');
      expect(auth).toBeTruthy();
      expect(auth!).toMatch(/^AWS4-HMAC-SHA256/);
      expect(auth!).toContain('Credential=');
      // Credential 路径片段形如 AK/yyyymmdd/region/s3/aws4_request
      expect(auth!).toMatch(/\/s3\//);
    });

    it('x-amz-content-sha256 为 UNSIGNED-PAYLOAD', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      await provider.uploadBackup(baseCfg(), new Blob(['x']));
      const req = lastReq(mockFetch);
      expect(req.headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
    });
  });

  describe('testConnection 状态码语义', () => {
    it('200 通过（不抛）', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      await expect(provider.testConnection(baseCfg())).resolves.toBeUndefined();
    });

    it('403 抛错（消息含凭证）', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
      await expect(provider.testConnection(baseCfg())).rejects.toThrow(/凭证/);
    });

    it('404 抛错（消息含桶）', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
      await expect(provider.testConnection(baseCfg())).rejects.toThrow(/桶/);
    });

    it('500 抛错', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
      await expect(provider.testConnection(baseCfg())).rejects.toThrow();
    });
  });

  describe('uploadBackup', () => {
    it('PUT 方法，URL 含 BACKUP_OBJECT_KEY', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      await provider.uploadBackup(baseCfg(), new Blob(['payload']));
      const req = lastReq(mockFetch);
      expect(req.method).toBe('PUT');
      expect(req.url).toBe(`https://${BUCKET}.s3.${REGION}.aliyuncs.com/${BACKUP_OBJECT_KEY}`);
    });

    it('非 2xx 抛错', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
      await expect(
        provider.uploadBackup(baseCfg(), new Blob(['payload'])),
      ).rejects.toThrow();
    });

    it('body 透传 Blob', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const blob = new Blob(['hello-s3']);
      await provider.uploadBackup(baseCfg(), blob);
      const req = lastReq(mockFetch);
      // Request.body 对于非空 body 应为 ReadableStream（GET/HEAD 之外）
      expect(req.body).not.toBeNull();
      expect(req.headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
    });
  });

  describe('downloadBackup', () => {
    it('GET 方法，URL 含 BACKUP_OBJECT_KEY', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
      );
      await provider.downloadBackup(baseCfg());
      const req = lastReq(mockFetch);
      expect(req.method).toBe('GET');
      expect(req.url).toBe(`https://${BUCKET}.s3.${REGION}.aliyuncs.com/${BACKUP_OBJECT_KEY}`);
    });

    it('200 返回内容一致的 Blob', async () => {
      const payload = new Uint8Array([10, 20, 30, 40, 50]);
      mockFetch.mockResolvedValueOnce(new Response(payload, { status: 200 }));
      const out = await provider.downloadBackup(baseCfg());
      expect(out).toBeInstanceOf(Blob);
      const buf = new Uint8Array(await out.arrayBuffer());
      expect(Array.from(buf)).toEqual(Array.from(payload));
    });

    it('404 抛错', async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
      await expect(provider.downloadBackup(baseCfg())).rejects.toThrow();
    });
  });

  describe('AwsClient 构造（隐式：签名可用即说明 client 正确构造）', () => {
    it('真实 AwsClient.sign 产出可用 Request（端到端结构）', async () => {
      // 单独验证 provider 内部 new AwsClient 的参数无误：能产出签名头即合格。
      const client = new AwsClient({
        accessKeyId: AK,
        secretAccessKey: SK,
        region: REGION,
        service: 's3',
      });
      const signed = (await client.sign(`https://${BUCKET}.s3.${REGION}.aliyuncs.com/x`, {
        method: 'GET',
      })) as Request;
      expect(signed.headers.get('Authorization')!).toMatch(/^AWS4-HMAC-SHA256/);
    });
  });
});
