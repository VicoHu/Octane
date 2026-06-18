import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BACKUP_OBJECT_KEY } from '../constants';
import { CosProvider } from '../providers/CosProvider';

const mocks = vi.hoisted(() => ({
  putObject: vi.fn(),
  getObject: vi.fn(),
  headBucket: vi.fn(),
  ctorOpts: vi.fn(),
}));
vi.mock('cos-js-sdk-v5', () => ({
  default: class COS {
    constructor(opts: unknown) {
      mocks.ctorOpts(opts);
    }
    putObject = mocks.putObject;
    getObject = mocks.getObject;
    headBucket = mocks.headBucket;
  },
}));

const cfg = {
  region: 'ap-guangzhou',
  bucket: 'octane-test-1234567890',
  accessKeyId: 'AKIDxxx',
  accessKeySecret: 'SKyyy',
};

beforeEach(() => {
  mocks.putObject.mockReset();
  mocks.getObject.mockReset();
  mocks.headBucket.mockReset();
  mocks.ctorOpts.mockReset();
});

describe('CosProvider', () => {
  const provider = new CosProvider();

  it('元信息：id=cos，label=腾讯云 COS，SK 字段 label=SecretKey 且 password', () => {
    expect(provider.id).toBe('cos');
    expect(provider.label).toBe('腾讯云 COS');
    expect(provider.configFields.find((f) => f.name === 'accessKeyId')?.label).toBe('SecretId');
    expect(provider.configFields.find((f) => f.name === 'accessKeySecret')?.label).toBe('SecretKey');
  });

  it('testConnection → headBucket({Bucket, Region})', async () => {
    mocks.headBucket.mockResolvedValue({});
    await provider.testConnection(cfg);
    expect(mocks.headBucket).toHaveBeenCalledWith({ Bucket: cfg.bucket, Region: cfg.region });
  });

  it('testConnection 失败 → 透传抛错', async () => {
    mocks.headBucket.mockRejectedValue(new Error('CORS blocked'));
    await expect(provider.testConnection(cfg)).rejects.toThrow('CORS blocked');
  });

  it('uploadBackup → putObject({Bucket, Region, Key, Body})', async () => {
    mocks.putObject.mockResolvedValue({});
    const blob = new Blob(['x']);
    await provider.uploadBackup(cfg, blob);
    expect(mocks.putObject).toHaveBeenCalledWith({
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: BACKUP_OBJECT_KEY,
      Body: blob,
    });
    // COS 构造用 SecretId/SecretKey（映射自 accessKeyId/accessKeySecret）
    expect(mocks.ctorOpts).toHaveBeenCalledWith(expect.objectContaining({ SecretId: cfg.accessKeyId, SecretKey: cfg.accessKeySecret }));
  });

  it('downloadBackup → getObject({Bucket, Region, Key}) → 返回 Body Blob', async () => {
    const blob = new Blob(['data']);
    mocks.getObject.mockResolvedValue({ Body: blob });
    expect(await provider.downloadBackup(cfg)).toBe(blob);
    expect(mocks.getObject).toHaveBeenCalledWith({ Bucket: cfg.bucket, Region: cfg.region, Key: BACKUP_OBJECT_KEY });
  });
});
