import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
// jsdom 的 Blob 经 structuredClone 会丢失原型（Node structuredClone 不识别 jsdom Blob），
// 而 fake-indexeddb 写入时依赖 structuredClone。改用 Node 原生 Blob（仅本测试文件），
// 真实扩展环境（Chromium）IDB 原生序列化对 Blob 是正确的，本替换仅修复测试环境。
import { Blob as NodeBlob } from 'node:buffer';
import {
  pickHostname, buildFaviconRenderUrl, buildSourceList,
  getCachedBlob, fetchAndStoreFavicon, invalidateFavicon, refreshFavicon, clearAllFavicons,
} from '@/services/FaviconService';
import { resetDB, getAll, deleteRecord } from '@/shared/db/database';

// 保存原 Blob，并在替换前留引用，afterAll 还原避免污染其它测试套件。
const OriginalBlob = globalThis.Blob;

// 让全局 Blob 指向 Node 原生 Blob，确保 IDB 往返不损坏字节。
Object.assign(globalThis, { Blob: NodeBlob });

afterAll(() => {
  Object.assign(globalThis, { Blob: OriginalBlob });
});

// mock chrome.runtime.getURL（_favicon URL 构造依赖）
const getURL = vi.fn(() => 'chrome-extension://test-ext/_favicon/');
vi.stubGlobal('chrome', { runtime: { getURL } });

// 工厂：构造 image 响应
function imgResponse(body: string, type = 'image/png'): Response {
  return new Response(new Blob([body], { type }), { status: 200, headers: { 'content-type': type } });
}

beforeEach(async () => {
  resetDB();
  // resetDB 只断开连接不删数据，需显式清空 favicons（跨用例 hostname 复用如 github.com）
  const existing = await getAll<{ hostname: string }>('favicons');
  await Promise.all(existing.map((r) => deleteRecord('favicons', r.hostname)));
  vi.clearAllMocks();
});

describe('pickHostname', () => {
  it('合法 URL 返回 hostname', () => {
    expect(pickHostname('https://github.com/a/b')).toBe('github.com');
  });
  it('非法 URL 返回 null', () => {
    expect(pickHostname('not-a-url')).toBeNull();
  });
});

describe('buildFaviconRenderUrl', () => {
  it('构造 _favicon 占位 URL，pageUrl 编码', () => {
    const u = buildFaviconRenderUrl('https://github.com/a');
    expect(u).toBe('chrome-extension://test-ext/_favicon/?pageUrl=' + encodeURIComponent('https://github.com/a') + '&size=64');
    expect(getURL).toHaveBeenCalledWith('/_favicon/');
  });
});

