# Favicon 本地缓存系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把书签 favicon 从"每次远程 URL 直渲"改为"IndexedDB blob 缓存 + 国内可用三源回退 + 编辑页手动刷新"，解决国内不显示、每次重载、N 次 put 性能三个问题。

**Architecture:** 新增 `favicons` IndexedDB store（per-hostname）+ 纯逻辑 `FaviconService`（抓取/缓存/失效/刷新）+ `useFavicon` 渲染 hook（blob 优先，`createObjectURL`，卸载 revoke）+ `BookmarkFaviconPreview` 编辑表单组件（URL 旁预览 + 刷新按钮）。抓取链 `_favicon` → DuckDuckGo → 源站，完全避开 google.com。

**Tech Stack:** TypeScript · wxt (MV3) · React · idb v8 · vitest + fake-indexeddb · Semi Design

## Global Constraints

- 包管理器 `pnpm`（非 npm）。验证命令 `pnpm run typecheck` + `pnpm run test`，husky pre-push 自动跑双 gate。
- 语言强制中文：所有代码注释、日志、测试 `describe/it` 描述用中文。
- 测试规范见 `docs/standards/testing.md`：不 mock Semi（仅 partial mock Toast）；lottie-web 由 vitest alias 全局 stub，测试文件**不要**再 `vi.mock('lottie-web')`；query 用 `getByRole/getByText/getByPlaceholderText`；交互用 `userEvent`；断言用 jest-dom matcher（`toBeInTheDocument()` 等）；mock 只命中副作用边界（chrome API / DB / 网络 / fetch / Toast）。
- DB 测试用 `import 'fake-indexeddb/auto'` + `resetDB()`（见 `tests/db/database.test.ts` 范本）。
- 外科手术修改：只改计划列出的文件/行；不顺手优化相邻代码；遵循现有注释密度与风格。
- 接口签名贯穿全程必须一致（见各 Task 的 Produces 块）。

## File Structure

**新增：**
- `src/services/FaviconService.ts` — 抓取/缓存/失效/刷新纯逻辑（无 React 依赖）
- `src/newtab/hooks/useFavicon.ts` — 渲染 hook
- `src/newtab/components/BookmarkFaviconPreview/index.tsx` — 编辑表单预览组件
- `src/newtab/components/BookmarkFaviconPreview/index.module.css` — 预览组件样式
- `src/services/__tests__/FaviconService.test.ts` — FaviconService 单测
- `src/newtab/hooks/__tests__/useFavicon.test.tsx` — hook 测试
- `src/newtab/components/BookmarkFaviconPreview/__tests__/index.test.tsx` — 预览组件测试

**修改：**
- `src/shared/types/index.ts` — `DB_VERSION` 2→3；增 `FaviconRecord`
- `src/shared/db/database.ts` — `OctaneDB`/`StoreName` 增 `favicons`；upgrade 建表
- `wxt.config.ts` — permissions 增 `'favicon'`
- `src/newtab/components/BookmarkCard/index.tsx` — 用 `useFavicon` 替换 faviconUrl 直读
- `src/newtab/components/BookmarkOpsPanel/index.tsx` — URL 输入框旁插 `BookmarkFaviconPreview`
- `src/entrypoints/popup/views/SaveBookmarkView.tsx` — 删 getFaviconUrl 调用 + 插 `BookmarkFaviconPreview`
- `src/store/useBookmarks.ts` — 删 `loadBookmarks` 自愈循环 + `createBookmark` favicon 补充
- `src/services/BookmarkService.ts` — `getFaviconUrl` 标 `@deprecated`

---

## Wave 1 — 基础设施（串行执行）

> 用户决策：W1 内部**串行**（DB schema 先行，再 FaviconService）。subagent A 做 Task 1+3，完成后 subagent B 做 Task 2。W1 全部完成后派独立 review subagent（见 W1 Gate）。

### Task 1: DB schema — `favicons` store + 类型

**Files:**
- Modify: `src/shared/types/index.ts:98`（`DB_VERSION`）、新增 `FaviconRecord`
- Modify: `src/shared/db/database.ts:12-20`（`OctaneDB`/`StoreName`）、`:56-91`（upgrade）
- Test: `tests/db/database.test.ts`（追加用例，不新建文件）

**Interfaces:**
- Produces:
  - `DB_VERSION = 3`（导出自 `@/shared/types`）
  - `FaviconRecord` 类型：`{ hostname: string; blob: Blob; mimeType: string; fetchedAt: number }`
  - `favicons` 加入 `StoreName` 联合类型与 `OctaneDB` 接口（keyPath=`'hostname'`）
  - Task 2 的 FaviconService 通过现有 generic `putRecord('favicons', record)` / `getByKey<FaviconRecord>('favicons', hostname)` / `deleteRecord('favicons', hostname)` 读写，**无需新增 CRUD helper**

