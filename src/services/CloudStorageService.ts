import { encrypt, decrypt } from '@/services/CryptoService';
import { getCloudProvider } from '@/services/cloud/providers';
import type { CloudStorageConfig, ProviderId } from '@/services/cloud/types';

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

/** 上传备份：解密凭证 → 委托 provider.put → 记录 lastBackupAt。 */
export async function uploadBackup(id: ProviderId, blob: Blob): Promise<void> {
  const cfg = await getCloudConfig(id);
  if (!cfg) throw new Error('未配置云存储');
  await getCloudProvider(id).uploadBackup(cfg, blob);
  await setLastBackupAt(id, Date.now());
}

/** 下载备份：解密凭证 → 委托 provider.get → 返回 Blob。 */
export async function downloadBackup(id: ProviderId): Promise<Blob> {
  const cfg = await getCloudConfig(id);
  if (!cfg) throw new Error('未配置云存储');
  return getCloudProvider(id).downloadBackup(cfg);
}
