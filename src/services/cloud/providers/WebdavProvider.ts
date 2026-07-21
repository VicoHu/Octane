import type {
  BackupVersion,
  CloudStorageConfig,
  CloudStorageProvider,
  ConfigFieldDef,
} from '../types';
import { EmptyBackupListError } from '../types';
import { WEBDAV_PRESETS } from '../presets';
import { BACKUP_VERSION_PREFIX } from '../constants';
import {
  getRequired,
  getDeviceId,
  parseExportedAt,
  rand8,
  computeId,
  assertValidVersionId,
  parseSnapshotMeta,
} from '../utils';

/** 坚果云 WebDAV 备份目录名（固定）。 */
const WEBDAV_BACKUP_DIR = 'octane';
/** latest 备份文件名（固定 key）。 */
const BACKUP_FILENAME = 'octane-backup.json';
/** PROPFIND 列目录请求体（极简模板，不依赖空 body=allprop 的实现差异）。 */
const PROPFIND_BODY =
  '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><getcontentlength/></prop></propfind>';

/**
 * WebDAV 策略实现：原生 fetch + Basic Auth。preset 枚举锁目前仅坚果云。
 * 双层版本快照：MKCOL 幂等建目录 + PUT latest（固定 key 覆盖）+ PUT snapshot（create-only If-None-Match:*）。
 */
export class WebdavProvider implements CloudStorageProvider {
  readonly id = 'webdav' as const;
  readonly label = WEBDAV_PRESETS.jianguoyun.label;
  readonly configFields: readonly ConfigFieldDef[] = [
    {
      name: 'webdavPreset',
      label: '服务商',
      type: 'select',
      options: ['jianguoyun'],
      required: true,
    },
    { name: 'username', label: '账号', type: 'text', required: true },
    { name: 'password', label: '应用密码', type: 'password', required: true },
  ];

  /** 取 baseUrl（preset 已枚举锁，目前仅 jianguoyun）。 */
  private getBaseUrl(cfg: CloudStorageConfig): string {
    const preset = cfg.webdavPreset ?? 'jianguoyun';
    return WEBDAV_PRESETS[preset].baseUrl;
  }

