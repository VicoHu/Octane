import COS from 'cos-js-sdk-v5';
import type { CloudStorageConfig, CloudStorageProvider, ConfigFieldDef } from '../types';
import { BACKUP_OBJECT_KEY } from '../constants';

/** 腾讯云 COS 策略实现：签名直传交给 cos-js-sdk-v5（浏览器构建）。 */
export class CosProvider implements CloudStorageProvider {
  readonly id = 'cos' as const;
  readonly label = '腾讯云 COS';
  readonly configFields: readonly ConfigFieldDef[] = [
    { name: 'region', label: 'Region', type: 'text', required: true, placeholder: 'ap-guangzhou' },
    { name: 'bucket', label: 'Bucket', type: 'text', required: true, placeholder: '名称-APPID' },
    { name: 'accessKeyId', label: 'SecretId', type: 'text', required: true },
    { name: 'accessKeySecret', label: 'SecretKey', type: 'password', required: true },
  ];

  private buildClient(cfg: CloudStorageConfig) {
    return new COS({
      SecretId: cfg.accessKeyId,
      SecretKey: cfg.accessKeySecret,
    });
  }

  async testConnection(cfg: CloudStorageConfig): Promise<void> {
    await this.buildClient(cfg).headBucket({ Bucket: cfg.bucket, Region: cfg.region });
  }

  async uploadBackup(cfg: CloudStorageConfig, blob: Blob): Promise<void> {
    await this.buildClient(cfg).putObject({
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: BACKUP_OBJECT_KEY,
      Body: blob,
    });
  }

  async downloadBackup(cfg: CloudStorageConfig): Promise<Blob> {
    const data = await this.buildClient(cfg).getObject({
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: BACKUP_OBJECT_KEY,
    });
    return data.Body as Blob;
  }
}
