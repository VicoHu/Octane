import { AwsClient } from 'aws4fetch';
import type { CloudStorageConfig, CloudStorageProvider, ConfigFieldDef } from '../types';
import { S3_PRESETS } from '../presets';
import { BACKUP_OBJECT_KEY } from '../constants';
import { getRequired } from '../utils';

/**
 * S3 兼容存储策略实现：基于 aws4fetch 的 SigV4 签名 + 原生 fetch。
 * preset→endpoint 推导（vhost 风格 `{bucket}.{host}`）；service='s3'，PUT 走 UNSIGNED-PAYLOAD。
 * 设计文档 §3。Wave 3 起替换 OssProvider / CosProvider。
 */
export class S3Provider implements CloudStorageProvider {
  readonly id = 's3' as const;
  readonly label = 'S3 兼容存储';
  readonly configFields: readonly ConfigFieldDef[] = [
    {
      name: 's3Preset',
      label: '服务商',
      type: 'select',
      options: ['aliyun', 'tencent'],
      required: true,
    },
    { name: 'region', label: 'Region', type: 'text', required: true, placeholder: 'oss-cn-hangzhou' },
    { name: 'bucket', label: 'Bucket', type: 'text', required: true },
    { name: 'accessKeyId', label: 'AccessKeyId', type: 'text', required: true },
    { name: 'accessKeySecret', label: 'AccessKeySecret', type: 'password', required: true },
  ];

  /** 由配置构造签名客户端与 vhost base URL。 */
  private buildContext(cfg: CloudStorageConfig): {
    client: AwsClient;
    vhostBase: string;
  } {
    const preset = cfg.s3Preset;
    if (!preset) {
      throw new Error('S3 配置缺失 preset');
    }
    const def = S3_PRESETS[preset];
    const { region, bucket, accessKeyId, accessKeySecret } = getRequired(cfg, [
      'region',
      'bucket',
      'accessKeyId',
      'accessKeySecret',
    ]);
    const host = def.endpoint(region);
    const vhostBase = `https://${bucket}.${host}`;
    const client = new AwsClient({
      accessKeyId,
      secretAccessKey: accessKeySecret,
      region,
      service: 's3',
    });
    return { client, vhostBase };
  }

  async testConnection(cfg: CloudStorageConfig): Promise<void> {
    const { client, vhostBase } = this.buildContext(cfg);
    const signed = await client.sign(vhostBase, { method: 'HEAD' });
    const res = await fetch(signed);
    if (res.ok) return;
    if (res.status === 403) throw new Error('S3 凭证或权限不足（403）');
    if (res.status === 404) throw new Error('S3 桶不存在（404）');
    throw new Error(`S3 testConnection 失败：HTTP ${res.status}`);
  }

  async uploadBackup(cfg: CloudStorageConfig, blob: Blob): Promise<void> {
    const { client, vhostBase } = this.buildContext(cfg);
    const signed = await client.sign(`${vhostBase}/${BACKUP_OBJECT_KEY}`, {
      method: 'PUT',
      headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
      body: blob,
    });
    const res = await fetch(signed);
    if (!res.ok) throw new Error(`S3 uploadBackup 失败：HTTP ${res.status}`);
  }

  async downloadBackup(cfg: CloudStorageConfig): Promise<Blob> {
    const { client, vhostBase } = this.buildContext(cfg);
    const signed = await client.sign(`${vhostBase}/${BACKUP_OBJECT_KEY}`, { method: 'GET' });
    const res = await fetch(signed);
    if (!res.ok) throw new Error(`S3 downloadBackup 失败：HTTP ${res.status}`);
    return res.blob();
  }
}