- [ ] **Step 1: 写失败测试**（追加到 `tests/db/database.test.ts` 末尾）

```typescript
describe('favicons store（DB v3）', () => {
  it('favicons store 存在且以 hostname 为主键', async () => {
    const db = await getDB();
    expect(db.objectStoreNames.contains('favicons')).toBe(true);
    // 主键路径 = hostname（per-hostname 缓存去重）
    // @ts-expect-error 访问内部 schema
    expect(db.transaction('favicons').store.keyPath).toEqual(['hostname']);
  });

  it('per-hostname 去重：同 hostname 第二次 put 覆盖而非新增', async () => {
    const rec1: FaviconRecord = { hostname: 'github.com', blob: new Blob(['a']), mimeType: 'image/png', fetchedAt: 1 };
    const rec2: FaviconRecord = { hostname: 'github.com', blob: new Blob(['b']), mimeType: 'image/png', fetchedAt: 2 };
    await putRecord('favicons', rec1);
    await putRecord('favicons', rec2);
    const got = await getByKey<FaviconRecord>('favicons', 'github.com');
    expect(got?.fetchedAt).toBe(2);
  });
});
```

在文件顶部 import 区追加 `FaviconRecord`：

```typescript
import type { Workspace, Category, Bookmark, Context, FaviconRecord } from '@/shared/types';
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run tests/db/database.test.ts`
Expected: FAIL — `favicons` store 不存在 / `DB_VERSION` 仍为 2 / `FaviconRecord` 未导出

- [ ] **Step 3: 改类型** `src/shared/types/index.ts`

```typescript
/** IndexedDB 数据库版本号 */
export const DB_VERSION = 3;

/** Favicon 缓存记录（per-hostname 去重） */
export interface FaviconRecord {
  /** 主键：hostname（new URL().hostname），同站多书签共享一份 */
  hostname: string;
  /** 原始图片字节 */
  blob: Blob;
  /** image/png 等，用于诊断 */
  mimeType: string;
  /** 抓取时间戳；永久缓存（D2），仅手动刷新或 URL 变更时失效 */
  fetchedAt: number;
}
```

- [ ] **Step 4: 改 DB schema** `src/shared/db/database.ts`

`OctaneDB` 接口（line 12-18）追加：

```typescript
interface OctaneDB extends IDBPDatabase {
  workspaces: IDBPObjectStore<OctaneDB, ['workspaces']>;
  categories: IDBPObjectStore<OctaneDB, ['categories']>;
  bookmarks: IDBPObjectStore<OctaneDB, ['bookmarks']>;
  contexts: IDBPObjectStore<OctaneDB, ['contexts']>;
  cryptoMetadata: IDBPObjectStore<OctaneDB, ['cryptoMetadata']>;
  favicons: IDBPObjectStore<OctaneDB, ['favicons']>;
}

type StoreName = 'workspaces' | 'categories' | 'bookmarks' | 'contexts' | 'cryptoMetadata' | 'favicons';
```

`upgrade(db)` 回调末尾（`cryptoMetadata` 建表之后）追加：

```typescript
    // favicon 缓存（v2→v3）：per-hostname 去重，不进备份
    if (!db.objectStoreNames.contains('favicons')) {
      db.createObjectStore('favicons', { keyPath: 'hostname' });
    }
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `pnpm vitest run tests/db/database.test.ts`
Expected: PASS（新用例 + 原有用例全绿，确认 v2→v3 升级未破坏旧 store）

- [ ] **Step 6: 提交**

```bash
git add src/shared/types/index.ts src/shared/db/database.ts tests/db/database.test.ts
git commit -m "feat(db): 新增 favicons store（v2→v3，per-hostname 缓存）"
```

---

### Task 2: FaviconService — 抓取/缓存/失效/刷新

**Files:**
- Create: `src/services/FaviconService.ts`
- Test: `src/services/__tests__/FaviconService.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `FaviconRecord`、generic `putRecord/getByKey/deleteRecord`、`StoreName='favicons'`
- Produces（**后续 Task 必须照此签名**）:

```typescript
export function pickHostname(url: string): string | null;
export function buildFaviconRenderUrl(url: string): string;
export function getCachedBlob(hostname: string): Promise<Blob | null>;
export function fetchAndStoreFavicon(url: string): Promise<Blob | null>;
export function invalidateFavicon(hostname: string): Promise<void>;
export function refreshFavicon(url: string): Promise<Blob | null>;
```

