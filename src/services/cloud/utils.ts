import type { CloudStorageConfig } from './types';
import { DEVICE_ID_KEY } from './constants';

/** CloudStorageConfig 中 string 型字段集合（getRequired 仅适用于这些键）。 */
export type StringConfigKey =
  | 'region'
  | 'bucket'
  | 'accessKeyId'
  | 'accessKeySecret'
  | 'username'
  | 'password';

/**
 * 从配置中提取必填字段，缺任一则抛错（明确报缺失字段名，优于静默传空串）。
 * 仅用于 string 型字段（region/bucket/accessKeyId/accessKeySecret/username/password 等）。
 *
 * 示例：
 *   const { region, bucket } = getRequired(cfg, ['region', 'bucket']);
 */
export function getRequired<K extends StringConfigKey>(
  cfg: CloudStorageConfig,
  keys: readonly K[],
): { [P in K]: string } {
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const v = cfg[k];
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`云存储配置缺失必填字段：${String(k)}`);
    }
    out[k] = v;
  }
  return out as { [P in K]: string };
}

/** chrome.storage.local 访问（getDeviceId/setDeviceId 的副作用边界）。 */
interface ChromeStorageLocal {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (data: Record<string, unknown>) => Promise<void>;
}
function chromeStorageLocal(): ChromeStorageLocal {
  const chrome = (globalThis as Record<string, unknown>).chrome as
    | { storage?: { local?: ChromeStorageLocal } }
    | undefined;
  const local = chrome?.storage?.local;
  if (!local) throw new Error('chrome.storage.local 不可用');
  return local;
}

/**
 * 取设备唯一标识：首次 crypto.randomUUID() 生成并持久化到 chrome.storage.local。
 * 返回完整 UUID；dev8（前 8 位）由调用方 slice 入 snapshot 文件名。
 */
export async function getDeviceId(): Promise<string> {
  const local = chromeStorageLocal();
  const result = await local.get(DEVICE_ID_KEY);
  const existing = result[DEVICE_ID_KEY];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  const id = crypto.randomUUID();
  await local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

/** 写入设备标识（测试/重置用）。 */
export async function setDeviceId(id: string): Promise<void> {
  await chromeStorageLocal().set({ [DEVICE_ID_KEY]: id });
}

/**
 * 从备份 blob 解析数据生成时间戳（exportedAt）。
 * 双层方案用 exportedAt 作 timestamp 真源（不依赖不可靠的 Last-Modified）。
 * upload 流程保证 blob 合法（buildBackupBlob 必写 exportedAt）；非法 blob 抛错。
 */
export async function parseExportedAt(blob: Blob): Promise<number> {
  const text = await blob.text();
  const parsed = JSON.parse(text) as { exportedAt?: unknown };
  if (typeof parsed.exportedAt !== 'number' || !Number.isFinite(parsed.exportedAt)) {
    throw new Error('备份 blob 缺少有效的 exportedAt');
  }
  return parsed.exportedAt;
}

/** 生成 8 位随机 hex（snapshot 文件名防碰撞段；扩展环境 crypto.getRandomValues，无外部依赖）。 */
export function rand8(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * S3 LIST prefix 编码：段内 encodeURIComponent，但保留 / 不编码（S3 实测期望 prefix 内 / 原样）。
 * 例：'octane/backup/' → 'octane/backup/'。
 */
export function encodePrefix(prefix: string): string {
  return prefix
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

/**
 * 从 key（S3 相对路径 / WebDAV 完整 URL）计算 provider-agnostic 的版本 id = 末段文件名去 .json。
 * 例：'octane/backup/octane-backup-x-y-z.json' → 'octane-backup-x-y-z'。
 */
export function computeId(key: string): string {
  const file = key.split('/').pop() ?? '';
  return file.endsWith('.json') ? file.slice(0, -'.json'.length) : file;
}

/**
 * 校验 downloadBackup/deleteBackup 收到的 versionId（防 / 与 .. 路径注入）。
 * 正则要求 octane-backup 后至少一段 -[a-z0-9]+（snapshot id）；
 * latest id 'octane-backup'（0 段）不匹配 → 防误删 latest。
 */
export function assertValidVersionId(versionId: string): void {
  if (!/^octane-backup(-[a-z0-9]+)+$/.test(versionId)) {
    throw new Error(`非法 versionId：${versionId}`);
  }
}

/** snapshot 文件名精确正则：octane-backup-{dev8}-{exportedAt digits}-{rand8}（.json 可选，兼容 id）。 */
export const SNAPSHOT_FILE_RE = /^octane-backup-([a-z0-9]{8})-(\d+)-([a-z0-9]{8})(\.json)?$/;

/**
 * 从 snapshot id/文件名解析 device（dev8）与 timestamp（exportedAt）。
 * listBackups 用它过滤：只纳入严格匹配 snapshot 格式的文件，忽略 latest/无关文件。
 * 非匹配返回 null。
 */
export function parseSnapshotMeta(
  idOrFile: string,
): { device: string; timestamp: number } | null {
  const m = SNAPSHOT_FILE_RE.exec(idOrFile);
  if (!m) return null;
  const device = m[1];
  const ts = m[2];
  if (device === undefined || ts === undefined) return null;
  return { device, timestamp: parseInt(ts, 10) };
}
