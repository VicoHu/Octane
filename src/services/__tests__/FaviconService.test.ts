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
  normalizeFaviconBlob,
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
    expect(pickHostname('chrome://settings')).toBeNull();
    expect(pickHostname('http://LOCALHOST.')).toBe('localhost');
  });

  it('构造 Chrome _favicon 本地渲染 URL', () => {
    expect(buildFaviconRenderUrl('https://github.com/a')).toBe(
      'chrome-extension://test-ext/_favicon/?pageUrl=' + encodeURIComponent('https://github.com/a') + '&size=64',
    );
  });

  it('只请求 Icon Horse 候选和同首字母 fallback 探针，不请求 DuckDuckGo', () => {
    expect(buildThirdPartySources('https://chat.deepseek.com/chat')).toEqual([
      {
        source: 'icon-horse',
        role: 'candidate',
        url: 'https://icon.horse/icon/chat.deepseek.com',
      },
      {
        source: 'icon-horse',
        role: 'fallback-probe',
        url: 'https://icon.horse/icon/c-octane-favicon-probe.invalid',
      },
    ]);
  });
});

describe('isPrivateFaviconTarget', () => {
  it.each([
    'not-a-url',
    'chrome://settings',
    'file:///tmp/index.html',
    'http://intranet',
    'http://localhost.',
    'http://app.local.',
    'http://[::ffff:127.0.0.1]',
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
    'chrome://settings',
    'http://intranet',
    'http://localhost.',
    'http://app.local.',
    'http://[::ffff:127.0.0.1]',
  ])('%s 调用抓取入口时 fetch 仍为 0', async (url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchBestThirdPartyFavicon(url, { force: true })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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
      hostname: 'a.com', blob, source: 'icon-horse', expiresAt: now - 1,
    }, now)).toMatchObject({ blob, stale: true, canRefresh: true });
  });

  it('失败冷却期不刷新', () => {
    expect(classifyCacheRecord({
      hostname: 'a.com', thirdPartyRetryAt: now + 1,
    }, now)).toMatchObject({ blob: null, stale: false, canRefresh: false });
  });
});


