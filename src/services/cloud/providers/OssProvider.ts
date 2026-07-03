import OSS from 'ali-oss';
import type { CloudStorageConfig, CloudStorageProvider, ConfigFieldDef } from '../types';
import { BACKUP_OBJECT_KEY } from '../constants';
import { getRequired } from '../utils';

/** 阿里云 OSS 策略实现：签名与直传交给 ali-oss（浏览器构建）。Wave 3 将由 S3Provider(aws4fetch) 替换。 */
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
    const { region, accessKeyId, accessKeySecret, bucket } = getRequired(cfg, [
      'region',
      'accessKeyId',
      'accessKeySecret',
      'bucket',
    ]);
    return new OSS({
      region,
      accessKeyId,
      accessKeySecret,
      bucket,
      endpoint: cfg.endpoint || undefined,
      secure: true, // 强制 HTTPS
    });
  }

  async testConnection(cfg: CloudStorageConfig): Promise<void> {
    const { bucket } = getRequired(cfg, ['bucket']);
    await this.buildClient(cfg).getBucketInfo(bucket);
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
