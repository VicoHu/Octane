import { deleteRecord, getByKey, getDB, putRecord } from '@/shared/db/database';
import type {
  FaviconRecord,
  ThirdPartyFaviconSource,
} from '@/shared/types';

export const THIRD_PARTY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const THIRD_PARTY_RETRY_MS = 24 * 60 * 60 * 1000;
export const THIRD_PARTY_TIMEOUT_MS = 3000;

function extFaviconBase(): string {
  const chrome = globalThis.chrome as { runtime?: { getURL?: (path: string) => string } } | undefined;
  return chrome?.runtime?.getURL?.('/_favicon/') ?? 'chrome-extension://unknown/_favicon/';
}

export function pickHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function buildFaviconRenderUrl(url: string): string {
  return `${extFaviconBase()}?pageUrl=${encodeURIComponent(url)}&size=64`;
}

export interface ThirdPartySourceRequest {
  source: ThirdPartyFaviconSource;
  url: string;
}

export function buildThirdPartySources(url: string): ThirdPartySourceRequest[] {
  const hostname = new URL(url).hostname;
  return [
    {
      source: 'icon-horse',
      url: `https://icon.horse/icon/${hostname}?status_code_404=true`,
    },
    {
      source: 'duckduckgo',
      url: `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
    },
  ];
}

function parseIpv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split('.').map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

export function isPrivateFaviconTarget(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }

  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
  ) {
    return true;
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4) {
    const [a = 0, b = 0] = ipv4;
    return a === 10
      || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254);
  }

  const ipv6 = hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (ipv6.includes(':')) {
    const first = ipv6.split(':')[0] ?? '';
    return ipv6 === '::1'
      || first === 'fc00'
      || first === 'fd00'
      || /^f[cd][0-9a-f]{2}$/i.test(first)
      || /^fe[89ab][0-9a-f]?$/i.test(first);
  }

  return false;
}

export interface FaviconCacheState {
  blob: Blob | null;
  stale: boolean;
  canRefresh: boolean;
  record?: FaviconRecord;
}

export function classifyCacheRecord(
  record: FaviconRecord | undefined,
  now = Date.now(),
): FaviconCacheState {
  const hasTrustedBlob = !!record?.blob && !!record.source && !!record.expiresAt;
  const stale = hasTrustedBlob && record.expiresAt! <= now;
  const inCooldown = (record?.thirdPartyRetryAt ?? 0) > now;
  return {
    blob: hasTrustedBlob ? record!.blob! : null,
    stale,
    canRefresh: !inCooldown && (!hasTrustedBlob || stale),
    record,
  };
}

export async function getThirdPartyCache(
  hostname: string,
  now = Date.now(),
): Promise<FaviconCacheState> {
  return classifyCacheRecord(await getByKey<FaviconRecord>('favicons', hostname), now);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export interface NormalizedFavicon {
  blob: Blob;
  width: 64;
  height: 64;
  originalMinSize: number;
  vector: boolean;
}

export type FaviconNormalizer = (blob: Blob) => Promise<NormalizedFavicon | null>;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解码失败'));
    image.src = src;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export async function normalizeFaviconBlob(blob: Blob): Promise<NormalizedFavicon | null> {
  if (blob.size === 0 || typeof Image === 'undefined' || typeof document === 'undefined') return null;

  let objectUrl: string | null = null;
  try {
    const vector = blob.type.includes('svg')
      || (blob.type === '' && (await blob.text()).trimStart().startsWith('<svg'));
    objectUrl = URL.createObjectURL(blob);
    const image = await loadImage(objectUrl);
    const originalMinSize = Math.min(image.naturalWidth, image.naturalHeight);
    if (originalMinSize <= 0 || (!vector && originalMinSize < 32)) return null;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const scale = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const x = Math.floor((64 - width) / 2);
    const y = Math.floor((64 - height) / 2);
    context.clearRect(0, 0, 64, 64);
    context.drawImage(image, x, y, width, height);

    const normalized = await canvasToPng(canvas);
    if (!normalized) return null;
    return {
      blob: normalized,
      width: 64,
      height: 64,
      originalMinSize,
      vector,
    };
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

interface Candidate extends NormalizedFavicon {
  source: ThirdPartyFaviconSource;
}

export interface ThirdPartyFaviconResult {
  hostname: string;
  source: ThirdPartyFaviconSource;
  blob: Blob;
  width: number;
  height: number;
}

export interface FetchThirdPartyOptions {
  force?: boolean;
  now?: number;
  normalize?: FaviconNormalizer;
}

const inFlight = new Map<string, Promise<ThirdPartyFaviconResult | null>>();

function resultFromRecord(record: FaviconRecord): ThirdPartyFaviconResult | null {
  if (!record.blob || !record.source) return null;
  return {
    hostname: record.hostname,
    source: record.source,
    blob: record.blob,
    width: record.width ?? 64,
    height: record.height ?? 64,
  };
}

async function performThirdPartyFetch(
  url: string,
  hostname: string,
  options: FetchThirdPartyOptions,
): Promise<ThirdPartyFaviconResult | null> {
  const now = options.now ?? Date.now();
  const normalize = options.normalize ?? normalizeFaviconBlob;
  const existing = await getByKey<FaviconRecord>('favicons', hostname);
  const cache = classifyCacheRecord(existing, now);

  if (!options.force) {
    if (cache.blob && !cache.stale && existing) return resultFromRecord(existing);
    if (!cache.canRefresh) return null;
  }

  const settled = await Promise.allSettled(
    buildThirdPartySources(url).map(async ({ source, url: sourceUrl }): Promise<Candidate | null> => {
      const response = await fetchWithTimeout(sourceUrl, THIRD_PARTY_TIMEOUT_MS);
      const normalized = await normalize(await response.blob());
      return normalized ? { source, ...normalized } : null;
    }),
  );

  const candidates = settled
    .filter((entry): entry is PromiseFulfilledResult<Candidate | null> => entry.status === 'fulfilled')
    .map((entry) => entry.value)
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((a, b) => {
      if (a.vector !== b.vector) return a.vector ? -1 : 1;
      if (a.originalMinSize !== b.originalMinSize) return b.originalMinSize - a.originalMinSize;
      if (a.source === b.source) return 0;
      return a.source === 'icon-horse' ? -1 : 1;
    });

  const best = candidates[0];
  if (!best) {
    await putRecord('favicons', {
      ...existing,
      hostname,
      thirdPartyRetryAt: now + THIRD_PARTY_RETRY_MS,
    });
    return null;
  }

  const record: FaviconRecord = {
    hostname,
    blob: best.blob,
    source: best.source,
    mimeType: 'image/png',
    width: 64,
    height: 64,
    fetchedAt: now,
    expiresAt: now + THIRD_PARTY_TTL_MS,
  };
  await putRecord('favicons', record);
  return resultFromRecord(record);
}

export function fetchBestThirdPartyFavicon(
  url: string,
  options: FetchThirdPartyOptions = {},
): Promise<ThirdPartyFaviconResult | null> {
  const hostname = pickHostname(url);
  if (!hostname || isPrivateFaviconTarget(url)) return Promise.resolve(null);

  const existing = inFlight.get(hostname);
  if (existing) return existing;

  const task = performThirdPartyFetch(url, hostname, options)
    .finally(() => inFlight.delete(hostname));
  inFlight.set(hostname, task);
  return task;
}

/** 兼容旧 hook；Task 5 迁移完成后删除。 */
export async function getCachedBlob(hostname: string): Promise<Blob | null> {
  return (await getThirdPartyCache(hostname)).blob;
}

/** 兼容旧 hook；Task 5 迁移完成后删除。 */
export async function fetchAndStoreFavicon(url: string): Promise<Blob | null> {
  return (await fetchBestThirdPartyFavicon(url))?.blob ?? null;
}

export async function invalidateFavicon(hostname: string): Promise<void> {
  await deleteRecord('favicons', hostname);
}

export async function refreshFavicon(
  url: string,
  options: Omit<FetchThirdPartyOptions, 'force'> = {},
): Promise<Blob | null> {
  return (await fetchBestThirdPartyFavicon(url, { ...options, force: true }))?.blob ?? null;
}

export async function clearAllFavicons(): Promise<void> {
  const db = await getDB();
  await db.clear('favicons');
}