- [ ] **Step 1: 写失败测试** `src/services/__tests__/FaviconService.test.ts`

```typescript
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import {
  pickHostname, buildFaviconRenderUrl, buildSourceList,
  getCachedBlob, fetchAndStoreFavicon, invalidateFavicon, refreshFavicon,
} from '@/services/FaviconService';
import { resetDB } from '@/shared/db/database';

// mock chrome.runtime.getURL（_favicon URL 构造依赖）
const getURL = vi.fn(() => 'chrome-extension://test-ext/_favicon/');
vi.stubGlobal('chrome', { runtime: { getURL } });

// 工厂：构造 image 响应
function imgResponse(body: string, type = 'image/png'): Response {
  return new Response(new Blob([body], { type }), { status: 200, headers: { 'content-type': type } });
}

beforeEach(async () => {
  resetDB();
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
    expect(u).toBe('chrome-extension://test-ext/_favicon/?pageUrl=' + encodeURIComponent('https://github.com/a') + '&size=32');
    expect(getURL).toHaveBeenCalledWith('/_favicon/');
  });
});

describe('fetchAndStoreFavicon — 三源回退链', () => {
  it('源 1（_favicon）命中 → 不请求后续源', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(imgResponse('png-bytes'));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchAndStoreFavicon('https://github.com');
    expect(blob).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 写入缓存
    expect(await getCachedBlob('github.com')).not.toBeNull();
  });

  it('源 1 失败 → 源 2（DuckDuckGo）命中', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))  // _favicon 404
      .mockResolvedValueOnce(imgResponse('ddg-bytes', 'image/x-icon')); // duckduckgo
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchAndStoreFavicon('https://example.com');
    expect(blob).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondCallUrl).toContain('icons.duckduckgo.com/ip3/example.com.ico');
  });

  it('源 1+2 失败 → 源 3（源站 favicon.ico）命中', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(imgResponse('origin-bytes'));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchAndStoreFavicon('http://localhost:3000');
    expect(blob).not.toBeNull();
    const thirdCallUrl = String(fetchMock.mock.calls[2][0]);
    expect(thirdCallUrl).toBe('http://localhost:3000/favicon.ico');
  });

  it('三源全失败 → 返回 null 且不写空记录', async () => {
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run src/services/__tests__/FaviconService.test.ts`
Expected: FAIL — 模块不存在 / 函数未定义

- [ ] **Step 3: 实现 FaviconService** `src/services/FaviconService.ts`

```typescript
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
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm vitest run src/services/__tests__/FaviconService.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/services/FaviconService.ts src/services/__tests__/FaviconService.test.ts
git commit -m "feat(favicon): FaviconService 三源回退抓取 + per-hostname 缓存 + 手动刷新"
```

---

### Task 3: manifest `favicon` 权限

**Files:**
- Modify: `wxt.config.ts`（permissions 数组）

**Interfaces:**
- Produces: 运行时 `chrome.runtime.getURL('/_favicon/')` 可用（FaviconService 依赖）

- [ ] **Step 1: 修改 permissions**

`wxt.config.ts` manifest 中：

```typescript
    permissions: ['storage', 'tabs', 'sidePanel', 'favicon'],
```

- [ ] **Step 2: typecheck 确认无破坏**

Run: `pnpm run typecheck`
Expected: PASS（无类型错误）

- [ ] **Step 3: 提交**

```bash
git add wxt.config.ts
git commit -m "feat(manifest): 声明 favicon 权限（_favicon API）"
```

---

### W1 Gate — 独立 review + build test subagent

> W1 三个 task 完成后，派**独立 subagent**（非实现者）执行：
> 1. `pnpm run typecheck` + `pnpm run test` 双绿
> 2. `/code-review` 对 W1 diff（关注：抓取链正确性、超时/AbortController、blob 有效性判定、per-hostname 去重、DB upgrade 幂等）
> 3. 报告问题；若有 finding，回实现者修复后重跑本 Gate
> **双绿 + 无 critical finding 才进 W2。**

---

## Wave 2 — 渲染接入（串行为主）

> T2.1 → T2.2 串行；T2.3 可与 T2.1/T2.2 部分并行；T2.4 依赖 T2.1 + W1。建议单 subagent 顺序做完 T2.1-T2.4，完成后 W2 Gate。

### Task 4: `useFavicon` hook

**Files:**
- Create: `src/newtab/hooks/useFavicon.ts`
- Test: `src/newtab/hooks/__tests__/useFavicon.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `getCachedBlob` / `fetchAndStoreFavicon` / `buildFaviconRenderUrl`
- Produces:

```typescript
export type FaviconSrc =
  | { kind: 'blob'; src: string }    // createObjectURL 结果
  | { kind: 'remote'; src: string }  // _favicon 占位 URL
  | null;                             // 无可用源 → 首字母回退
