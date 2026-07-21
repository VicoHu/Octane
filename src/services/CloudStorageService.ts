import { encrypt, decrypt } from '@/services/CryptoService';
import { getCloudProvider } from '@/services/cloud/providers';
import type { BackupVersion, CloudStorageConfig, ProviderId } from '@/services/cloud/types';
import { MAX_SNAPSHOTS_PER_DEVICE, MAX_SNAPSHOTS_GLOBAL } from '@/services/cloud/constants';

/** 凭证存储键（按 provider 分键，密文）。 */
const CREDS_KEY = (id: ProviderId): string => `octane.cloudCreds.${id}`;
/** 上次备份时间键（明文时间戳，非敏感）。 */
const LAST_BACKUP_KEY = (id: ProviderId): string => `octane.lastBackupAt.${id}`;

interface StoredCreds {
  encryptedData: string;
  iv: string;
  savedAt: number;
}

function chromeStorageLocal() {
  const chrome = (globalThis as Record<string, unknown>).chrome as
    | { storage?: { local?: Record<string, unknown> } }
    | undefined;
  const local = chrome?.storage?.local as
    | {
        get: (keys: string | string[]) => Promise<Record<string, unknown>>;
        set: (data: Record<string, unknown>) => Promise<void>;
        remove: (keys: string | string[]) => Promise<void>;
      }
    | undefined;
  if (!local) throw new Error('chrome.storage.local 不可用');
  return local;
}

/**
 * retention 纯逻辑：给定 snapshot 列表（已按 timestamp 倒序），算出应删除的版本。
 * per-device 每设备保留最近 MAX_SNAPSHOTS_PER_DEVICE（防跨设备挤占），全局兜底 MAX_SNAPSHOTS_GLOBAL。
 * 永不纳入 latest（listBackups 只列 snapshot）。
 */
export function computeRetention(list: BackupVersion[]): BackupVersion[] {
  const toDelete = new Set<string>();
  // per-device：按设备分组，每组保留前 N（list 倒序 → 组内最新在前），其余标记删除
  const byDevice = new Map<string, BackupVersion[]>();
  for (const v of list) {
    let arr = byDevice.get(v.device);
    if (!arr) {
      arr = [];
      byDevice.set(v.device, arr);
    }
    arr.push(v);
  }
  for (const versions of byDevice.values()) {
    for (let i = MAX_SNAPSHOTS_PER_DEVICE; i < versions.length; i++) {
      const v = versions[i];
      if (v) toDelete.add(v.id);
    }
  }
  // 全局兜底：list 已倒序，超出 MAX_SNAPSHOTS_GLOBAL 的最旧部分标记删除
  for (let i = MAX_SNAPSHOTS_GLOBAL; i < list.length; i++) {
    const v = list[i];
    if (v) toDelete.add(v.id);
  }
  return list.filter((v) => toDelete.has(v.id));
}

/** 保存云配置：要求已解锁，凭证经主密码加密后按 provider 分键落盘。 */
export async function saveCloudConfig(id: ProviderId, config: CloudStorageConfig): Promise<void> {
  const { encryptedData, iv } = await encrypt(JSON.stringify(config));
  const stored: StoredCreds = { encryptedData, iv, savedAt: Date.now() };
  await chromeStorageLocal().set({ [CREDS_KEY(id)]: stored });
}

/** 读取云配置：要求已解锁；未配置返回 null。 */
export async function getCloudConfig(id: ProviderId): Promise<CloudStorageConfig | null> {
  const result = await chromeStorageLocal().get(CREDS_KEY(id));
  const raw = result[CREDS_KEY(id)] as StoredCreds | undefined;
  if (!raw) return null;
  return JSON.parse(await decrypt(raw.encryptedData, raw.iv)) as CloudStorageConfig;
}

/** 清除指定 provider 的云配置（安全卫生）。 */
export async function clearCloudConfig(id: ProviderId): Promise<void> {
  await chromeStorageLocal().remove(CREDS_KEY(id));
}

/** 上次备份时间（明文时间戳）。未备份返回 null。 */
export async function getLastBackupAt(id: ProviderId): Promise<number | null> {
  const result = await chromeStorageLocal().get(LAST_BACKUP_KEY(id));
  const ts = result[LAST_BACKUP_KEY(id)] as number | undefined;
  return ts ?? null;
}

/** 记录上次备份时间。 */
export async function setLastBackupAt(id: ProviderId, ts: number): Promise<void> {
  await chromeStorageLocal().set({ [LAST_BACKUP_KEY(id)]: ts });
}

/** 测试连通性：解密凭证后委托 provider；未配置抛错。 */
export async function testConnection(id: ProviderId): Promise<void> {
  const cfg = await getCloudConfig(id);
  if (!cfg) throw new Error('未配置云存储');
  await getCloudProvider(id).testConnection(cfg);
}

/**
 * 上传备份：委托 provider（latest 覆盖 + snapshot create-only）→ 记录 lastBackupAt(latest.timestamp)
 * → best-effort retention（per-device + 全局兜底，永不删 latest）。retention 失败 console.warn 不阻断。
 */
export async function uploadBackup(
  id: ProviderId,
  blob: Blob,
): Promise<{ latest: BackupVersion; snapshot: BackupVersion }> {
  const cfg = await getCloudConfig(id);
  if (!cfg) throw new Error('未配置云存储');
  const provider = getCloudProvider(id);
  const { latest, snapshot } = await provider.uploadBackup(cfg, blob);
  await setLastBackupAt(id, latest.timestamp);
  try {
    const list = await provider.listBackups(cfg);
    const stale = computeRetention(list);
    for (const v of stale) {
      try {
        await provider.deleteBackup(cfg, v.id);
      } catch (e) {
        console.warn('[octane] retention 删除失败', v.id, e);
      }
    }
  } catch (e) {
    console.warn('[octane] 云备份 retention 清理失败', e);
  }
  return { latest, snapshot };
}

/** 列出云端 snapshot 版本（不含 latest）：解密凭证后委托 provider。 */
export async function listBackups(id: ProviderId): Promise<BackupVersion[]> {
  const cfg = await getCloudConfig(id);
  if (!cfg) throw new Error('未配置云存储');
  return getCloudProvider(id).listBackups(cfg);
}

/**
 * 下载备份：不传 versionId = GET latest；传 = GET snapshot。404 latest→空、snapshot→陈旧。
 */
export async function downloadBackup(id: ProviderId, versionId?: string): Promise<Blob> {
  const cfg = await getCloudConfig(id);
  if (!cfg) throw new Error('未配置云存储');
  return getCloudProvider(id).downloadBackup(cfg, versionId);
}

/** 删除指定 snapshot 版本：解密凭证后委托 provider（versionId 严格校验，永不删 latest）。 */
export async function deleteBackup(id: ProviderId, versionId: string): Promise<void> {
  const cfg = await getCloudConfig(id);
  if (!cfg) throw new Error('未配置云存储');
  await getCloudProvider(id).deleteBackup(cfg, versionId);
}
