import COS from 'cos-js-sdk-v5';
import type { CloudStorageConfig, CloudStorageProvider, ConfigFieldDef } from '../types';
import { BACKUP_OBJECT_KEY } from '../constants';
import { getRequired } from '../utils';

/** 腾讯云 COS 策略实现：签名直传交给 cos-js-sdk-v5（浏览器构建）。Wave 3 将由 S3Provider(aws4fetch) 替换。 */
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
    const { accessKeyId, accessKeySecret } = getRequired(cfg, ['accessKeyId', 'accessKeySecret']);
    return new COS({
      SecretId: accessKeyId,
      SecretKey: accessKeySecret,
    });
  }

  async testConnection(cfg: CloudStorageConfig): Promise<void> {
    const { bucket, region } = getRequired(cfg, ['bucket', 'region']);
    await this.buildClient(cfg).headBucket({ Bucket: bucket, Region: region });
  }

  async uploadBackup(cfg: CloudStorageConfig, blob: Blob): Promise<void> {
    const { bucket, region } = getRequired(cfg, ['bucket', 'region']);
    await this.buildClient(cfg).putObject({
      Bucket: bucket,
      Region: region,
      Key: BACKUP_OBJECT_KEY,
      Body: blob,
    });
  }

  async downloadBackup(cfg: CloudStorageConfig): Promise<Blob> {
    const { bucket, region } = getRequired(cfg, ['bucket', 'region']);
    const data = await this.buildClient(cfg).getObject({
      Bucket: bucket,
      Region: region,
      Key: BACKUP_OBJECT_KEY,
    });
    return data.Body as Blob;
  }
}
