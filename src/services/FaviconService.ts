import { broadcastChange, deleteRecord, getByKey, getDB } from '@/shared/db/database';
import type {
  FaviconRecord,
  ThirdPartyFaviconSource,
} from '@/shared/types';

export const THIRD_PARTY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const THIRD_PARTY_RETRY_MS = 24 * 60 * 60 * 1000;
export const THIRD_PARTY_TIMEOUT_MS = 3000;
const REFRESH_CLAIM_TTL_MS = 30_000;

function extFaviconBase(): string {
  const chrome = globalThis.chrome as { runtime?: { getURL?: (path: string) => string } } | undefined;
  return chrome?.runtime?.getURL?.('/_favicon/') ?? 'chrome-extension://unknown/_favicon/';
}

interface ParsedFaviconTarget {
  hostname: string;
  private: boolean;
}

function parseIpv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split('.').map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function mappedIpv4FromIpv6(ipv6: string): number[] | null {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ipv6);
  if (!match) return null;
  const high = Number.parseInt(match[1]!, 16);
  const low = Number.parseInt(match[2]!, 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a = 0, b = 0] = parts;
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

function parseFaviconTarget(raw: string): ParsedFaviconTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (!hostname) return null;
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || (!hostname.includes('.') && !hostname.includes(':'))
  ) {
    return { hostname, private: true };
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4) return { hostname, private: isPrivateIpv4(ipv4) };

  const ipv6 = hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (ipv6.includes(':')) {
    const mappedIpv4 = mappedIpv4FromIpv6(ipv6);
    if (mappedIpv4) return { hostname, private: isPrivateIpv4(mappedIpv4) };
    const first = ipv6.split(':')[0] ?? '';
    return {
      hostname,
      private: ipv6 === '::1'
        || /^f[cd][0-9a-f]{2}$/i.test(first)
        || /^fe[89ab][0-9a-f]?$/i.test(first),
    };
  }

  return { hostname, private: false };
}

export function pickHostname(url: string): string | null {
  return parseFaviconTarget(url)?.hostname ?? null;
}

export function buildFaviconRenderUrl(url: string): string {
  return `${extFaviconBase()}?pageUrl=${encodeURIComponent(url)}&size=64`;
}

export interface ThirdPartySourceRequest {
  source: 'icon-horse';
  role: 'candidate' | 'fallback-probe';
  url: string;
}

export function buildThirdPartySources(url: string): ThirdPartySourceRequest[] {
  const target = parseFaviconTarget(url);
  if (!target || target.private) return [];
  const { hostname } = target;
  const initial = /^[a-z0-9]/i.test(hostname) ? hostname[0]!.toLowerCase() : 'x';
  return [
    {
      source: 'icon-horse',
      role: 'candidate',
      url: `https://icon.horse/icon/${hostname}`,
    },
    {
      source: 'icon-horse',
      role: 'fallback-probe',
      url: `https://icon.horse/icon/${initial}-octane-favicon-probe.invalid`,
    },
  ];
}

