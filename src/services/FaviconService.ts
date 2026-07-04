import { putRecord, getByKey, deleteRecord } from '@/shared/db/database';
import type { FaviconRecord } from '@/shared/types';

/** 每源抓取超时（ms） */
const FETCH_TIMEOUT_MS = 5000;

/**
 * 取本扩展 _favicon 端点基址。扩展环境用 chrome.runtime.getURL；
 * 测试/非扩展环境回退占位串（仅 buildFaviconRenderUrl 用，不实际请求）。
 */
function extFaviconBase(): string {
  const chrome = globalThis.chrome as { runtime?: { getURL?: (p: string) => string } } | undefined;
  return chrome?.runtime?.getURL?.('/_favicon/') ?? 'chrome-extension://unknown/_favicon/';
}

/** 从 url 提取 hostname；非法返回 null。 */
export function pickHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * 构造 _favicon 占位渲染 URL（同步，供缓存未命中时即时渲染）。
 * 读浏览器 favicon 缓存，国内可用，不走 google.com。
 */
export function buildFaviconRenderUrl(url: string): string {
  const base = extFaviconBase();
  return `${base}?pageUrl=${encodeURIComponent(url)}&size=32`;
}

/**
 * 构造抓取回退源链（每源 5s 超时，串行，首有效即停）：
 * 1. _favicon（浏览器缓存，国内可用）
 * 2. icons.duckduckgo.com（国内可达第三方）
 * 3. <origin>/favicon.ico（源站，覆盖 localhost/内网）
 * 完全避开 google.com。
 */
export function buildSourceList(url: string): string[] {
  const u = new URL(url);
  return [
    buildFaviconRenderUrl(url),
    `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`,
    `${u.origin}/favicon.ico`,
  ];
}

/** 单源超时抓取。超时/非 2xx 抛错，由调用方回退下一源。 */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** 读缓存 blob；未命中返回 null。 */
export async function getCachedBlob(hostname: string): Promise<Blob | null> {
  const rec = await getByKey<FaviconRecord>('favicons', hostname);
  return rec?.blob ?? null;
}

/**
 * 执行三源回退抓取；首个有效（非空字节）结果写库并返回。
 * 全失败返回 null（不写空记录，下次访问重试）。
 */
export async function fetchAndStoreFavicon(url: string): Promise<Blob | null> {
  const hostname = pickHostname(url);
  if (!hostname) return null;

  const sources = buildSourceList(url);
  for (const src of sources) {
    try {
      const res = await fetchWithTimeout(src, FETCH_TIMEOUT_MS);
      const blob = await res.blob();
      if (blob.size === 0) continue; // 空响应视为失败，试下一源
      const record: FaviconRecord = {
        hostname,
        blob,
        mimeType: blob.type || 'image/png',
        fetchedAt: Date.now(),
      };
      await putRecord('favicons', record);
      return blob;
    } catch {
      // 超时/网络/非 2xx → 试下一源
    }
  }
  return null;
}

/** 删除指定 hostname 缓存（URL 变更 / 手动刷新用）。 */
export async function invalidateFavicon(hostname: string): Promise<void> {
  await deleteRecord('favicons', hostname);
}

/**
 * 手动刷新：无条件重抓覆盖。
 * 编辑页刷新按钮调用；失败返回 null（UI Toast 提示）。
 */
export async function refreshFavicon(url: string): Promise<Blob | null> {
  const hostname = pickHostname(url);
  if (!hostname) return null;
  await invalidateFavicon(hostname);
  return fetchAndStoreFavicon(url);
}
