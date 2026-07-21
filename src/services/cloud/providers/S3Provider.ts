import { AwsClient } from 'aws4fetch';
import type { BackupVersion, CloudStorageConfig, CloudStorageProvider, ConfigFieldDef } from '../types';
import { EmptyBackupListError } from '../types';
import { S3_PRESETS } from '../presets';
import { BACKUP_OBJECT_KEY, BACKUP_PREFIX, BACKUP_VERSION_PREFIX } from '../constants';
import {
  getRequired,
  getDeviceId,
  parseExportedAt,
  rand8,
  encodePrefix,
  computeId,
  assertValidVersionId,
  parseSnapshotMeta,
} from '../utils';

/**
 * S3 兼容存储策略实现：基于 aws4fetch 的 SigV4 签名 + 原生 fetch。
 * preset→endpoint 推导（vhost 风格 `{bucket}.{host}`）；service='s3'，PUT 走 UNSIGNED-PAYLOAD。
 *
 * 双层版本快照：PUT latest（固定 key 覆盖）+ PUT snapshot（create-only If-None-Match:*）。
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
    // 1. HEAD bucket：凭证 + 桶存在性
    const headRes = await fetch(await client.sign(vhostBase, { method: 'HEAD' }));
    if (headRes.status === 403) throw new Error('S3 凭证或权限不足（403）');
    if (headRes.status === 404) throw new Error('S3 桶不存在（404）');
    if (!headRes.ok) throw new Error(`S3 testConnection 失败：HTTP ${headRes.status}`);
    // 2. LIST prefix 试 ListBucket 权限（早发现权限/CORS 缺失）
    const listUrl = `${vhostBase}/?list-type=2&prefix=${encodePrefix(BACKUP_PREFIX)}&max-keys=1000`;
    const listRes = await fetch(await client.sign(listUrl, { method: 'GET' }));
    if (!listRes.ok) {
      throw new Error(`S3 ListBucket 权限不足或 CORS（HTTP ${listRes.status}）`);
    }
  }

  async uploadBackup(
    cfg: CloudStorageConfig,
    blob: Blob,
  ): Promise<{ latest: BackupVersion; snapshot: BackupVersion }> {
    const { client, vhostBase } = this.buildContext(cfg);
    const dev8 = (await getDeviceId()).slice(0, 8);
    const exportedAt = await parseExportedAt(blob);

    // 1. PUT latest（固定 key 覆盖；retention 永不删，故始终最新）
    const latestRes = await fetch(
      await client.sign(`${vhostBase}/${BACKUP_OBJECT_KEY}`, {
        method: 'PUT',
        headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
        body: blob,
      }),
    );
    if (!latestRes.ok) {
      throw new Error(`S3 uploadBackup(latest) 失败：HTTP ${latestRes.status}`);
    }

    // 2. PUT snapshot（create-only If-None-Match:*；412=碰撞→重生成 rand8 重试，累计≤3 次）
    let snapshotKey = '';
    for (let attempt = 0; ; attempt++) {
      const key = `${BACKUP_PREFIX}${BACKUP_VERSION_PREFIX}${dev8}-${exportedAt}-${rand8()}.json`;
      const res = await fetch(
        await client.sign(`${vhostBase}/${key}`, {
          method: 'PUT',
          headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'If-None-Match': '*' },
          body: blob,
        }),
      );
      if (res.ok) {
        snapshotKey = key;
        break;
      }
      if (res.status !== 412) {
        throw new Error(`S3 uploadBackup(snapshot) 失败：HTTP ${res.status}`);
      }
      if (attempt >= 2) {
        throw new Error('S3 uploadBackup(snapshot) 连续 3 次 412 碰撞失败');
      }
    }

    return {
      latest: {
        id: 'octane-backup',
        key: BACKUP_OBJECT_KEY,
        device: dev8,
        timestamp: exportedAt,
        size: blob.size,
      },
      snapshot: {
        id: computeId(snapshotKey),
        key: snapshotKey,
        device: dev8,
        timestamp: exportedAt,
        size: blob.size,
      },
    };
  }

  async listBackups(cfg: CloudStorageConfig): Promise<BackupVersion[]> {
    const { client, vhostBase } = this.buildContext(cfg);
    const url = `${vhostBase}/?list-type=2&prefix=${encodePrefix(BACKUP_PREFIX)}&max-keys=1000`;
    const res = await fetch(await client.sign(url, { method: 'GET' }));
    if (!res.ok) throw new Error(`S3 listBackups 失败：HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
    // 分页检测：N 有界 ≤MAX_SNAPSHOTS_GLOBAL，V1 不分页处理，truncate 仅 warn
    if (doc.getElementsByTagName('IsTruncated')[0]?.textContent === 'true') {
      console.warn('[octane] S3 listBackups 结果被截断（V1 不分页处理）');
    }
    const out: BackupVersion[] = [];
    const contents = doc.getElementsByTagName('Contents');
    for (let i = 0; i < contents.length; i++) {
      const c = contents[i];
      if (!c) continue;
      const key = c.getElementsByTagName('Key')[0]?.textContent ?? '';
      const id = computeId(key);
      const meta = parseSnapshotMeta(id);
      if (!meta) continue; // 非精确 snapshot（latest/无关）忽略
      const size = parseInt(c.getElementsByTagName('Size')[0]?.textContent ?? '0', 10);
      out.push({ id, key, device: meta.device, timestamp: meta.timestamp, size });
    }
    out.sort((a, b) => b.timestamp - a.timestamp);
    return out;
  }

  async downloadBackup(cfg: CloudStorageConfig, versionId?: string): Promise<Blob> {
    const { client, vhostBase } = this.buildContext(cfg);
    let key: string;
    if (versionId === undefined) {
      key = BACKUP_OBJECT_KEY; // GET latest（1 RTT）
    } else {
      assertValidVersionId(versionId);
      key = `${BACKUP_PREFIX}${versionId}.json`;
    }
    const res = await fetch(await client.sign(`${vhostBase}/${key}`, { method: 'GET' }));
    if (!res.ok) {
      if (res.status === 404) {
        throw versionId === undefined
          ? new EmptyBackupListError()
          : new Error('S3 版本已被清理（404 陈旧），请刷新版本列表');
      }
      throw new Error(`S3 downloadBackup 失败：HTTP ${res.status}`);
    }
    return res.blob();
  }

  async deleteBackup(cfg: CloudStorageConfig, versionId: string): Promise<void> {
    assertValidVersionId(versionId);
    const { client, vhostBase } = this.buildContext(cfg);
    const key = `${BACKUP_PREFIX}${versionId}.json`;
    const res = await fetch(await client.sign(`${vhostBase}/${key}`, { method: 'DELETE' }));
    if (!res.ok) throw new Error(`S3 deleteBackup 失败：HTTP ${res.status}`);
  }
}
