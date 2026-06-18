import OSS from 'ali-oss';
import type { CloudStorageConfig, CloudStorageProvider, ConfigFieldDef } from '../types';
import { BACKUP_OBJECT_KEY } from '../constants';

/** 阿里云 OSS 策略实现：签名与直传交给 ali-oss（浏览器构建）。 */
export class OssProvider implements CloudStorageProvider {
  readonly id = 'oss' as const;
  readonly label = '阿里云 OSS';
  readonly configFields: readonly ConfigFieldDef[] = [
    { name: 'region', label: 'Region', type: 'text', required: true, placeholder: 'oss-cn-hangzhou' },
    { name: 'bucket', label: 'Bucket', type: 'text', required: true },
    { name: 'accessKeyId', label: 'AccessKeyId', type: 'text', required: true },
    { name: 'accessKeySecret', label: 'AccessKeySecret', type: 'password', required: true },
    { name: 'endpoint', label: '自定义 Endpoint（可选）', type: 'text', required: false },
  ];

  private buildClient(cfg: CloudStorageConfig) {
    return new OSS({
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      bucket: cfg.bucket,
      endpoint: cfg.endpoint || undefined,
      secure: true, // 强制 HTTPS
    });
  }

  async testConnection(cfg: CloudStorageConfig): Promise<void> {
    await this.buildClient(cfg).getBucketInfo(cfg.bucket);
  }

  async uploadBackup(cfg: CloudStorageConfig, blob: Blob): Promise<void> {
    await this.buildClient(cfg).put(BACKUP_OBJECT_KEY, blob);
  }

  async downloadBackup(cfg: CloudStorageConfig): Promise<Blob> {
    const r = await this.buildClient(cfg).get(BACKUP_OBJECT_KEY);
    // ali-oss 浏览器构建中 get().content 为 Buffer/ArrayBuffer，可直接构造 Blob。
    return new Blob([r.content as BlobPart]);
  }
}
