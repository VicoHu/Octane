export interface StorageQuotaInfo {
  usage: number;
  quota: number;
  available: number;
  usagePercent: number;
}

/** 获取存储配额信息 */
export async function getStorageQuota(): Promise<StorageQuotaInfo> {
  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage ?? 0;
  const quota = estimate.quota ?? 0;
  const available = quota - usage;
  const usagePercent = quota > 0 ? Math.round((usage / quota) * 100) : 0;

  return { usage, quota, available, usagePercent };
}

/** 检查是否有足够空间写入指定大小的数据 */
export async function hasEnoughSpace(requiredBytes: number): Promise<boolean> {
  const { available } = await getStorageQuota();
  // 预留 10% 安全余量
  return available * 0.9 >= requiredBytes;
}

/** 是否需要警告用户存储空间不足（超过 80%） */
export async function isStoragePressure(): Promise<boolean> {
  const { usagePercent } = await getStorageQuota();
  return usagePercent >= 80;
}