export function isPrivateFaviconTarget(url: string): boolean {
  const target = parseFaviconTarget(url);
  return !target || target.private;
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

async function fetchBlobWithTimeout(url: string, timeoutMs: number): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
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
    const svgTextCandidate = blob.type === ''
      || blob.type.includes('xml')
      || blob.type.startsWith('text/');
    const vector = blob.type.includes('svg')
      || (svgTextCandidate && /<svg(?:\s|>)/i.test(await blob.text()));
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

async function blobsEqual(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size) return false;
  const [left, right] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

export interface ThirdPartyFaviconResult {
  hostname: string;
  source: ThirdPartyFaviconSource;
  blob: Blob;
  width: number;
  height: number;
  cacheId?: string;
}

export interface FetchThirdPartyOptions {
  force?: boolean;
  now?: number;
  normalize?: FaviconNormalizer;
  timeoutMs?: number;
}

const inFlight = new Map<string, Promise<ThirdPartyFaviconResult | null>>();

function inFlightKey(hostname: string, force: boolean): string {
  return `${hostname}:${force ? 'force' : 'normal'}`;
}

function createRefreshToken(): string {
  return globalThis.crypto.randomUUID();
}

function resultFromRecord(record: FaviconRecord): ThirdPartyFaviconResult | null {
  if (!record.blob || !record.source) return null;
  return {
    hostname: record.hostname,
    source: record.source,
    blob: record.blob,
    width: record.width ?? 64,
    height: record.height ?? 64,
    cacheId: record.cacheId,
  };
}

async function claimRefresh(
  hostname: string,
  mode: 'normal' | 'force',
  startedAt: number,
): Promise<string | null> {
  const refreshToken = createRefreshToken();
  const db = await getDB();
  const tx = db.transaction('favicons', 'readwrite');
  const store = tx.objectStore('favicons');
  const current = await store.get(hostname) as FaviconRecord | undefined;

  if (mode === 'normal') {
    const newerForceExists = (current?.lastForceStartedAt ?? -Infinity) >= startedAt;
    const forceClaimAge = startedAt - (current?.refreshStartedAt ?? -Infinity);
    const activeForceExists = current?.refreshMode === 'force'
      && forceClaimAge >= 0
      && forceClaimAge < REFRESH_CLAIM_TTL_MS;
    if (activeForceExists || newerForceExists) {
      await tx.done;
      return null;
    }
  }

  await store.put({
    ...current,
    hostname,
    refreshToken,
    refreshMode: mode,
    refreshStartedAt: startedAt,
    lastForceStartedAt: mode === 'force'
      ? Math.max(current?.lastForceStartedAt ?? -Infinity, startedAt)
      : current?.lastForceStartedAt,
  });
  await tx.done;
  broadcastChange('favicons', 'put');
  return refreshToken;
}

async function writeFailureCooldown(
  hostname: string,
  now: number,
  refreshToken: string,
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('favicons', 'readwrite');
  const store = tx.objectStore('favicons');
  const current = await store.get(hostname) as FaviconRecord | undefined;
  if (current?.refreshToken !== refreshToken) {
    await tx.done;
    return;
  }

  // 同一个 readwrite transaction 内读取并更新，避免 onError 的 delete 插入 get/put 之间，
  // 同时用持久化令牌阻止其他扩展运行时中的旧请求提交结果。
  await store.put({
    ...current,
    hostname,
    refreshToken: undefined,
    refreshMode: undefined,
    refreshStartedAt: undefined,
    thirdPartyRetryAt: now + THIRD_PARTY_RETRY_MS,
  });
  await tx.done;
  broadcastChange('favicons', 'put');
}

async function writeSuccessRecord(
  record: FaviconRecord,
  refreshToken: string,
): Promise<boolean> {
  const db = await getDB();
  const tx = db.transaction('favicons', 'readwrite');
  const store = tx.objectStore('favicons');
  const current = await store.get(record.hostname) as FaviconRecord | undefined;
  if (current?.refreshToken !== refreshToken) {
    await tx.done;
    return false;
  }

  await store.put({
    ...record,
    lastForceStartedAt: current.lastForceStartedAt,
  });
  await tx.done;
  broadcastChange('favicons', 'put');
  return true;
}

async function performThirdPartyFetch(
  url: string,
  hostname: string,
  options: FetchThirdPartyOptions,
): Promise<ThirdPartyFaviconResult | null> {
  const now = options.now ?? Date.now();
  const normalize = options.normalize ?? normalizeFaviconBlob;
  const timeoutMs = options.timeoutMs ?? THIRD_PARTY_TIMEOUT_MS;
  const existing = await getByKey<FaviconRecord>('favicons', hostname);
  const cache = classifyCacheRecord(existing, now);

  if (!options.force) {
    if (cache.blob && !cache.stale && existing) return resultFromRecord(existing);
    if (!cache.canRefresh) return null;
  }

  const refreshToken = await claimRefresh(hostname, options.force ? 'force' : 'normal', now);
  if (!refreshToken) return null;
  const [candidateRequest, fallbackRequest] = buildThirdPartySources(url);
  const settled = await Promise.allSettled([
    fetchBlobWithTimeout(candidateRequest!.url, timeoutMs),
    fetchBlobWithTimeout(fallbackRequest!.url, timeoutMs),
  ]);
  const candidateEntry = settled[0];
  const fallbackEntry = settled[1];
  if (candidateEntry?.status !== 'fulfilled' || fallbackEntry?.status !== 'fulfilled') {
    await writeFailureCooldown(hostname, now, refreshToken);
    return null;
  }

  const [candidateBlob, fallbackBlob] = [candidateEntry.value, fallbackEntry.value];
  // Icon Horse 免费接口未命中时仍返回 HTTP 200 的首字母占位图。
  // 用同首字母的 .invalid 域名取得该占位图指纹；完全相同则拒绝升级。
  if (await blobsEqual(candidateBlob, fallbackBlob)) {
    await writeFailureCooldown(hostname, now, refreshToken);
    return null;
  }

  const best = await normalize(candidateBlob);
  if (!best) {
    await writeFailureCooldown(hostname, now, refreshToken);
    return null;
  }

  const record: FaviconRecord = {
    hostname,
    blob: best.blob,
    source: 'icon-horse',
    mimeType: 'image/png',
    width: 64,
    height: 64,
    fetchedAt: now,
    expiresAt: now + THIRD_PARTY_TTL_MS,
    cacheId: refreshToken,
  };
  if (!await writeSuccessRecord(record, refreshToken)) return null;
  return resultFromRecord(record);
}

export function fetchBestThirdPartyFavicon(
  url: string,
  options: FetchThirdPartyOptions = {},
): Promise<ThirdPartyFaviconResult | null> {
  const target = parseFaviconTarget(url);
  if (!target || target.private) return Promise.resolve(null);
  const { hostname } = target;

  const forceKey = inFlightKey(hostname, true);
  if (!options.force) {
    const forced = inFlight.get(forceKey);
    if (forced) return forced;
  }

  const taskKey = inFlightKey(hostname, !!options.force);
  const existing = inFlight.get(taskKey);
  if (existing) return existing;

  const task = performThirdPartyFetch(url, hostname, options)
    .finally(() => inFlight.delete(taskKey));
  inFlight.set(taskKey, task);
  return task;
}

export async function invalidateFavicon(
  hostname: string,
  expectedCacheId?: string,
): Promise<void> {
  if (expectedCacheId === undefined) {
    await deleteRecord('favicons', hostname);
    return;
  }

  const db = await getDB();
  const tx = db.transaction('favicons', 'readwrite');
  const store = tx.objectStore('favicons');
  const current = await store.get(hostname) as FaviconRecord | undefined;
  if (!current || current.cacheId !== expectedCacheId) {
    await tx.done;
    return;
  }

  if (current.refreshToken) {
    await store.put({
      hostname,
      refreshToken: current.refreshToken,
      refreshMode: current.refreshMode,
      refreshStartedAt: current.refreshStartedAt,
      lastForceStartedAt: current.lastForceStartedAt,
      thirdPartyRetryAt: current.thirdPartyRetryAt,
    } satisfies FaviconRecord);
    await tx.done;
    broadcastChange('favicons', 'put');
    return;
  }

  await store.delete(hostname);
  await tx.done;
  broadcastChange('favicons', 'delete');
}

export async function refreshFavicon(
  url: string,
  options: Omit<FetchThirdPartyOptions, 'force'> = {},
): Promise<ThirdPartyFaviconResult | null> {
  return fetchBestThirdPartyFavicon(url, { ...options, force: true });
}

export async function clearAllFavicons(): Promise<void> {
  const db = await getDB();
  await db.clear('favicons');
}
