import type { CloudStorageConfig } from './types';

/**
 * 从配置中提取必填字段，缺任一则抛错（明确报缺失字段名，优于静默传空串）。
 * 仅用于 string 型字段（region/bucket/accessKeyId/accessKeySecret/username/password 等）。
 *
 * 示例：
 *   const { region, bucket } = getRequired(cfg, ['region', 'bucket']);
 */
export function getRequired<K extends keyof CloudStorageConfig>(
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
