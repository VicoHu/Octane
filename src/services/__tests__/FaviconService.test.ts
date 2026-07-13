import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THIRD_PARTY_RETRY_MS,
  THIRD_PARTY_TTL_MS,
  buildFaviconRenderUrl,
  buildThirdPartySources,
  classifyCacheRecord,
  clearAllFavicons,
  fetchBestThirdPartyFavicon,
  getThirdPartyCache,
  invalidateFavicon,
  isPrivateFaviconTarget,
  pickHostname,
  refreshFavicon,
  type FaviconNormalizer,
} from '@/services/FaviconService';
import { deleteRecord, getAll, getByKey, putRecord, resetDB } from '@/shared/db/database';
import type { FaviconRecord } from '@/shared/types';

const OriginalBlob = globalThis.Blob;
Object.assign(globalThis, { Blob: NodeBlob });

afterAll(() => {
  Object.assign(globalThis, { Blob: OriginalBlob });
});

const getURL = vi.fn(() => 'chrome-extension://test-ext/_favicon/');
vi.stubGlobal('chrome', { runtime: { getURL } });

function imageResponse(body: string, type = 'image/png'): Response {
  return new Response(new Blob([body], { type }), {
    status: 200,
    headers: { 'content-type': type },
  });
}

function normalizer(map: Record<string, { size: number; vector?: boolean } | null>): FaviconNormalizer {
  return async (blob) => {
    const text = await blob.text();
    const meta = map[text];
    if (!meta) return null;
    return {
      blob: new Blob([`${text}-normalized`], { type: 'image/png' }),
      width: 64,
      height: 64,
      originalMinSize: meta.size,
      vector: meta.vector ?? false,
    };
  };
}

beforeEach(async () => {
  resetDB();
  const existing = await getAll<FaviconRecord>('favicons');
  await Promise.all(existing.map((record) => deleteRecord('favicons', record.hostname)));
  vi.restoreAllMocks();
  getURL.mockClear();
  vi.stubGlobal('chrome', { runtime: { getURL } });
});

describe('URL 与来源', () => {
  it('提取 hostname，非法 URL 返回 null', () => {
    expect(pickHostname('https://github.com/a')).toBe('github.com');
    expect(pickHostname('not-a-url')).toBeNull();
  });

  it('构造 Chrome _favicon 本地渲染 URL', () => {
    expect(buildFaviconRenderUrl('https://github.com/a')).toBe(
      'chrome-extension://test-ext/_favicon/?pageUrl=' + encodeURIComponent('https://github.com/a') + '&size=64',
    );
  });

  it('第三方只包含 Icon Horse 与 DuckDuckGo', () => {
    expect(buildThirdPartySources('https://platform.deepseek.com/chat')).toEqual([
      {
        source: 'icon-horse',
        url: 'https://icon.horse/icon/platform.deepseek.com?status_code_404=true',
      },
      {
        source: 'duckduckgo',
        url: 'https://icons.duckduckgo.com/ip3/platform.deepseek.com.ico',
      },
    ]);
  });
});

describe('isPrivateFaviconTarget', () => {
  it.each([
    'not-a-url',
    'http://localhost:3000',
    'http://app.localhost',
    'http://app.local',
    'http://127.0.0.1',
    'http://10.0.0.2',
    'http://172.16.0.2',
    'http://172.31.255.254',
    'http://192.168.1.2',
    'http://169.254.1.2',
    'http://[::1]',
    'http://[fc00::1]',
    'http://[fd12::1]',
    'http://[fe80::1]',
  ])('%s 不访问第三方', (url) => {
    expect(isPrivateFaviconTarget(url)).toBe(true);
  });

  it.each([
    'https://chatgpt.com',
    'https://platform.deepseek.com',
    'https://8.8.8.8',
    'https://172.32.0.1',
    'https://example.com',
  ])('%s 可访问第三方', (url) => {
    expect(isPrivateFaviconTarget(url)).toBe(false);
  });
});

describe('缓存状态', () => {
  const now = 1_000_000;
  const blob = new Blob(['cached'], { type: 'image/png' });

  it('未命中允许刷新', () => {
    expect(classifyCacheRecord(undefined, now)).toEqual({
      blob: null,
      stale: false,
      canRefresh: true,
      record: undefined,
    });
  });

  it('新鲜可信缓存直接命中且不刷新', () => {
    expect(classifyCacheRecord({
      hostname: 'a.com', blob, source: 'icon-horse', expiresAt: now + 1,
    }, now)).toMatchObject({ blob, stale: false, canRefresh: false });
  });

  it('过期缓存继续可显示并允许刷新', () => {
    expect(classifyCacheRecord({
      hostname: 'a.com', blob, source: 'duckduckgo', expiresAt: now - 1,
    }, now)).toMatchObject({ blob, stale: true, canRefresh: true });
  });

  it('失败冷却期不刷新', () => {
    expect(classifyCacheRecord({
      hostname: 'a.com', thirdPartyRetryAt: now + 1,
    }, now)).toMatchObject({ blob: null, stale: false, canRefresh: false });
  });
});