describe('fetchAndStoreFavicon — 三源回退链', () => {
  it('源 1（icon.horse）命中 → 不请求后续源', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(imgResponse('png-bytes'));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchAndStoreFavicon('https://github.com');
    expect(blob).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 写入缓存
    expect(await getCachedBlob('github.com')).not.toBeNull();
  });

  it('源 1（icon.horse）失败 → 源 2（_favicon 同源）命中', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))  // icon.horse 404
      .mockResolvedValueOnce(imgResponse('fav-bytes'));             // _favicon 同源兜底
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchAndStoreFavicon('https://example.com');
    expect(blob).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = String(fetchMock.mock.calls[1]![0]);
    expect(secondCallUrl).toContain('_favicon/?pageUrl=');
  });

  it('源 1（icon.horse）返回 SVG → 跳过（扩展 img 渲染 SVG 不可靠）→ 源 2 命中', async () => {
    const svgBlob = new Blob(['<svg/>'], { type: 'image/svg+xml' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(svgBlob, { status: 200, headers: { 'content-type': 'image/svg+xml' } }))
      .mockResolvedValueOnce(imgResponse('png-bytes', 'image/png'));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchAndStoreFavicon('https://example.com');
    expect(blob).not.toBeNull();
    // 拿到的是第二源 PNG，不是被跳过的 SVG
    expect(await blob!.text()).toBe('png-bytes');
    expect(blob!.type).toBe('image/png');
  });

  it('源 1+2+3 失败 → 源 4（源站 favicon.ico）命中', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))  // icon.horse
      .mockResolvedValueOnce(new Response(null, { status: 404 }))  // _favicon
      .mockResolvedValueOnce(new Response(null, { status: 404 }))  // duckduckgo
      .mockResolvedValueOnce(imgResponse('origin-bytes'));          // 源站
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchAndStoreFavicon('http://localhost:3000');
    expect(blob).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const fourthCallUrl = String(fetchMock.mock.calls[3]![0]);
    expect(fourthCallUrl).toBe('http://localhost:3000/favicon.ico');
  });

  it('四源全失败 → 返回 null 且不写空记录', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const blob = await fetchAndStoreFavicon('https://noicon.example');
    expect(blob).toBeNull();
    expect(await getCachedBlob('noicon.example')).toBeNull();
  });

  it('空字节响应视为失败继续回退', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Blob([]), { status: 200 })) // 0 字节
      .mockResolvedValueOnce(imgResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchAndStoreFavicon('https://github.com');
    expect(blob).not.toBeNull();
    // 第一源空字节被跳过，请求了第二源
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 拿到的是第二源的 'ok' 内容，不是空字节
    expect(await blob!.text()).toBe('ok');
  });

  it('某源超时后回退到下一源（AbortController 5s）', async () => {
    // 仅 fake setTimeout/Date，避免 fake-indexeddb 依赖的 setImmediate/queueMicrotask 被冻结。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const fetchMock = vi.fn()
        // 第一源挂起，但响应 abort 信号（模拟真实 fetch 被 AbortController 取消）
        .mockImplementationOnce((_url: string, opts?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            const sig = opts?.signal;
            if (!sig) return;
            if (sig.aborted) {
              reject(new DOMException('aborted', 'AbortError'));
              return;
            }
            sig.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
        )
        // 第二源返回有效图片
        .mockResolvedValueOnce(imgResponse('late-ok'));
      vi.stubGlobal('fetch', fetchMock);

      const promise = fetchAndStoreFavicon('https://timeout.example');
      // 推进到超时之后（FETCH_TIMEOUT_MS = 5000）
      await vi.advanceTimersByTimeAsync(5001);
      const blob = await promise;

      expect(blob).not.toBeNull();
      expect(await blob!.text()).toBe('late-ok');
      // 第一源超时后发起了第二源请求
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('非法 URL → 返回 null 且不发起请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAndStoreFavicon('bad-url')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('缓存读写与失效', () => {
  it('getCachedBlob 命中/未命中', async () => {
    expect(await getCachedBlob('github.com')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imgResponse('x')));
    await fetchAndStoreFavicon('https://github.com');
    expect(await getCachedBlob('github.com')).not.toBeNull();
  });

  it('invalidateFavicon 删除后 getCachedBlob 返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imgResponse('x')));
    await fetchAndStoreFavicon('https://github.com');
    await invalidateFavicon('github.com');
    expect(await getCachedBlob('github.com')).toBeNull();
  });

  it('refreshFavicon 无条件重抓覆盖旧缓存', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(imgResponse('old'))
      .mockResolvedValueOnce(imgResponse('new'));
    vi.stubGlobal('fetch', fetchMock);
    await fetchAndStoreFavicon('https://github.com');          // 抓 old
    await refreshFavicon('https://github.com');                // 强制重抓 new
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const blob = await getCachedBlob('github.com');
    expect(await blob!.text()).toBe('new');
  });
});

describe('buildSourceList', () => {
  it('返回四源：icon.horse / _favicon / DuckDuckGo / 源站 favicon.ico', () => {
    const list = buildSourceList('https://github.com/a/b');
    expect(list).toHaveLength(4);
    // icon.horse 优先（站点最大 icon，高清；PNG/ICO 站生效，SVG 站会被 fetchAndStore 跳过）
    expect(list[0]).toBe('https://icon.horse/icon/github.com');
    // _favicon 同源兜底（浏览器缓存的 PNG/ICO），覆盖 icon.horse 返回 SVG / 未收录的站
    expect(list[1]).toContain('_favicon/?pageUrl=');
    expect(list[2]).toBe('https://icons.duckduckgo.com/ip3/github.com.ico');
    expect(list[3]).toBe('https://github.com/favicon.ico');
  });
});

describe('clearAllFavicons', () => {
  it('清空后所有 hostname 缓存为空', async () => {
    // mockImplementation 每次返回新 Response（Response body 只能消费一次，mockResolvedValue 会共享同一已消费对象）
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(imgResponse('x'))));
    await fetchAndStoreFavicon('https://a.com');
    await fetchAndStoreFavicon('https://b.com');
    expect(await getCachedBlob('a.com')).not.toBeNull();
    expect(await getCachedBlob('b.com')).not.toBeNull();
    await clearAllFavicons();
    expect(await getCachedBlob('a.com')).toBeNull();
    expect(await getCachedBlob('b.com')).toBeNull();
  });
});