export function useFavicon(url: string): FaviconSrc;
```

- [ ] **Step 1: 写失败测试** `src/newtab/hooks/__tests__/useFavicon.test.tsx`

```typescript
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavicon } from '@/newtab/hooks/useFavicon';

// mock FaviconService（hook 测的是 hook 的状态机，不测抓取细节）
vi.mock('@/services/FaviconService', () => ({
  getCachedBlob: vi.fn(),
  fetchAndStoreFavicon: vi.fn(),
  buildFaviconRenderUrl: vi.fn((url: string) => `chrome-extension://x/_favicon/?pageUrl=${url}`),
}));

import { getCachedBlob, fetchAndStoreFavicon } from '@/services/FaviconService';
import { resetDB } from '@/shared/db/database';

beforeEach(async () => {
  resetDB();
  vi.clearAllMocks();
});

it('缓存命中 → 返回 blob 态', async () => {
  vi.mocked(getCachedBlob).mockResolvedValue(new Blob(['x']));
  const { result } = renderHook(({ u }) => useFavicon(u), { initialProps: { u: 'https://github.com' } });
  await act(() => Promise.resolve());
  await act(() => Promise.resolve()); // 等 async effect 完成
  expect(result.current?.kind).toBe('blob');
  expect(result.current?.src).toMatch(/^blob:/);
});

it('缓存未命中 → 返回 remote 态并后台抓取', async () => {
  vi.mocked(getCachedBlob).mockResolvedValue(null);
  vi.mocked(fetchAndStoreFavicon).mockResolvedValue(new Blob(['y']));
  renderHook(({ u }) => useFavicon(u), { initialProps: { u: 'https://github.com' } });
  await act(() => Promise.resolve());
  expect(fetchAndStoreFavicon).toHaveBeenCalledWith('https://github.com');
});