describe('第三方并行升级', () => {
  it('两个源并行成功时 SVG 优先于更大的栅格图', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imageResponse('horse-raster'))
      .mockResolvedValueOnce(imageResponse('duck-svg', 'image/svg+xml'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBestThirdPartyFavicon('https://example.com', {
      force: true,
      now: 100,
      normalize: normalizer({
        'horse-raster': { size: 128 },
        'duck-svg': { size: 64, vector: true },
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.source).toBe('duckduckgo');
    expect(result?.blob.type).toBe('image/png');
    expect(await getByKey<FaviconRecord>('favicons', 'example.com')).toMatchObject({
      source: 'duckduckgo', width: 64, height: 64,
      fetchedAt: 100, expiresAt: 100 + THIRD_PARTY_TTL_MS,
    });
  });

  it('一个源 CORS 失败时使用另一个有效源', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new TypeError('CORS'))
      .mockResolvedValueOnce(imageResponse('duck')));

    const result = await fetchBestThirdPartyFavicon('https://example.com', {
      force: true,
      normalize: normalizer({ duck: { size: 64 } }),
    });

    expect(result?.source).toBe('duckduckgo');
  });

  it('栅格候选选尺寸更大者，同尺寸优先 Icon Horse', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(imageResponse('horse'))
      .mockResolvedValueOnce(imageResponse('duck')));
    const result = await fetchBestThirdPartyFavicon('https://example.com', {
      force: true,
      normalize: normalizer({ horse: { size: 64 }, duck: { size: 64 } }),
    });
    expect(result?.source).toBe('icon-horse');
  });

  it('内网地址不发起任何第三方请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchBestThirdPartyFavicon('http://192.168.1.2:3000', { force: true })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('两源失败记录 24h 冷却且不覆盖旧成功 Blob', async () => {
    const oldBlob = new Blob(['old'], { type: 'image/png' });
    await putRecord('favicons', {
      hostname: 'example.com', blob: oldBlob, source: 'icon-horse', mimeType: 'image/png',
      width: 64, height: 64, fetchedAt: 1, expiresAt: 2,
    } satisfies FaviconRecord);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('CORS')));

    const result = await fetchBestThirdPartyFavicon('https://example.com', {
      force: true,
      now: 100,
      normalize: normalizer({}),
    });

    expect(result).toBeNull();
    const cached = await getByKey<FaviconRecord>('favicons', 'example.com');
    expect(await cached?.blob?.text()).toBe('old');
    expect(cached?.thirdPartyRetryAt).toBe(100 + THIRD_PARTY_RETRY_MS);
  });

  it('同 hostname 并发只执行一组两源 fetch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchMock = vi.fn(async () => {
      await gate;
      return imageResponse('horse');
    });
    vi.stubGlobal('fetch', fetchMock);
    const normalize = normalizer({ horse: { size: 64 } });

    const first = fetchBestThirdPartyFavicon('https://example.com/a', { force: true, normalize });
    const second = fetchBestThirdPartyFavicon('https://example.com/b', { force: true, normalize });
    release();
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fresh cache 不请求网络，手动刷新忽略 fresh/cooldown', async () => {
    const cachedBlob = new Blob(['cached'], { type: 'image/png' });
    await putRecord('favicons', {
      hostname: 'example.com', blob: cachedBlob, source: 'icon-horse', mimeType: 'image/png',
      width: 64, height: 64, fetchedAt: 1, expiresAt: 10_000, thirdPartyRetryAt: 10_000,
    } satisfies FaviconRecord);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imageResponse('horse'))
      .mockResolvedValueOnce(imageResponse('duck'));
    vi.stubGlobal('fetch', fetchMock);

    const cached = await fetchBestThirdPartyFavicon('https://example.com', {
      now: 100,
      normalize: normalizer({ horse: { size: 64 }, duck: { size: 32 } }),
    });
    expect(await cached?.blob.text()).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();

    const refreshed = await refreshFavicon('https://example.com', {
      now: 100,
      normalize: normalizer({ horse: { size: 64 }, duck: { size: 32 } }),
    });
    expect(refreshed).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('缓存管理', () => {
  it('读取、删除与清空缓存', async () => {
    await putRecord('favicons', { hostname: 'a.com', thirdPartyRetryAt: 1 } satisfies FaviconRecord);
    await putRecord('favicons', { hostname: 'b.com', thirdPartyRetryAt: 1 } satisfies FaviconRecord);

    expect((await getThirdPartyCache('a.com', 2)).canRefresh).toBe(true);
    await invalidateFavicon('a.com');
    expect(await getByKey('favicons', 'a.com')).toBeUndefined();
    await clearAllFavicons();
    expect(await getAll('favicons')).toEqual([]);
  });
});