  /** 构造带 Basic Auth 的 Request（可选额外 header，如 snapshot 的 If-None-Match）。 */
  private buildRequest(
    cfg: CloudStorageConfig,
    method: string,
    url: string,
    body?: BodyInit,
    extraHeaders?: Record<string, string>,
  ): Request {
    const { username, password } = getRequired(cfg, ['username', 'password']);
    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${username}:${password}`)}`,
      ...extraHeaders,
    };
    return new Request(url, { method, headers, body });
  }

  async testConnection(cfg: CloudStorageConfig): Promise<void> {
    const baseUrl = this.getBaseUrl(cfg);
    const req = this.buildRequest(cfg, 'PROPFIND', baseUrl);
    // PROPFIND 需带 Depth 头；Headers 不可直接展开，需经 entries() 转普通对象。
    const baseHeaders = Object.fromEntries(req.headers.entries());
    const merged = new Request(req, { headers: { ...baseHeaders, Depth: '1' } });
    const res = await fetch(merged);
    if (!res.ok) {
      throw new Error(`WebDAV 连接失败：${res.status}`);
    }
  }

  async uploadBackup(
    cfg: CloudStorageConfig,
    blob: Blob,
  ): Promise<{ latest: BackupVersion; snapshot: BackupVersion }> {
    const baseUrl = this.getBaseUrl(cfg);
    const dev8 = (await getDeviceId()).slice(0, 8);
    const exportedAt = await parseExportedAt(blob);

    // 1. 幂等建目录：200/201/405/409 视为已存在继续（409=父路径冲突，非"已存在"——复查继续）
    const mkcolRes = await fetch(this.buildRequest(cfg, 'MKCOL', `${baseUrl}${WEBDAV_BACKUP_DIR}`));
    if (![200, 201, 405, 409].includes(mkcolRes.status)) {
      throw new Error(`WebDAV 建目录失败：${mkcolRes.status}`);
    }

    // 2. PUT latest（固定 key 覆盖；retention 永不删，故始终最新）
    const latestUrl = `${baseUrl}${WEBDAV_BACKUP_DIR}/${BACKUP_FILENAME}`;
    const latestRes = await fetch(this.buildRequest(cfg, 'PUT', latestUrl, blob));
    if (!latestRes.ok) {
      throw new Error(`WebDAV 上传 latest 失败：${latestRes.status}`);
    }

    // 3. PUT snapshot（create-only If-None-Match:*；412=碰撞→重生成 rand8 重试，累计≤3 次）
    let snapshotFile = '';
    let snapshotUrl = '';
    for (let attempt = 0; ; attempt++) {
      snapshotFile = `${BACKUP_VERSION_PREFIX}${dev8}-${exportedAt}-${rand8()}.json`;
      snapshotUrl = `${baseUrl}${WEBDAV_BACKUP_DIR}/${snapshotFile}`;
      const snapRes = await fetch(
        this.buildRequest(cfg, 'PUT', snapshotUrl, blob, { 'If-None-Match': '*' }),
      );
      if (snapRes.ok) break;
      if (snapRes.status !== 412) {
        throw new Error(`WebDAV 上传 snapshot 失败：${snapRes.status}`);
      }
      if (attempt >= 2) {
        throw new Error('WebDAV 上传 snapshot 连续 3 次 412 碰撞失败');
      }
    }

    return {
      latest: {
        id: 'octane-backup',
        key: latestUrl,
        device: dev8,
        timestamp: exportedAt,
        size: blob.size,
      },
      snapshot: {
        id: computeId(snapshotFile),
        key: snapshotUrl,
        device: dev8,
        timestamp: exportedAt,
        size: blob.size,
      },
    };
  }

  async listBackups(cfg: CloudStorageConfig): Promise<BackupVersion[]> {
    const baseUrl = this.getBaseUrl(cfg);
    const req = this.buildRequest(cfg, 'PROPFIND', `${baseUrl}${WEBDAV_BACKUP_DIR}/`);
    const baseHeaders = Object.fromEntries(req.headers.entries());
    const merged = new Request(req, {
      headers: { ...baseHeaders, Depth: '1', 'Content-Type': 'application/xml' },
      body: PROPFIND_BODY,
    });
    const res = await fetch(merged);
    if (!res.ok) throw new Error(`WebDAV listBackups 失败：${res.status}`);

    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
    const out: BackupVersion[] = [];
    // 鲁棒解析（codex #12）：通配 namespace 匹配 localName；逐 response 取 href/getcontentlength；
    // 跳过目录自身（非 .json）与非精确 snapshot（latest/无关）。
    const responses = doc.getElementsByTagNameNS('*', 'response');
    for (let i = 0; i < responses.length; i++) {
      const r = responses[i];
      if (!r) continue;
      const href = r.getElementsByTagNameNS('*', 'href')[0]?.textContent ?? '';
      const file = new URL(href, baseUrl).pathname.split('/').pop() ?? '';
      if (!file.endsWith('.json')) continue; // 跳过目录自身/非 json
      const id = computeId(file);
      const meta = parseSnapshotMeta(id);
      if (!meta) continue; // 非精确 snapshot（latest/无关）忽略
      const sizeText = r.getElementsByTagNameNS('*', 'getcontentlength')[0]?.textContent;
      const size = parseInt(sizeText ?? '0', 10);
      const key = `${baseUrl}${WEBDAV_BACKUP_DIR}/${id}.json`; // 由 id 重建完整 URL（O2）
      out.push({ id, key, device: meta.device, timestamp: meta.timestamp, size });
    }
    out.sort((a, b) => b.timestamp - a.timestamp);
    return out;
  }

  async downloadBackup(cfg: CloudStorageConfig, versionId?: string): Promise<Blob> {
    const baseUrl = this.getBaseUrl(cfg);
    let url: string;
    if (versionId === undefined) {
      url = `${baseUrl}${WEBDAV_BACKUP_DIR}/${BACKUP_FILENAME}`; // GET latest（1 RTT）
    } else {
      assertValidVersionId(versionId);
      url = `${baseUrl}${WEBDAV_BACKUP_DIR}/${versionId}.json`;
    }
    const res = await fetch(this.buildRequest(cfg, 'GET', url));
    if (!res.ok) {
      if (res.status === 404) {
        throw versionId === undefined
          ? new EmptyBackupListError()
          : new Error('WebDAV 版本已被清理（404 陈旧），请刷新版本列表');
      }
      throw new Error(`WebDAV 下载失败：${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return new Blob([buf]);
  }

  async deleteBackup(cfg: CloudStorageConfig, versionId: string): Promise<void> {
    assertValidVersionId(versionId);
    const baseUrl = this.getBaseUrl(cfg);
    const url = `${baseUrl}${WEBDAV_BACKUP_DIR}/${versionId}.json`;
    const res = await fetch(this.buildRequest(cfg, 'DELETE', url));
    if (!res.ok) throw new Error(`WebDAV 删除失败：${res.status}`);
  }
}
