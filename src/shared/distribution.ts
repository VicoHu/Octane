/** 分发渠道：由 chrome.runtime.id 匹配已知商店 ID 判定。 */
export type Channel = 'cws' | 'edge' | 'manual';

/** CWS 扩展 ID（已上架）。 */
export const CWS_EXTENSION_ID = 'odelppbgchjofnnncknfnbapghggihlj';
// Edge 上架后补：export const EDGE_EXTENSION_ID = '...';

/** runtime.id → 渠道。未命中已知商店 ID 一律视为手动安装（安全默认）。 */
const CHANNEL_BY_ID: Record<string, Channel> = {
  [CWS_EXTENSION_ID]: 'cws',
  // [EDGE_EXTENSION_ID]: 'edge', // 上架后补
};

/** 各渠道更新页 URL。Edge 待上架后补实际 ID。 */
export const UPDATE_URL: Record<Channel, string> = {
  cws: `https://chromewebstore.google.com/detail/${CWS_EXTENSION_ID}`,
  edge: 'https://microsoftedge.microsoft.com/addons/detail/<EDGE_ID>',
  manual: 'https://github.com/VicoHu/Octane/releases',
};

/** 渠道展示文案。 */
export const CHANNEL_LABEL: Record<Channel, string> = {
  cws: 'Chrome 商店版',
  edge: 'Edge 商店版',
  manual: '手动安装',
};

/** runtime.id → 渠道；未知 ID fallback manual。 */
export function detectChannel(id: string): Channel {
  return CHANNEL_BY_ID[id] ?? 'manual';
}

/**
 * semver 比较：a vs b（容忍前缀 v）。正数=a 更新，0=相等，负数=b 更新。
 * 逐段数值比较，缺位补 0。用于 pendingUpdate 兜底过滤（version<=本地 则无效）。
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}