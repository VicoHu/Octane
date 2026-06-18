import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BACKUP_OBJECT_KEY } from '../constants';
import { OssProvider } from '../providers/OssProvider';

// ali-oss 默认导出是构造函数；用 class mock：构造时记录 opts，实例方法为共享 spy。
const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
  getBucketInfo: vi.fn(),
  ctorOpts: vi.fn(),
}));
vi.mock('ali-oss', () => ({
  default: class OSS {
    constructor(opts: unknown) {
      mocks.ctorOpts(opts);
    }
    put = mocks.put;
    get = mocks.get;
    getBucketInfo = mocks.getBucketInfo;
  },
}));

const cfg = {
  region: 'oss-cn-hangzhou',
  bucket: 'octane-test',
  accessKeyId: 'AKIDxxx',
  accessKeySecret: 'SKyyy',
};

beforeEach(() => {
  mocks.put.mockReset();
  mocks.get.mockReset();
  mocks.getBucketInfo.mockReset();
  mocks.ctorOpts.mockReset();
});

describe('OssProvider', () => {
  const provider = new OssProvider();

  it('元信息：id=oss，label=阿里云 OSS，configFields 含 5 项且 SK 为 password', () => {
    expect(provider.id).toBe('oss');
    expect(provider.label).toBe('阿里云 OSS');
    const names = provider.configFields.map((f) => f.name);
    expect(names).toEqual(['region', 'bucket', 'accessKeyId', 'accessKeySecret', 'endpoint']);
    const sk = provider.configFields.find((f) => f.name === 'accessKeySecret');
    expect(sk?.type).toBe('password');
    expect(sk?.required).toBe(true);
  });

  it('testConnection → 调 getBucketInfo', async () => {
    mocks.getBucketInfo.mockResolvedValue({});
    await provider.testConnection(cfg);
    expect(mocks.getBucketInfo).toHaveBeenCalled();
  });

  it('testConnection 失败 → 透传抛错（如 CORS/认证）', async () => {
    mocks.getBucketInfo.mockRejectedValue(new Error('CORS blocked'));
    await expect(provider.testConnection(cfg)).rejects.toThrow('CORS blocked');
  });

  it('uploadBackup → put(固定 key, blob)，客户端 secure:true', async () => {
    mocks.put.mockResolvedValue({});
    const blob = new Blob(['x']);
    await provider.uploadBackup(cfg, blob);
    expect(mocks.put).toHaveBeenCalledWith(BACKUP_OBJECT_KEY, blob);
    expect(mocks.ctorOpts).toHaveBeenCalledWith(expect.objectContaining({ secure: true, bucket: cfg.bucket }));
  });

  it('uploadBackup 带自定义 endpoint → 客户端传 endpoint', async () => {
    mocks.put.mockResolvedValue({});
    await provider.uploadBackup({ ...cfg, endpoint: 'https://e.example.com' }, new Blob(['x']));
    expect(mocks.ctorOpts).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://e.example.com' }));
  });

  it('downloadBackup → get(固定 key) → 返回 Blob', async () => {
    mocks.get.mockResolvedValue({ content: new Uint8Array([1, 2, 3]) });
    const blob = await provider.downloadBackup(cfg);
    expect(mocks.get).toHaveBeenCalledWith(BACKUP_OBJECT_KEY);
    expect(blob).toBeInstanceOf(Blob);
  });
});