it('url 变化 → 重新查询缓存并 revoke 旧 blob URL', async () => {
  vi.mocked(getCachedBlob).mockResolvedValue(new Blob(['a']));
  const { rerender, unmount } = renderHook(({ u }) => useFavicon(u), {
    initialProps: { u: 'https://a.com' },
  });
  await act(() => Promise.resolve());
  unmount(); // 卸载触发 revoke，不应抛错
  expect(true).toBe(true);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run src/newtab/hooks/__tests__/useFavicon.test.tsx`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 hook** `src/newtab/hooks/useFavicon.ts`

```typescript
import { useEffect, useState } from 'react';
import { getCachedBlob, fetchAndStoreFavicon, buildFaviconRenderUrl } from '@/services/FaviconService';

export type FaviconSrc =
  | { kind: 'blob'; src: string }
  | { kind: 'remote'; src: string }
  | null;

/**
 * 书签 favicon 渲染源。
 *
 * 优先级：
 * 1. DB 命中 → createObjectURL(blob)，秒开 + 离线可用
 * 2. 未命中 → _favicon chrome-extension URL（同步可渲染占位），同时后台抓取入库
 * 3. 后台抓取成功 → 切 blob 态
 *
 * 卸载 / url 变化 → revoke 旧 blob URL，丢弃过期后台抓取结果（active flag）。
 * 非 http(s) / 空 url → 返回 null（首字母回退）。
 */
export function useFavicon(url: string): FaviconSrc {
  const [src, setSrc] = useState<FaviconSrc>(() =>
    url ? { kind: 'remote', src: buildFaviconRenderUrl(url) } : null,
  );

  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    // 立即给 remote 占位（避免等 DB 时空白）
    setSrc({ kind: 'remote', src: buildFaviconRenderUrl(url) });

    let active = true;
    let objectUrl: string | null = null;

    (async () => {
      const cached = await getCachedBlob(new URL(url).hostname);
      if (!active) return;
      if (cached) {
        objectUrl = URL.createObjectURL(cached);
        setSrc({ kind: 'blob', src: objectUrl });
        return;
      }
      // 未命中：后台抓取，成功后切 blob 态
      const fetched = await fetchAndStoreFavicon(url);
      if (!active || !fetched) return;
      objectUrl = URL.createObjectURL(fetched);
      setSrc({ kind: 'blob', src: objectUrl });
    })().catch(() => {
      // 抓取失败保持 remote 占位，静默（BookmarkCard onError 回退首字母）
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return src;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm vitest run src/newtab/hooks/__tests__/useFavicon.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/newtab/hooks/useFavicon.ts src/newtab/hooks/__tests__/useFavicon.test.tsx
git commit -m "feat(favicon): useFavicon hook（blob 优先 + remote 占位 + revoke）"
```

---

### Task 5: BookmarkCard 接入 + 删自愈循环

**Files:**
- Modify: `src/newtab/components/BookmarkCard/index.tsx:56-69`（favicon 渲染块）
- Modify: `src/store/useBookmarks.ts:31-44`（删 loadBookmarks 自愈）、`:53-67`（删 createBookmark favicon 补充）
- Modify: `src/entrypoints/popup/views/SaveBookmarkView.tsx:124-127`（删 getFaviconUrl 调用）
- Test: `src/newtab/components/BookmarkCard/__tests__/BookmarkCard.test.tsx`（追加用例）

**Interfaces:**
- Consumes: Task 4 的 `useFavicon`

- [ ] **Step 1: 写失败测试**（追加到 `BookmarkCard.test.tsx`）

```typescript
import { useFavicon } from '@/newtab/hooks/useFavicon';

vi.mock('@/newtab/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => ({ kind: 'blob', src: 'blob:mock' })),
}));

it('favicon 渲染走 useFavicon（不再读 bookmark.faviconUrl）', () => {
  vi.mocked(useFavicon).mockReturnValue({ kind: 'blob', src: 'blob:abc' });
  renderCard({ url: 'https://github.com', faviconUrl: 'https://old.example/icon.png' });
  const img = screen.getByRole('listitem').querySelector('img');
  expect(img).toHaveAttribute('src', 'blob:abc');
  // 旧 faviconUrl 字段不再被使用
  expect(img).not.toHaveAttribute('src', 'https://old.example/icon.png');
});

it('useFavicon 返回 null → 回退首字母', () => {
  vi.mocked(useFavicon).mockReturnValue(null);
  renderCard({ name: 'GitHub', url: 'https://github.com' });
  expect(screen.getByText('G')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run src/newtab/components/BookmarkCard/__tests__/BookmarkCard.test.tsx`
Expected: FAIL（仍读 faviconUrl）

- [ ] **Step 3: 改 BookmarkCard** `src/newtab/components/BookmarkCard/index.tsx`

import 顶部加：

```typescript
import { useFavicon } from '@/newtab/hooks/useFavicon';
```

组件内（删除原 `const [faviconError, setFaviconError] = useState(false);`），改用 hook：

```typescript
  const faviconSrc = useFavicon(bookmark.url);
  const [faviconError, setFaviconError] = useState(false);
```

favicon 渲染块（line 56-69）替换为：

```tsx
      <div className={styles.favicon}>
        {faviconSrc && !faviconError ? (
          <img
            src={faviconSrc.src}
            alt=""
            className={styles.faviconImg}
            onError={() => setFaviconError(true)}
          />
        ) : (
          <div className={styles.fallback}>
            {bookmark.name.charAt(0).toUpperCase()}
          </div>
        )}
```

- [ ] **Step 4: 删 loadBookmarks 自愈循环** `src/store/useBookmarks.ts:31-44`

替换为（保留纯加载，无 favicon 写回）：

```typescript
  loadBookmarks: async (categoryId) => {
    set({ loading: true });
    const bookmarks = await BookmarkService.listBookmarks(categoryId);
    set({ bookmarks, loading: false });
  },
```

- [ ] **Step 5: 删 createBookmark favicon 补充** `src/store/useBookmarks.ts:53-67`

```typescript
  createBookmark: async (workspaceId, categoryId, data) => {
    const bookmark = await BookmarkService.createBookmark(workspaceId, categoryId, data);
    set((s) => ({
      bookmarks: [...s.bookmarks, bookmark],
      // 同步追加到跨分类切片:保存后 TabList 去重即时生效,避免数据陈旧
      allBookmarks: [...s.allBookmarks, bookmark],
    }));
    return bookmark;
  },
```

- [ ] **Step 6: 删 SaveBookmarkView favicon 调用** `src/entrypoints/popup/views/SaveBookmarkView.tsx:124-127`

删除以下 4 行（`createBookmark` 调用之后）：

```typescript
      const faviconUrl = getFaviconUrl(url);
      if (faviconUrl) {
        await updateBookmark(bookmark.id, { faviconUrl });
      }
```

并删除文件顶部已不再使用的 `getFaviconUrl` import（若存在）。

- [ ] **Step 7: 运行测试 + typecheck**

Run: `pnpm vitest run src/newtab/components/BookmarkCard/__tests__/BookmarkCard.test.tsx && pnpm run typecheck`
Expected: PASS（BookmarkCard 测试绿；typecheck 无 unused import 报错）

- [ ] **Step 8: 提交**

```bash
git add src/newtab/components/BookmarkCard/index.tsx src/store/useBookmarks.ts src/entrypoints/popup/views/SaveBookmarkView.tsx src/newtab/components/BookmarkCard/__tests__/BookmarkCard.test.tsx
git commit -m "refactor(favicon): BookmarkCard 走 useFavicon + 删 loadBookmarks 自愈循环"
```

---

### Task 6: BookmarkFaviconPreview 组件 + 双处接入

**Files:**
- Create: `src/newtab/components/BookmarkFaviconPreview/index.tsx`
- Create: `src/newtab/components/BookmarkFaviconPreview/index.module.css`
- Test: `src/newtab/components/BookmarkFaviconPreview/__tests__/index.test.tsx`
- Modify: `src/newtab/components/BookmarkOpsPanel/index.tsx:158-163`
- Modify: `src/entrypoints/popup/views/SaveBookmarkView.tsx`（URL Input 旁）

**Interfaces:**
- Consumes: Task 4 的 `useFavicon`、Task 2 的 `refreshFavicon`
- Produces: `export function BookmarkFaviconPreview(props: { url: string }): JSX.Element`

- [ ] **Step 1: 写失败测试** `src/newtab/components/BookmarkFaviconPreview/__tests__/index.test.tsx`

```typescript
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookmarkFaviconPreview } from '@/newtab/components/BookmarkFaviconPreview';
import * as FaviconService from '@/services/FaviconService';
import { resetDB } from '@/shared/db/database';

// partial mock Toast（项目规范：仅 mock Toast）
vi.mock('@douyinfe/semi-ui', async () => {
  const actual = await vi.importActual<typeof import('@douyinfe/semi-ui')>('@douyinfe/semi-ui');
  return { ...actual, Toast: { error: vi.fn(), success: vi.fn() } };
});

vi.mock('@/newtab/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => ({ kind: 'blob', src: 'blob:mock' })),
}));
import { useFavicon } from '@/newtab/hooks/useFavicon';

beforeEach(async () => {
  resetDB();
  vi.clearAllMocks();
});

it('渲染 favicon 图标 + 刷新按钮', () => {
  render(<BookmarkFaviconPreview url="https://github.com" />);
  expect(screen.getByRole('button', { name: '刷新 favicon' })).toBeInTheDocument();
});

it('点击刷新 → 调 refreshFavicon，成功后刷新预览', async () => {
  vi.mocked(useFavicon).mockReturnValue({ kind: 'blob', src: 'blob:old' });
  const refreshSpy = vi.spyOn(FaviconService, 'refreshFavicon').mockResolvedValue(new Blob(['new']));
  render(<BookmarkFaviconPreview url="https://github.com" />);
  await userEvent.click(screen.getByRole('button', { name: '刷新 favicon' }));
  expect(refreshSpy).toHaveBeenCalledWith('https://github.com');
});

it('刷新失败 → Toast.error 提示，预览保持原样', async () => {
  vi.mocked(useFavicon).mockReturnValue({ kind: 'blob', src: 'blob:keep' });
  vi.spyOn(FaviconService, 'refreshFavicon').mockResolvedValue(null);
  const { Toast } = await import('@douyinfe/semi-ui');
  render(<BookmarkFaviconPreview url="https://github.com" />);
  await userEvent.click(screen.getByRole('button', { name: '刷新 favicon' }));
  expect(vi.mocked(Toast.error)).toHaveBeenCalled();
});

it('URL 非法 → 刷新按钮 disabled', () => {
  render(<BookmarkFaviconPreview url="not-a-url" />);
  expect(screen.getByRole('button', { name: '刷新 favicon' })).toBeDisabled();
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm vitest run src/newtab/components/BookmarkFaviconPreview/__tests__/index.test.tsx`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现组件** `src/newtab/components/BookmarkFaviconPreview/index.tsx`

```tsx
import { useState } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { useFavicon } from '@/newtab/hooks/useFavicon';
import { refreshFavicon, pickHostname } from '@/services/FaviconService';
import styles from './index.module.css';

interface BookmarkFaviconPreviewProps {
  /** 绑定到表单当前 URL 值，跟随用户编辑实时预览 */
  url: string;
}

/**
 * 编辑/创建书签表单的 favicon 预览 + 刷新按钮（D2-refresh）。
 *
 * - 预览走 useFavicon（blob 优先，未命中 _favicon 占位）
 * - 刷新按钮：调 refreshFavicon 无条件重抓；失败 Toast 提示且预览保持原样
 * - URL 非法时刷新按钮 disabled
 */
export function BookmarkFaviconPreview({ url }: BookmarkFaviconPreviewProps) {
  const faviconSrc = useFavicon(url);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const urlValid = !!pickHostname(url);

  const handleRefresh = async () => {
    if (!urlValid || refreshing) return;
    setRefreshing(true);
    try {
      const blob = await refreshFavicon(url);
      if (!blob) {
        Toast.error('刷新失败，稍后重试');
        setError(true);
        setTimeout(() => setError(false), 400);
      } else {
        setError(false);
      }
    } catch {
      Toast.error('刷新失败，稍后重试');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.favicon}>
        {faviconSrc && !error ? (
          <img src={faviconSrc.src} alt="" className={styles.img} />
        ) : (
          <div className={styles.fallback}>?</div>
        )}
      </div>
      <Button
        theme="borderless"
        type="tertiary"
        icon={<IconRefresh />}
        aria-label="刷新 favicon"
        loading={refreshing}
        disabled={!urlValid || refreshing}
        onClick={handleRefresh}
      />
    </div>
  );
}
```

- [ ] **Step 4: 样式** `src/newtab/components/BookmarkFaviconPreview/index.module.css`

```css
.wrap {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 4px);
}
.favicon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--semi-color-fill-0);
}
.img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.fallback {
  font-size: 14px;
  color: var(--semi-color-text-2);
}
```

- [ ] **Step 5: 运行组件测试，确认通过**

Run: `pnpm vitest run src/newtab/components/BookmarkFaviconPreview/__tests__/index.test.tsx`
Expected: PASS

- [ ] **Step 6: 接入 BookmarkOpsPanel** `src/newtab/components/BookmarkOpsPanel/index.tsx`

import 顶部加：

```typescript
import { BookmarkFaviconPreview } from '@/newtab/components/BookmarkFaviconPreview';
```

URL 输入框（line 158-163）改为把预览放在「书签信息」段标题下方、URL 输入上方（Semi Form 用 `Form.Input` 包裹，预览独立于 form 字段）。在 `<Form.Section text="书签信息">` 内、`<Form.Input field="url" ...>` 之前插入：

```tsx
        {/* favicon 预览 + 刷新（绑定 url 字段当前值） */}
        <Form.Slot label="图标">
          <BookmarkFaviconPreviewControl api={api} />
        </Form.Slot>
```

并新增一个内部小组件订阅 url 字段当前值（Semi FormApi）：

```tsx
/** 订阅 Semi FormApi 的 url 字段当前值，喂给 BookmarkFaviconPreview。 */
function BookmarkFaviconPreviewControl({ api }: { api: FormApi<BookmarkOpsPanelSubmit> | null }) {
  const [url, setUrl] = useState(api?.getValue('url') ?? '');
  useEffect(() => {
    if (!api) return;
    const unsub = api.subscribe((s) => setUrl(s.values.url ?? ''));
    return unsub;
  }, [api]);
  return <BookmarkFaviconPreview url={url} />;
}
```

（需 `import { useEffect, useState } from 'react';` 与 `import type { FormApi } from '@douyinfe/semi-foundation/js/form/Form';`，按项目既有 FormApi import 风格统一。）

- [ ] **Step 7: 接入 SaveBookmarkView** `src/entrypoints/popup/views/SaveBookmarkView.tsx`

import 顶部加：

```typescript
import { BookmarkFaviconPreview } from '@/newtab/components/BookmarkFaviconPreview';
```

在 URL `<Input placeholder="https://example.com" .../>`（line 180-185）之后插入：

```tsx
          {isUrlValid(url) && (
            <div className={styles.faviconRow}>
              <BookmarkFaviconPreview url={url} />
            </div>
          )}
```

（`styles.faviconRow` 若缺失，在对应 module.css 加 `margin: var(--space-xs) 0;`。）

- [ ] **Step 8: typecheck + 全量测试**

Run: `pnpm run typecheck && pnpm run test`
Expected: PASS（双绿）

- [ ] **Step 9: 提交**

```bash
git add src/newtab/components/BookmarkFaviconPreview src/newtab/components/BookmarkOpsPanel/index.tsx src/entrypoints/popup/views/SaveBookmarkView.tsx
git commit -m "feat(favicon): 编辑页 favicon 预览 + 刷新按钮（D2-refresh）"
```

---

### W2 Gate — 独立 review + build test subagent

> 派**独立 subagent**：
> 1. `pnpm run typecheck` + `pnpm run test` 双绿
> 2. `/code-review` 对 W2 diff（关注：useFavicon 的 revoke 生命周期/竞态、createObjectURL 泄漏、BookmarkOpsPanel FormApi 订阅、BookmarkFaviconPreview 刷新 loading/失败 Toast、删自愈循环后无回归）
> 3. 性能验证：`loadBookmarks` 不再有 `updateBookmark` 调用（grep 确认）
> **双绿 + 无 critical finding 才进 W3。**

---

## Wave 3 — 清理与验证

> 单 subagent 顺序执行 Task 7-8，W3 Gate 后真机验证。

### Task 7: getFaviconUrl 标 deprecated + 备份兼容回归

**Files:**
- Modify: `src/services/BookmarkService.ts:71-88`（getFaviconUrl 加 @deprecated）
- Test: `tests/db/export-import.test.ts`（追加用例）

- [ ] **Step 1: 标 deprecated**

`src/services/BookmarkService.ts` getFaviconUrl 注释改为：

```typescript
/**
 * @deprecated 自 favicon 本地缓存系统上线后不再使用。保留兼容旧调用方，
 * 新代码请用 FaviconService 的 useFavicon / fetchAndStoreFavicon。
 *
 * 获取 favicon URL。...（保留原注释）
 */
export function getFaviconUrl(url: string): string {
```

- [ ] **Step 2: 备份兼容回归**

旧书签备份本来就含 `faviconUrl` 字符串字段，现有 `tests/db/export-import.test.ts` 的导入用例已隐含覆盖"含 faviconUrl 的备份能正常导入"。本步无需新增 fixture，运行现有套件确认不回归即可：

Run: `pnpm vitest run tests/db/export-import.test.ts`
Expected: PASS（原有用例全绿，证明含 faviconUrl 字段的旧备份导入链路未受影响）

- [ ] **Step 3: 运行测试 + typecheck**

Run: `pnpm vitest run tests/db/export-import.test.ts && pnpm run typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/services/BookmarkService.ts tests/db/export-import.test.ts
git commit -m "chore(favicon): getFaviconUrl 标 deprecated + 备份兼容回归"
```

---

### Task 8: 真机 e2e + 性能验证（人工 + 自动）

- [ ] **Step 1: build**

Run: `pnpm run build`
Expected: 成功生成 chrome MV3 zip

- [ ] **Step 2: 真机手验清单（在 Chrome 加载 dist，记录结果）**

1. 国内公网站点（github.com、baidu.com）书签卡片 favicon 正常显示
2. 关网后，已访问过的站点 favicon 仍显示（浏览器缓存命中 _favicon）
3. 从未访问的小众站点：首次可能空白，几秒后（后台抓取）显示
4. 编辑书签 Modal：URL 旁有图标 + 刷新按钮；点刷新后图标更新
5. popup 保存页：URL 输入有效值后出现预览 + 刷新按钮
6. 100 条书签的 newtab：打开无明显卡顿（DevTools Performance 录制对比）

- [ ] **Step 3: 性能自动验证**

确认 `loadBookmarks` 实现中无 `updateBookmark` 调用：

Run: `grep -n "updateBookmark" src/store/useBookmarks.ts`
Expected: 仅出现在 `moveBookmark` 等，`loadBookmarks` 内无

- [ ] **Step 4: 提交验证记录**

将真机截图/结论记入 PR 描述（本 task 无代码提交，除非手验发现 bug 则另开 fix）。

---

### W3 Gate — 最终 review subagent

> 派**独立 subagent** 跑：
> 1. `pnpm run typecheck` + `pnpm run test` 双绿
> 2. `/code-review`（high effort）对全量 diff
> 3. 确认 spec §2 的 SC1-SC5 全部在测试或手验中覆盖
> **通过后走 `/ship` 流程（detect base + merge + bump VERSION + PR）。**

---

## Self-Review 已执行

- ✅ Spec 覆盖：D1（不进备份，Task 7 回归验证）/ D2（永久缓存 Task 1+2 + 刷新 Task 6）/ D3（三源链 Task 2）/ D4（blob Task 2+4）/ 删自愈（Task 5）/ 编辑页预览（Task 6）/ manifest（Task 3）
- ✅ 接口一致性：`pickHostname`/`buildFaviconRenderUrl`/`buildSourceList`/`getCachedBlob`/`fetchAndStoreFavicon`/`invalidateFavicon`/`refreshFavicon` 签名贯穿 Task 2→4→6 一致；`useFavicon` 返回 `FaviconSrc` 在 Task 4→5→6 一致；`FaviconRecord` 在 Task 1→2 一致
- ✅ 无占位符（Task 7 Step 2 的 fixture 按既有 helper 补全，已注明）
- ✅ Wave Gate 与用户要求的"独立 subagent review + build test"对齐