describe('normalizeFaviconBlob 真实适配器', () => {
  function installDomImage(options: {
    width: number;
    height: number;
    output: Blob | null;
  }) {
    const drawImage = vi.fn();
    const clearRect = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => callback(options.output));
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage, clearRect })),
      toBlob,
    };
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) =>
      tagName === 'canvas' ? canvas as unknown as HTMLCanvasElement : originalCreateElement(tagName)
    ) as typeof document.createElement);

    class MockImage {
      naturalWidth = options.width;
      naturalHeight = options.height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', MockImage);
    return { drawImage, toBlob };
  }

  it('带 XML 声明且 MIME 不可信的 SVG 仍按矢量图规范化', async () => {
    const output = new Blob(['png'], { type: 'image/png' });
    const { drawImage } = installDomImage({ width: 16, height: 16, output });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    const result = await normalizeFaviconBlob(new Blob([
      '<?xml version="1.0"?><svg viewBox="0 0 16 16"></svg>',
    ], { type: 'text/xml' }));

    expect(result).toMatchObject({ width: 64, height: 64, vector: true });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 64, 64);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('横向 raster 等比居中绘制为 64x64 PNG', async () => {
    const output = new Blob(['png'], { type: 'image/png' });
    const { drawImage } = installDomImage({ width: 128, height: 64, output });

    const result = await normalizeFaviconBlob(new Blob(['raster'], { type: 'image/png' }));

    expect(result).toMatchObject({ width: 64, height: 64, originalMinSize: 64, vector: false });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 16, 64, 32);
  });

  it('小于 32px 的 raster 被拒绝且临时 URL 仍回收', async () => {
    const { toBlob } = installDomImage({
      width: 16,
      height: 16,
      output: new Blob(['png'], { type: 'image/png' }),
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    expect(await normalizeFaviconBlob(new Blob(['tiny'], { type: 'image/png' }))).toBeNull();
    expect(toBlob).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('Canvas toBlob 失败返回 null', async () => {
    installDomImage({ width: 64, height: 64, output: null });
    expect(await normalizeFaviconBlob(new Blob(['raster'], { type: 'image/png' }))).toBeNull();
  });
});

describe('第三方并行升级', () => {
  it('Icon Horse 候选与同首字母探针相同 → 判定为字母占位并拒绝', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imageResponse('letter-c'))
      .mockResolvedValueOnce(imageResponse('letter-c'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBestThirdPartyFavicon('https://chatgpt.com', {
      force: true,
      now: 100,
      normalize: normalizer({ 'letter-c': { size: 256 } }),
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('duckduckgo'))).toBe(true);
    expect((await getByKey<FaviconRecord>('favicons', 'chatgpt.com'))?.blob).toBeUndefined();
  });

  it('相同占位字节即使 MIME 不同也必须拒绝', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(new Blob(['letter-c'], { type: 'image/png' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Blob(['letter-c'], { type: '' }), { status: 200 })));

    const result = await fetchBestThirdPartyFavicon('https://chatgpt.com', {
      force: true,
      normalize: normalizer({ 'letter-c': { size: 256 } }),
    });

    expect(result).toBeNull();
    expect((await getByKey<FaviconRecord>('favicons', 'chatgpt.com'))?.blob).toBeUndefined();
  });

  it('Icon Horse 候选与 fallback 探针不同 → 缓存规范化后的候选', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(imageResponse('real-icon'))
      .mockResolvedValueOnce(imageResponse('letter-e')));

    const result = await fetchBestThirdPartyFavicon('https://example.com', {
      force: true,
      now: 100,
      normalize: normalizer({ 'real-icon': { size: 128 }, 'letter-e': { size: 256 } }),
    });

    expect(result?.source).toBe('icon-horse');
    expect(await result?.blob.text()).toBe('real-icon-normalized');
    expect(await getByKey<FaviconRecord>('favicons', 'example.com')).toMatchObject({
      source: 'icon-horse', width: 64, height: 64,
      fetchedAt: 100, expiresAt: 100 + THIRD_PARTY_TTL_MS,
    });
  });

  it('候选或 fallback 探针任一 CORS 失败 → 保守拒绝第三方候选', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(imageResponse('real-icon'))
      .mockRejectedValueOnce(new TypeError('CORS')));

    const result = await fetchBestThirdPartyFavicon('https://example.com', {
      force: true,
      normalize: normalizer({ 'real-icon': { size: 64 } }),
    });

    expect(result).toBeNull();
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

  it('刷新期间缓存被 onError 删除，失败写冷却时不得复活旧 Blob', async () => {
    const oldBlob = new Blob(['broken'], { type: 'image/png' });
    await putRecord('favicons', {
      hostname: 'example.com', blob: oldBlob, source: 'icon-horse', mimeType: 'image/png',
      width: 64, height: 64, fetchedAt: 1, expiresAt: 2,
    } satisfies FaviconRecord);

    const rejectors: Array<(reason?: unknown) => void> = [];
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_resolve, reject) => rejectors.push(reject))));
    const pending = fetchBestThirdPartyFavicon('https://example.com', {
      force: true,
      now: 100,
      normalize: normalizer({}),
    });
    await vi.waitFor(() => expect(rejectors).toHaveLength(2));

    await invalidateFavicon('example.com');
    rejectors.forEach((reject) => reject(new TypeError('CORS')));
    await pending;

    const cached = await getByKey<FaviconRecord>('favicons', 'example.com');
    expect(cached?.blob).toBeUndefined();
    expect(cached?.thirdPartyRetryAt).toBe(100 + THIRD_PARTY_RETRY_MS);
  });

  it('普通 fresh-cache 查询与 force 刷新并发时，force 仍发起网络请求', async () => {
    await putRecord('favicons', {
      hostname: 'force.example',
      blob: new Blob(['cached'], { type: 'image/png' }),
      source: 'icon-horse', mimeType: 'image/png', width: 64, height: 64,
      fetchedAt: 1, expiresAt: 10_000,
    } satisfies FaviconRecord);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imageResponse('real-icon'))
      .mockResolvedValueOnce(imageResponse('letter-f'));
    vi.stubGlobal('fetch', fetchMock);
    const normalize = normalizer({ 'real-icon': { size: 64 }, 'letter-f': { size: 256 } });

    const normal = fetchBestThirdPartyFavicon('https://force.example', { now: 100, normalize });
    const forced = fetchBestThirdPartyFavicon('https://force.example', { force: true, now: 100, normalize });
    await Promise.all([normal, forced]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('超时覆盖响应体读取，body 挂起不会永久占用 single-flight', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => Promise.resolve({
      ok: true,
      status: 200,
      blob: () => new Promise<Blob>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBestThirdPartyFavicon('https://body-timeout.example', {
      force: true,
      normalize: normalizer({}),
      timeoutMs: 10,
    });

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('同 hostname 并发只执行一组两源 fetch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let call = 0;
    const fetchMock = vi.fn(async () => {
      await gate;
      call += 1;
      return imageResponse(call === 1 ? 'real-icon' : 'letter-e');
    });
    vi.stubGlobal('fetch', fetchMock);
    const normalize = normalizer({ 'real-icon': { size: 64 }, 'letter-e': { size: 256 } });

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
      .mockResolvedValueOnce(imageResponse('real-icon'))
      .mockResolvedValueOnce(imageResponse('letter-e'));
    vi.stubGlobal('fetch', fetchMock);

    const cached = await fetchBestThirdPartyFavicon('https://example.com', {
      now: 100,
      normalize: normalizer({ 'real-icon': { size: 64 }, 'letter-e': { size: 256 } }),
    });
    expect(await cached?.blob.text()).toBe('cached');
    expect(fetchMock).not.toHaveBeenCalled();

    const refreshed = await refreshFavicon('https://example.com', {
      now: 100,
      normalize: normalizer({ 'real-icon': { size: 64 }, 'letter-e': { size: 256 } }),
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
