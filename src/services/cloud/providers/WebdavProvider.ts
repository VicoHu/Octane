import type { CloudStorageConfig, CloudStorageProvider, ConfigFieldDef } from '../types';
import { WEBDAV_PRESETS } from '../presets';
import { getRequired } from '../utils';

/** 坚果云 WebDAV 备份目录名（固定）。 */
const WEBDAV_BACKUP_DIR = 'octane';
/** 备份文件名（固定 key）。 */
const BACKUP_FILENAME = 'octane-backup.json';

/**
 * WebDAV 策略实现：原生 fetch + Basic Auth。preset 枚举锁目前仅坚果云。
 * baseUrl 来自 preset（已 HTTPS），路径 = `${baseUrl}${WEBDAV_BACKUP_DIR}/${BACKUP_FILENAME}`。
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

  /** 构造带 Basic Auth 的 Request。 */
  private buildRequest(
    cfg: CloudStorageConfig,
    method: string,
    url: string,
    body?: BodyInit,
  ): Request {
    const { username, password } = getRequired(cfg, ['username', 'password']);
    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${username}:${password}`)}`,
    };
    return new Request(url, { method, headers, body });
  }

  async testConnection(cfg: CloudStorageConfig): Promise<void> {
    const baseUrl = this.getBaseUrl(cfg);
    const req = this.buildRequest(cfg, 'PROPFIND', baseUrl);
    // PROPFIND 需带 Depth 头；Headers 不可直接展开，需经 entries() 转普通对象。
    const baseHeaders = Object.fromEntries(req.headers.entries());
    const merged = new Request(req, { headers: { ...baseHeaders, Depth: '0' } });
    const res = await fetch(merged);
    if (!res.ok) {
      throw new Error(`WebDAV 连接失败：${res.status}`);
    }
  }

  async uploadBackup(cfg: CloudStorageConfig, blob: Blob): Promise<void> {
    const baseUrl = this.getBaseUrl(cfg);

    // 1. 幂等建目录：200/201/405/409 视为已存在继续。
    const mkcolReq = this.buildRequest(cfg, 'MKCOL', `${baseUrl}${WEBDAV_BACKUP_DIR}`);
    const mkcolRes = await fetch(mkcolReq);
    if (![200, 201, 405, 409].includes(mkcolRes.status)) {
      throw new Error(`WebDAV 建目录失败：${mkcolRes.status}`);
    }

    // 2. PUT 备份文件。
    const putReq = this.buildRequest(
      cfg,
      'PUT',
      `${baseUrl}${WEBDAV_BACKUP_DIR}/${BACKUP_FILENAME}`,
      blob,
    );
    const putRes = await fetch(putReq);
    if (!putRes.ok) {
      throw new Error(`WebDAV 上传失败：${putRes.status}`);
    }
  }

  async downloadBackup(cfg: CloudStorageConfig): Promise<Blob> {
    const baseUrl = this.getBaseUrl(cfg);
    const req = this.buildRequest(
      cfg,
      'GET',
      `${baseUrl}${WEBDAV_BACKUP_DIR}/${BACKUP_FILENAME}`,
    );
    const res = await fetch(req);
    if (!res.ok) {
      throw new Error(`WebDAV 下载失败：${res.status}`);
    }
    const buf = await new Response(res.body).arrayBuffer();
    return new Blob([buf]);
  }
}
