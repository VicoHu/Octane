# Favicon Third-Party High-Resolution Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让书签和常驻标签立即显示浏览器本地 favicon，并在外网第三方高清图验证成功后异步热替换和缓存，同时保证内网地址不访问第三方。

**Architecture:** `App` 只维护一份 `openTabs`，把匹配 Tab 的 `favIconUrl` 传给 BookmarkCard 和 PinChip；`useFavicon(url, runtimeFavIconUrl)` 负责本地即时回退与第三方缓存/升级状态机。`FaviconService` 并行抓取 Icon Horse 和 DuckDuckGo，验证并规范化为 64×64 PNG，使用 30 天 TTL、24 小时失败冷却和 hostname single-flight。

**Tech Stack:** TypeScript 6、React 19、WXT Chrome MV3、Vitest 4、Testing Library、fake-indexeddb、IndexedDB/idb、Chrome Tabs/Favicon API。

---

> **2026-07-13 真机校正：** DuckDuckGo favicon 端点不返回 CORS 响应头，在不新增 host permission 的约束下无法通过 `fetch()` 读取，已从抓取链移除。Icon Horse 未命中时会返回 HTTP 200 的首字母占位图，查询参数无法让免费接口返回 404；实现改为同时请求同首字母 `.invalid` 探针，候选与探针字节完全相同时拒绝升级，保留浏览器本地 favicon。以下原始章节保留为决策演进记录，实际实现以本校正为准。

## 0. 实施边界与文件职责

### 业务文件

- `src/shared/types/index.ts`：DB v5、第三方 favicon 缓存记录类型。
- `src/shared/db/database.ts`：v4→v5 迁移，只清理可重建的 `favicons` store。
- `src/services/FaviconService.ts`：内外网分类、第三方来源、响应验证、图片规范化、TTL/冷却、single-flight、刷新。
- `src/hooks/useFavicon.ts`：本地即时来源 + 第三方异步升级状态机。
- `src/entrypoints/home/App.tsx`：唯一一次 `useOpenTabs()` 调用，向两棵子树分发。
- `src/entrypoints/home/components/Content/index.tsx`：匹配 Bookmark 对应 Tab，传入 runtime favicon。
- `src/entrypoints/home/components/Sidebar/index.tsx`：向 PinnedArea 透传 openTabs。
- `src/entrypoints/home/components/PinnedArea/index.tsx`：匹配 Pin 对应 Tab，消费 hook 的 `onError`。
- `src/entrypoints/home/components/BookmarkCard/index.tsx`：消费 runtime favicon 与 hook 的 `onError`。
- `src/components/BookmarkFaviconPreview/index.tsx`：消费 hook 的 `onError`，刷新失败保留旧图。
- `src/entrypoints/home/components/SettingsModal/sections/FaviconCacheSection.tsx`：更新缓存说明文案。

### 测试文件

- `src/shared/db/__tests__/db-migration-regression.test.ts`
- `src/services/__tests__/FaviconService.test.ts`
- `src/hooks/__tests__/useFavicon.test.tsx`
- `src/entrypoints/home/__tests__/App.broadcast.test.tsx`
- `src/entrypoints/home/components/Content/__tests__/Content.test.tsx`
- `src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx`
- `src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx`
- `src/components/BookmarkFaviconPreview/__tests__/index.test.tsx`
- `src/entrypoints/home/components/SettingsModal/sections/__tests__/FaviconCacheSection.test.tsx`

### 明确不改

- `wxt.config.ts`：不新增 favicon host permissions。
- Bookmark/PinnedTab 持久化模型和备份载荷。
- Tab URL 匹配规则 `src/shared/tabs/matchUrl.ts`。
- 遗留 `Bookmark.faviconUrl` 字段。

---

## Task 1: 安装依赖并记录基线

**Files:** 无业务文件修改。

- [ ] **Step 1: 安装锁定依赖**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit 0，`node_modules/.bin/vitest` 存在，`pnpm-lock.yaml` 无变化。

- [ ] **Step 2: 运行现有 favicon 相关测试**

Run:

```bash
pnpm exec vitest run \
  src/services/__tests__/FaviconService.test.ts \
  src/hooks/__tests__/useFavicon.test.tsx \
  src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx \
  src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx
```

Expected: 当前基线通过；若已有失败，记录具体测试名和错误，不在本步骤顺手修改。

- [ ] **Step 3: 确认 worktree 只包含已提交设计/计划**

Run:

```bash
git status --short
```

Expected: 实施前工作区干净；本 Task 不提交。

---

## Task 2: DB v5 与可信第三方缓存模型

**Files:**
- Modify: `src/shared/types/index.ts:97-110`
- Modify: `src/shared/db/database.ts:63-116`
- Modify: `src/shared/db/__tests__/db-migration-regression.test.ts`

- [ ] **Step 1: 写 v4→v5 失败测试**

在迁移测试中新增 `seedV4Database()`：创建当前 7 个 store，写入 workspace、bookmark、pinnedTab 和一条旧格式 favicon。新增断言：升级后业务数据保留、旧 favicon 被清空、favicons store 仍可写新格式记录。

```ts
it('v4→v5：保留业务数据，只清空旧 favicon 缓存', async () => {
  await seedV4Database();

  const db = await getDB();

  expect(DB_VERSION).toBe(5);
  expect(await db.get('workspaces', 'ws-v4')).toMatchObject({ id: 'ws-v4' });
  expect(await db.get('bookmarks', 'bm-v4')).toMatchObject({ id: 'bm-v4' });
  expect(await db.get('pinnedTabs', 'pin-v4')).toMatchObject({ id: 'pin-v4' });
  expect(await db.get('favicons', 'legacy.example.com')).toBeUndefined();

  await db.put('favicons', {
    hostname: 'example.com',
    blob: new Blob(['png'], { type: 'image/png' }),
    source: 'icon-horse',
    mimeType: 'image/png',
    width: 64,
    height: 64,
    fetchedAt: 10,
    expiresAt: 20,
  });
  expect(await db.get('favicons', 'example.com')).toMatchObject({
    hostname: 'example.com',
    source: 'icon-horse',
  });
});
```

同时更新既有迁移断言：

```ts
expect(DB_VERSION).toBe(5);
expect(await db.get('favicons', 'example.com')).toBeUndefined();
```

原 v3→v4 用例改名为 v3→v5：workspaces/categories/bookmarks/contexts/cryptoMetadata 必须保留，新增 pinnedTabs store 必须可用，但旧 favicon 属于可重建缓存，预期被清空。同步修改文件顶部注释和 describe 文案，禁止继续断言‘既有 6 表数据零丢失’。

- [ ] **Step 2: 运行迁移测试确认失败**

Run:

```bash
pnpm exec vitest run src/shared/db/__tests__/db-migration-regression.test.ts
```

Expected: FAIL，至少包含 `expected 4 to be 5` 或旧 favicon 未清空。

- [ ] **Step 3: 实现缓存类型和 v5 迁移**

把类型调整为：

```ts
export const DB_VERSION = 5;

export type ThirdPartyFaviconSource = 'icon-horse' | 'duckduckgo';

export interface FaviconRecord {
  hostname: string;
  blob?: Blob;
  source?: ThirdPartyFaviconSource;
  mimeType?: string;
  width?: number;
  height?: number;
  fetchedAt?: number;
  expiresAt?: number;
  thirdPartyRetryAt?: number;
}
```

在 `runUpgrade()` 中用显式 v5 门控重建 favicon store：

```ts
if (oldVersion < 5 && db.objectStoreNames.contains('favicons')) {
  db.deleteObjectStore('favicons');
}
if (!db.objectStoreNames.contains('favicons')) {
  db.createObjectStore('favicons', { keyPath: 'hostname' });
}
```

保持 pinnedTabs 的 v4 迁移逻辑不变。

- [ ] **Step 4: 运行迁移测试**

Run:

```bash
pnpm exec vitest run src/shared/db/__tests__/db-migration-regression.test.ts
```

Expected: PASS；控制台只允许既有 v1→v2 notes 删除警告。

- [ ] **Step 5: 更新全新安装和跨版本用例文案**

全新安装断言改为‘v5：7 个 store 齐备’；v1 跨版本用例改为 v1→v5，并断言 favicons store 存在但为空。

- [ ] **Step 6: 类型检查受影响文件**

Run:

```bash
pnpm run typecheck
```

Expected: PASS。若旧测试构造 `FaviconRecord`，原字段仍兼容，不需要批量修改无关 fixture。

- [ ] **Step 7: 提交**

```bash
git add src/shared/types/index.ts src/shared/db/database.ts src/shared/db/__tests__/db-migration-regression.test.ts
git commit -m "feat(favicon): 重建可信第三方缓存模型"
```

---

## Task 3: 内外网分类、来源构造与缓存状态

**Files:**
- Modify: `src/services/FaviconService.ts`
- Modify: `src/services/__tests__/FaviconService.test.ts`

- [ ] **Step 1: 写 URL 分类失败测试**

新增表驱动测试：

```ts
describe('isPrivateFaviconTarget', () => {
  it.each([
    'http://localhost:3000',
    'http://app.local',
    'http://127.0.0.1',
    'http://10.0.0.2',
    'http://172.16.0.2',
    'http://172.31.255.254',
    'http://192.168.1.2',
    'http://169.254.1.2',
    'http://[::1]',
    'http://[fc00::1]',
    'http://[fe80::1]',
  ])('%s 是内网目标', (url) => {
    expect(isPrivateFaviconTarget(url)).toBe(true);
  });

  it.each([
    'https://chatgpt.com',
    'https://platform.deepseek.com',
    'https://8.8.8.8',
    'https://example.com',
  ])('%s 是外网目标', (url) => {
    expect(isPrivateFaviconTarget(url)).toBe(false);
  });
});
```

- [ ] **Step 2: 写第三方来源构造失败测试**

```ts
it('只返回 Icon Horse 与 DuckDuckGo，Icon Horse 使用无图 404 参数', () => {
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
```

明确删除旧测试对 Chrome `_favicon` 和 `${origin}/favicon.ico` 抓取源的期望；`buildFaviconRenderUrl()` 测试保留，因为它仍是本地渲染源。

- [ ] **Step 3: 写缓存状态失败测试**

固定 `now = 1_000_000`，覆盖 fresh、stale、cooldown：

```ts
expect(classifyCacheRecord(undefined, now)).toEqual({
  blob: null,
  stale: false,
  canRefresh: true,
});

expect(classifyCacheRecord({
  hostname: 'a.com',
  blob,
  source: 'icon-horse',
  expiresAt: now + 1,
}, now)).toMatchObject({ blob, stale: false, canRefresh: false });

expect(classifyCacheRecord({
  hostname: 'a.com',
  blob,
  source: 'icon-horse',
  expiresAt: now - 1,
}, now)).toMatchObject({ blob, stale: true, canRefresh: true });

expect(classifyCacheRecord({
  hostname: 'a.com',
  thirdPartyRetryAt: now + 1,
}, now)).toMatchObject({ blob: null, stale: false, canRefresh: false });
```

- [ ] **Step 4: 运行测试确认失败**

Run:

```bash
pnpm exec vitest run src/services/__tests__/FaviconService.test.ts
```

Expected: FAIL，导出函数不存在或旧 source list 断言失败。

- [ ] **Step 5: 实现纯函数与常量**

在 `FaviconService.ts` 增加：

```ts
export const THIRD_PARTY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const THIRD_PARTY_RETRY_MS = 24 * 60 * 60 * 1000;
export const THIRD_PARTY_TIMEOUT_MS = 3000;

export interface ThirdPartySourceRequest {
  source: ThirdPartyFaviconSource;
  url: string;
}

export interface FaviconCacheState {
  blob: Blob | null;
  stale: boolean;
  canRefresh: boolean;
  record?: FaviconRecord;
}
```

实现 `isPrivateFaviconTarget()` 时：

- 先 `new URL()`；非法 URL 返回 true，避免对不可信字符串访问第三方；
- IPv4 解析为四段数字后做 CIDR 范围判断，不仅使用字符串前缀；
- IPv6 hostname 去掉 `[`/`]` 后按 `::1`、`fc`/`fd`、`fe8`–`feb` 判断；
- `localhost`、`*.localhost`、`*.local` 返回 true。

实现：

```ts
export function buildThirdPartySources(url: string): ThirdPartySourceRequest[];
export function classifyCacheRecord(
  record: FaviconRecord | undefined,
  now = Date.now(),
): FaviconCacheState;
export async function getThirdPartyCache(
  hostname: string,
  now = Date.now(),
): Promise<FaviconCacheState>;
```

`classifyCacheRecord()` 规则：

```ts
const hasTrustedBlob = !!record?.blob && !!record.source && !!record.expiresAt;
const stale = hasTrustedBlob && record.expiresAt! <= now;
const inCooldown = (record?.thirdPartyRetryAt ?? 0) > now;
return {
  blob: hasTrustedBlob ? record.blob! : null,
  stale,
  canRefresh: !inCooldown && (!hasTrustedBlob || stale),
  record,
};
```

- [ ] **Step 6: 运行 service 测试**

Run:

```bash
pnpm exec vitest run src/services/__tests__/FaviconService.test.ts
```

Expected: 本 Task 新增纯函数测试 PASS；抓取旧测试可暂时保留，Task 4 统一替换。

- [ ] **Step 7: 提交**

```bash
git add src/services/FaviconService.ts src/services/__tests__/FaviconService.test.ts
git commit -m "feat(favicon): 增加内网隔离与缓存状态"
```

---

## Task 4: 第三方图片验证、并行选优、缓存与 single-flight

**Files:**
- Modify: `src/services/FaviconService.ts`
- Modify: `src/services/__tests__/FaviconService.test.ts`

- [ ] **Step 1: 写规范化与选优失败测试**

为测试提供可控解码器，生产函数接受可选 adapter，默认使用真实 Canvas 实现：

```ts
export interface NormalizedFavicon {
  blob: Blob;
  width: 64;
  height: 64;
  originalMinSize: number;
  vector: boolean;
}

export type FaviconNormalizer = (blob: Blob) => Promise<NormalizedFavicon | null>;
```

新增测试：

```ts
it('两个源并行成功时选择 SVG，再规范化为 64x64 PNG', async () => {
  fetchMock
    .mockResolvedValueOnce(imageResponse('horse-raster', 'image/png'))
    .mockResolvedValueOnce(imageResponse('<svg/>', 'image/svg+xml'));

  const normalize = vi.fn(async (blob: Blob) =>
    blob.type.includes('svg')
      ? { blob: new Blob(['duck-png'], { type: 'image/png' }), width: 64, height: 64, originalMinSize: 64, vector: true }
      : { blob: new Blob(['horse-png'], { type: 'image/png' }), width: 64, height: 64, originalMinSize: 128, vector: false },
  );

  const result = await fetchBestThirdPartyFavicon('https://example.com', {
    normalize,
    now: 100,
    force: true,
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result?.source).toBe('duckduckgo');
  expect(result?.blob.type).toBe('image/png');
});
```

再覆盖：

- 一个 CORS reject、另一个成功；
- 两个栅格候选选 `originalMinSize` 大者；
- 同分时 Icon Horse 优先；
- 低于 32px、空 Blob、不可解码均拒绝；
- 两源失败写 24h cooldown；
- 失败不覆盖旧成功 Blob；
- `force: true` 忽略 cooldown；
- 内网 URL 不调用 fetch。

- [ ] **Step 2: 写 single-flight 失败测试**

```ts
it('同 hostname 并发只执行一组两源 fetch', async () => {
  const p1 = fetchBestThirdPartyFavicon('https://example.com/a', { normalize, force: true });
  const p2 = fetchBestThirdPartyFavicon('https://example.com/b', { normalize, force: true });

  expect(p1).toBe(p2);
  await Promise.all([p1, p2]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
```

若 async wrapper 导致 Promise identity 无法直接比较，则只断言 fetch 次数为 2，不强制 `p1 === p2`。

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
pnpm exec vitest run src/services/__tests__/FaviconService.test.ts
```

Expected: FAIL，`fetchBestThirdPartyFavicon` / normalizer API 尚不存在。

- [ ] **Step 4: 实现真实图片规范化**

新增：

```ts
export async function normalizeFaviconBlob(blob: Blob): Promise<NormalizedFavicon | null>;
```

实现顺序：

1. 拒绝空 Blob；
2. 用 Blob MIME 和 SVG 文本头判断 vector；
3. `URL.createObjectURL(blob)`；
4. `new Image()`，等待 `onload`/`onerror`；
5. 栅格图 `Math.min(naturalWidth, naturalHeight) < 32` 返回 null；SVG 不受该阈值限制；
6. 创建 64×64 canvas，按比例居中绘制；
7. `canvas.toBlob(..., 'image/png')`；
8. `finally` revoke 临时 Blob URL；
9. 任一步失败返回 null。

居中尺寸计算使用：

```ts
const scale = Math.min(64 / img.naturalWidth, 64 / img.naturalHeight);
const width = Math.max(1, Math.round(img.naturalWidth * scale));
const height = Math.max(1, Math.round(img.naturalHeight * scale));
const x = Math.floor((64 - width) / 2);
const y = Math.floor((64 - height) / 2);
ctx.drawImage(img, x, y, width, height);
```

- [ ] **Step 5: 实现并行抓取和质量选择**

定义：

```ts
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
```

核心流程：

```ts
const settled = await Promise.allSettled(
  buildThirdPartySources(url).map(async ({ source, url: sourceUrl }) => {
    const response = await fetchWithTimeout(sourceUrl, THIRD_PARTY_TIMEOUT_MS);
    const normalized = await normalize(await response.blob());
    return normalized ? { source, ...normalized } : null;
  }),
);
```

过滤 fulfilled 非 null 后按以下排序：

```ts
candidates.sort((a, b) => {
  if (a.vector !== b.vector) return a.vector ? -1 : 1;
  if (a.originalMinSize !== b.originalMinSize) return b.originalMinSize - a.originalMinSize;
  return a.source === 'icon-horse' ? -1 : 1;
});
```

成功写入：

```ts
await putRecord('favicons', {
  hostname,
  blob: best.blob,
  source: best.source,
  mimeType: 'image/png',
  width: 64,
  height: 64,
  fetchedAt: now,
  expiresAt: now + THIRD_PARTY_TTL_MS,
});
```

失败保留旧记录，只更新：

```ts
await putRecord('favicons', {
  ...existing,
  hostname,
  thirdPartyRetryAt: now + THIRD_PARTY_RETRY_MS,
});
```

- [ ] **Step 6: 实现 single-flight 与刷新语义**

模块级：

```ts
const inFlight = new Map<string, Promise<ThirdPartyFaviconResult | null>>();
```

`fetchBestThirdPartyFavicon()`：

- 非法/内网返回 null；
- 非 force 时尊重 fresh cache 与 cooldown；
- 相同 hostname 已有 Promise 时直接返回；
- `finally` 删除 Map 项。

`refreshFavicon(url)` 改为：

```ts
export async function refreshFavicon(url: string): Promise<Blob | null> {
  const result = await fetchBestThirdPartyFavicon(url, { force: true });
  return result?.blob ?? null;
}
```

不得先 `invalidateFavicon()`，保证刷新失败仍保留旧成功缓存。

- [ ] **Step 7: 运行 service 测试**

Run:

```bash
pnpm exec vitest run src/services/__tests__/FaviconService.test.ts
```

Expected: PASS；旧“四源串行”测试已替换为“两源并行 + 本地不参与 fetch”的测试。

- [ ] **Step 8: 提交**

```bash
git add src/services/FaviconService.ts src/services/__tests__/FaviconService.test.ts
git commit -m "feat(favicon): 并行抓取并缓存高清候选"
```

---

## Task 5: useFavicon 本地即时显示与异步升级状态机

**Files:**
- Modify: `src/hooks/useFavicon.ts`
- Modify: `src/hooks/__tests__/useFavicon.test.tsx`

- [ ] **Step 1: 重写 hook mock 契约并写失败测试**

Service mock 改为：

```ts
vi.mock('@/services/FaviconService', () => ({
  pickHostname: (url: string) => {
    try { return new URL(url).hostname; } catch { return null; }
  },
  buildFaviconRenderUrl: (url: string) =>
    `chrome-extension://x/_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`,
  isPrivateFaviconTarget: vi.fn(() => false),
  getThirdPartyCache: vi.fn(),
  fetchBestThirdPartyFavicon: vi.fn(),
  invalidateFavicon: vi.fn(),
}));
```

新增核心测试：

```ts
it('有 runtime favicon 时首帧立即返回 tab，不等待 DB', () => {
  vi.mocked(getThirdPartyCache).mockResolvedValue({ blob: null, stale: false, canRefresh: true });
  vi.mocked(fetchBestThirdPartyFavicon).mockResolvedValue(null);

  const { result } = renderHook(() =>
    useFavicon('https://chatgpt.com', 'https://chatgpt.com/favicon.svg'),
  );

  expect(result.current?.kind).toBe('tab');
  expect(result.current?.src).toBe('https://chatgpt.com/favicon.svg');
});
```

再覆盖：

- 无 runtime → 首帧 Chrome `_favicon`；
- fresh cache → 切 third-party Blob；
- stale cache → 先显示旧 Blob并调用后台刷新；
- 无缓存、后台成功 → tab/Chrome 热切换 third-party；
- 后台失败 → 保持本地；
- 内网 → 不调用 `fetchBestThirdPartyFavicon`；
- tab onError → Chrome；Chrome onError → null；third-party onError → invalidate 后回到本地；
- runtime favicon prop 后出现 → 从 Chrome 切到 tab；
- URL 变化/卸载 revoke 当前 hook 创建的 Blob URL。

- [ ] **Step 2: 运行 hook 测试确认失败**

Run:

```bash
pnpm exec vitest run src/hooks/__tests__/useFavicon.test.tsx
```

Expected: FAIL，hook 仍是旧签名/旧 kind。

- [ ] **Step 3: 实现新返回类型**

```ts
export interface FaviconRenderSource {
  kind: 'third-party' | 'tab' | 'chrome';
  src: string;
  onError: () => void;
}

export function useFavicon(
  url: string,
  runtimeFavIconUrl?: string,
): FaviconRenderSource | null;
```

hook 内部维护：

```ts
type ActiveKind = 'third-party' | 'tab' | 'chrome' | 'none';
const [activeKind, setActiveKind] = useState<ActiveKind>(() =>
  validRuntime ? 'tab' : validUrl ? 'chrome' : 'none',
);
const [thirdPartyObjectUrl, setThirdPartyObjectUrl] = useState<string | null>(null);
```

runtime URL 只接受现有安全 scheme：`https://`、`http://`、`chrome-extension://`、`data:image/`。把 `isSafeFavIcon` 从 Home TabList 路径移动或复制为共享纯函数 `src/shared/tabs/safeFavIcon.ts`，TabList 与 hook 共用；同步更新其测试 import。

- [ ] **Step 4: 实现 effect 和 onError**

Effect：

1. URL/runtime 变化时立即选择 tab 或 Chrome；
2. `getThirdPartyCache(hostname)`；
3. blob 命中则创建 object URL 并切 third-party；
4. 外网且 `canRefresh` 时调用 `fetchBestThirdPartyFavicon(url)`；
5. 新结果存在则创建 object URL、替换旧 object URL、切 third-party；
6. cleanup 设置 active=false 并 revoke。

`onError` 使用 `useCallback`：

```ts
if (activeKind === 'third-party') {
  void invalidateFavicon(hostname);
  setActiveKind(validRuntime ? 'tab' : 'chrome');
} else if (activeKind === 'tab') {
  setActiveKind('chrome');
} else if (activeKind === 'chrome') {
  setActiveKind('none');
}
```

返回 source：

```ts
if (activeKind === 'third-party' && thirdPartyObjectUrl) {
  return { kind: 'third-party', src: thirdPartyObjectUrl, onError };
}
if (activeKind === 'tab' && validRuntime) {
  return { kind: 'tab', src: runtimeFavIconUrl!, onError };
}
if (activeKind === 'chrome' && validUrl) {
  return { kind: 'chrome', src: buildFaviconRenderUrl(url), onError };
}
return null;
```

- [ ] **Step 5: 删除旧抓取 API**

所有 hook 调用迁移后，从 `FaviconService.ts` 删除旧 `buildSourceList()`、`getCachedBlob()`、`fetchAndStoreFavicon()` 以及对应四源串行测试；保留 `buildFaviconRenderUrl()`、`invalidateFavicon()`、`refreshFavicon()`、`clearAllFavicons()`。确认 `rg -n "buildSourceList|getCachedBlob|fetchAndStoreFavicon" src` 无生产调用。

- [ ] **Step 6: 运行 hook 与安全 URL 测试**

Run:

```bash
pnpm exec vitest run \
  src/hooks/__tests__/useFavicon.test.tsx \
  src/entrypoints/home/components/TabList/__tests__/safeFavIcon.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add \
  src/services/FaviconService.ts \
  src/services/__tests__/FaviconService.test.ts \
  src/hooks/useFavicon.ts \
  src/hooks/__tests__/useFavicon.test.tsx \
  src/shared/tabs/safeFavIcon.ts \
  src/entrypoints/home/components/TabList/safeFavIcon.ts \
  src/entrypoints/home/components/TabList/index.tsx \
  src/entrypoints/home/components/TabList/__tests__/safeFavIcon.test.ts
git commit -m "feat(favicon): 本地即时显示并异步升级"
```

如果旧 `TabList/safeFavIcon.ts` 被删除，`git add` 使用实际存在路径并确认 `git status --short` 显示 rename/delete 正确。

---

## Task 6: BookmarkCard、PinChip 与预览统一错误回退

**Files:**
- Modify: `src/entrypoints/home/components/BookmarkCard/index.tsx`
- Modify: `src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx`
- Modify: `src/entrypoints/home/components/PinnedArea/index.tsx`
- Modify: `src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx`
- Modify: `src/components/BookmarkFaviconPreview/index.tsx`
- Modify: `src/components/BookmarkFaviconPreview/__tests__/index.test.tsx`

- [ ] **Step 1: 写 BookmarkCard runtime favicon 失败测试**

给 props 增加：

```ts
runtimeFavIconUrl?: string;
```

测试：

```ts
it('把匹配 Tab favicon 传给 hook，并使用 hook onError', async () => {
  const onError = vi.fn();
  vi.mocked(useFavicon).mockReturnValue({
    kind: 'tab',
    src: 'https://example.com/runtime.svg',
    onError,
  });

  renderCard({}, {}, true, 'https://example.com/runtime.svg');

  expect(useFavicon).toHaveBeenCalledWith(
    'https://github.com/page',
    'https://example.com/runtime.svg',
  );
  fireEvent.error(screen.getByRole('listitem').querySelector('img')!);
  expect(onError).toHaveBeenCalledTimes(1);
});
```

这里错误事件可继续用 `fireEvent.error`，因为 user-event 没有图片加载失败 API；普通点击交互继续遵循 userEvent。

删除组件自己的 `faviconError` state 和“src 变化重置 error”测试；错误链职责已移入 hook。

- [ ] **Step 2: 写 PinChip 破图回退失败测试**

PinnedArea 测试让 hook 返回可控 source：

```ts
const faviconOnError = vi.fn();
vi.mocked(useFavicon).mockReturnValue({
  kind: 'tab',
  src: 'https://example.com/icon.svg',
  onError: faviconOnError,
});
```

渲染 pin 后：

```ts
const chip = await screen.findByRole('button', { name: /打开 GitHub/ });
fireEvent.error(chip.querySelector('img')!);
expect(faviconOnError).toHaveBeenCalledTimes(1);
```

再让 mock 返回 null 并 rerender，断言首字母 `G` 出现。

- [ ] **Step 3: 写预览 onError 与刷新保留测试**

```ts
it('图片失败调用 hook onError', () => {
  const onError = vi.fn();
  vi.mocked(useFavicon).mockReturnValue({ kind: 'chrome', src: 'chrome-url', onError });
  render(<BookmarkFaviconPreview url="https://example.com" />);
  fireEvent.error(screen.getByRole('img', { hidden: true }));
  expect(onError).toHaveBeenCalledTimes(1);
});
```

若空 alt 无法通过 role 稳定查询，使用组件容器内 `querySelector('img')`，不要新增仅测试使用的 testid。

保留“刷新失败 Toast.error”，并增加断言刷新失败后旧图片 `src` 不变。

- [ ] **Step 4: 运行组件测试确认失败**

Run:

```bash
pnpm exec vitest run \
  src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx \
  src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx \
  src/components/BookmarkFaviconPreview/__tests__/index.test.tsx
```

Expected: FAIL，组件尚未使用新 onError/runtime 参数。

- [ ] **Step 5: 修改三个消费者**

BookmarkCard：

```ts
const faviconSrc = useFavicon(bookmark.url, runtimeFavIconUrl);
```

渲染：

```tsx
{faviconSrc ? (
  <img
    src={faviconSrc.src}
    alt=""
    className={styles.faviconImg}
    onError={faviconSrc.onError}
  />
) : (
  <div className={styles.fallback}>{bookmark.name.charAt(0).toUpperCase()}</div>
)}
```

PinChip：

```ts
const faviconSrc = useFavicon(pin.url, runtimeFavIconUrl);
```

并把 `<img>` 加上：

```tsx
onError={faviconSrc.onError}
```

BookmarkFaviconPreview：

```tsx
<img
  src={imgSrc}
  alt=""
  className={styles.img}
  onError={overrideSrc ? undefined : faviconSrc?.onError}
/>
```

手动刷新 override Blob 自身失败时清空 override，回到 hook 来源；实现一个独立 handler，不吞掉破图。

- [ ] **Step 6: 运行组件测试**

Run:

```bash
pnpm exec vitest run \
  src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx \
  src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx \
  src/components/BookmarkFaviconPreview/__tests__/index.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add \
  src/entrypoints/home/components/BookmarkCard/index.tsx \
  src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx \
  src/entrypoints/home/components/PinnedArea/index.tsx \
  src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx \
  src/components/BookmarkFaviconPreview/index.tsx \
  src/components/BookmarkFaviconPreview/__tests__/index.test.tsx
git commit -m "fix(favicon): 统一书签与常驻标签错误回退"
```

---

## Task 7: 提升 useOpenTabs 并向书签/常驻标签分发 runtime favicon

**Files:**
- Modify: `src/entrypoints/home/App.tsx`
- Modify: `src/entrypoints/home/__tests__/App.broadcast.test.tsx`
- Modify: `src/entrypoints/home/components/Content/index.tsx`
- Modify: `src/entrypoints/home/components/Content/__tests__/Content.test.tsx`
- Modify: `src/entrypoints/home/components/Sidebar/index.tsx`
- Modify: Sidebar 现有测试 render helper
- Modify: `src/entrypoints/home/components/PinnedArea/index.tsx`
- Modify: `src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx`

- [ ] **Step 1: 写 App 单实例 openTabs 分发失败测试**

在 `App.broadcast.test.tsx` 增加可控 hook 和子组件 props 捕获：

```ts
const appMocks = vi.hoisted(() => {
  const openTabs = [{
    url: 'https://example.com',
    tabId: 1,
    lastAccessed: 10,
    favIconUrl: 'https://example.com/icon.svg',
  }];
  return {
    openTabs,
    useOpenTabs: vi.fn(() => openTabs),
    sidebarSpy: vi.fn(),
    contentSpy: vi.fn(),
  };
});

vi.mock('../hooks/useOpenTabs', () => ({ useOpenTabs: appMocks.useOpenTabs }));
vi.mock('../components/Sidebar', () => ({
  Sidebar: (props: unknown) => { appMocks.sidebarSpy(props); return null; },
}));
vi.mock('../components/Content', () => ({
  Content: (props: unknown) => { appMocks.contentSpy(props); return null; },
}));
```

新增：

```ts
it('只查询一次 openTabs，并把同一数组传给 Sidebar 与 Content', () => {
  render(<App />);
  expect(appMocks.useOpenTabs).toHaveBeenCalledTimes(1);
  expect(appMocks.sidebarSpy).toHaveBeenLastCalledWith({ openTabs: appMocks.openTabs });
  expect(appMocks.contentSpy).toHaveBeenLastCalledWith({ openTabs: appMocks.openTabs });
});
```

- [ ] **Step 2: 写 Content 匹配 favicon 失败测试**

Content 改为显式 props：

```ts
interface ContentProps {
  openTabs: OpenTab[];
}
```

测试渲染时传入：

```ts
const openTabs: OpenTab[] = [{
  url: 'https://github.com/page/sub',
  tabId: 7,
  lastAccessed: 100,
  favIconUrl: 'https://github.com/runtime.svg',
}];
render(<Content openTabs={openTabs} />);
```

在 BookmarkCard mock/断言中确认：

```ts
expect(bookmarkCardSpy).toHaveBeenCalledWith(
  expect.objectContaining({
    hasOpenTab: true,
    runtimeFavIconUrl: 'https://github.com/runtime.svg',
  }),
);
```

如果 Content 测试真实渲染 BookmarkCard，则 mock `useFavicon` 并断言它收到 runtime URL，不整体 mock Semi。

- [ ] **Step 3: 写 PinnedArea 匹配 favicon 失败测试**

给 PinnedArea props 增加 `openTabs`，测试：

```ts
renderArea({
  openTabs: [{
    url: 'https://github.com/settings',
    tabId: 9,
    lastAccessed: 200,
    favIconUrl: 'https://github.com/runtime.svg',
  }],
});

await screen.findByRole('button', { name: /打开 GitHub/ });
expect(useFavicon).toHaveBeenCalledWith(
  'https://github.com',
  'https://github.com/runtime.svg',
);
```

- [ ] **Step 4: 运行集成测试确认失败**

Run:

```bash
pnpm exec vitest run \
  src/entrypoints/home/__tests__/App.broadcast.test.tsx \
  src/entrypoints/home/components/Content/__tests__/Content.test.tsx \
  src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx
```

Expected: FAIL，props 尚不存在且 App 尚未调用 hook。

- [ ] **Step 5: 实现 App 提升**

`App.tsx`：

```ts
import { useOpenTabs } from './hooks/useOpenTabs';

const openTabs = useOpenTabs();
```

渲染：

```tsx
<Sidebar openTabs={openTabs} />
<Content openTabs={openTabs} />
```

删除 Content 内部：

```ts
const openTabs = useOpenTabs();
```

- [ ] **Step 6: 实现 Bookmark 匹配传参**

Content map 中只计算一次匹配结果：

```tsx
{filteredBookmarks.map((bookmark) => {
  const matchedTab = pickMostRecentMatchingTab(openTabs, bookmark.url);
  return (
    <BookmarkCard
      key={bookmark.id}
      bookmark={bookmark}
      hasOpenTab={!!matchedTab}
      runtimeFavIconUrl={matchedTab?.favIconUrl}
      onClick={handleCardClick}
      onViewContexts={handleViewContexts}
      onEditBookmark={handleEditBookmark}
      onDelete={handleDeleteBookmark}
    />
  );
})}
```

- [ ] **Step 7: 实现 Sidebar/PinnedArea 透传和匹配**

Sidebar：

```ts
interface SidebarProps {
  openTabs: OpenTab[];
}
```

```tsx
{currentWorkspaceId && (
  <PinnedArea workspaceId={currentWorkspaceId} openTabs={openTabs} />
)}
```

PinnedArea map：

```tsx
{pinnedTabs.map((pin) => {
  const matchedTab = pickMostRecentMatchingTab(openTabs, pin.url);
  return (
    <PinChip
      key={pin.id}
      pin={pin}
      runtimeFavIconUrl={matchedTab?.favIconUrl}
      onDelete={() => handleDelete(pin.id)}
    />
  );
})}
```

- [ ] **Step 8: 更新所有 Sidebar/Content 测试 render helper**

默认使用：

```ts
const emptyOpenTabs: OpenTab[] = [];
render(<Sidebar openTabs={emptyOpenTabs} />);
render(<Content openTabs={emptyOpenTabs} />);
```

不要把 `openTabs` 改为可选 props；生产入口必须显式提供，防止以后重新出现两套 Tab 数据源。

- [ ] **Step 9: 运行集成测试与 typecheck**

Run:

```bash
pnpm exec vitest run \
  src/entrypoints/home/__tests__/App.broadcast.test.tsx \
  src/entrypoints/home/components/Content/__tests__/Content.test.tsx \
  src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx \
  src/entrypoints/home/components/Sidebar/__tests__/category.test.tsx \
  src/entrypoints/home/components/Sidebar/__tests__/settings-entry.test.tsx
pnpm run typecheck
```

Expected: 全部 PASS。

- [ ] **Step 10: 提交**

```bash
git add \
  src/entrypoints/home/App.tsx \
  src/entrypoints/home/__tests__/App.broadcast.test.tsx \
  src/entrypoints/home/components/Content/index.tsx \
  src/entrypoints/home/components/Content/__tests__/Content.test.tsx \
  src/entrypoints/home/components/Sidebar/index.tsx \
  src/entrypoints/home/components/Sidebar/__tests__/category.test.tsx \
  src/entrypoints/home/components/Sidebar/__tests__/settings-entry.test.tsx \
  src/entrypoints/home/components/PinnedArea/index.tsx \
  src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx
git commit -m "feat(favicon): 复用打开标签页运行时图标"
```

---

## Task 8: 缓存管理文案、刷新回归与兼容清理

**Files:**
- Modify: `src/entrypoints/home/components/SettingsModal/sections/FaviconCacheSection.tsx`
- Modify: `src/entrypoints/home/components/SettingsModal/sections/__tests__/FaviconCacheSection.test.tsx`
- Modify: `src/services/__tests__/FaviconService.test.ts`
- Modify if required by typecheck: `src/entrypoints/sidepanel/components/StickyHeader.tsx`

- [ ] **Step 1: 写设置文案失败测试**

更新断言为：

```ts
expect(screen.getByText(/仅清除第三方高清图标缓存/)).toBeInTheDocument();
expect(screen.getByText(/浏览器本地图标仍可立即显示/)).toBeInTheDocument();
```

成功 Toast 改为：

```ts
expect(vi.mocked(Toast.success)).toHaveBeenCalledWith(
  '已清空第三方 favicon 缓存，将在后台重新获取高清图标',
);
```

- [ ] **Step 2: 补充刷新不破坏旧缓存的 service 回归测试**

```ts
it('手动刷新失败保留旧成功 Blob', async () => {
  const old = new Blob(['old'], { type: 'image/png' });
  await putRecord('favicons', {
    hostname: 'example.com',
    blob: old,
    source: 'icon-horse',
    mimeType: 'image/png',
    width: 64,
    height: 64,
    fetchedAt: 1,
    expiresAt: 2,
  });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('CORS')));

  expect(await refreshFavicon('https://example.com')).toBeNull();
  expect((await getByKey<FaviconRecord>('favicons', 'example.com'))?.blob).toBeTruthy();
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
pnpm exec vitest run \
  src/entrypoints/home/components/SettingsModal/sections/__tests__/FaviconCacheSection.test.tsx \
  src/services/__tests__/FaviconService.test.ts
```

Expected: 文案断言 FAIL；若 Task 4 已正确实现刷新保留，service 回归应直接 PASS。

- [ ] **Step 4: 更新设置文案和 Toast**

说明必须准确表达：

```text
仅清除第三方高清图标缓存。书签和常驻标签仍会立即使用浏览器本地图标，并在后台重新获取高清图标。
```

按钮 aria-label 保持“清空 favicon 缓存”，避免无必要的交互契约变化。

- [ ] **Step 5: 处理 sidepanel 编译兼容**

`StickyHeader` 继续允许：

```ts
const faviconSrc = useFavicon(`https://${hostname}`);
```

若 typecheck 要求错误处理，添加：

```tsx
onError={faviconSrc?.onError}
```

不在本 Task 扩展 sidepanel 的 runtime tab favicon 数据流。

- [ ] **Step 6: 运行相关测试与 typecheck**

Run:

```bash
pnpm exec vitest run \
  src/entrypoints/home/components/SettingsModal/sections/__tests__/FaviconCacheSection.test.tsx \
  src/services/__tests__/FaviconService.test.ts \
  src/entrypoints/sidepanel/components/__tests__/StickyHeader.test.tsx
pnpm run typecheck
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add \
  src/entrypoints/home/components/SettingsModal/sections/FaviconCacheSection.tsx \
  src/entrypoints/home/components/SettingsModal/sections/__tests__/FaviconCacheSection.test.tsx \
  src/services/__tests__/FaviconService.test.ts \
  src/entrypoints/sidepanel/components/StickyHeader.tsx
git commit -m "docs(favicon): 更新高清缓存与刷新说明"
```

只暂存实际发生变化的文件。

---

## Task 9: 全量验证与真机验收

**Files:** 仅修复本功能直接导致的失败；禁止顺手重构。

- [ ] **Step 1: 运行 favicon 聚焦测试**

```bash
pnpm exec vitest run \
  src/shared/db/__tests__/db-migration-regression.test.ts \
  src/services/__tests__/FaviconService.test.ts \
  src/hooks/__tests__/useFavicon.test.tsx \
  src/entrypoints/home/hooks/__tests__/useOpenTabs.test.ts \
  src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx \
  src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx \
  src/components/BookmarkFaviconPreview/__tests__/index.test.tsx \
  src/entrypoints/home/components/SettingsModal/sections/__tests__/FaviconCacheSection.test.tsx
```

Expected: PASS。

- [ ] **Step 2: 运行全量测试与类型检查**

```bash
pnpm run typecheck
pnpm run test
```

Expected: 双绿，0 failed。

- [ ] **Step 3: 构建 Chrome MV3 包**

```bash
pnpm run build
```

Expected: exit 0；生成 manifest 仍只有既有 cloud host permissions，没有 Icon Horse、DuckDuckGo 或 `<all_urls>`。

检查：

```bash
find .output -maxdepth 3 -name manifest.json -print -exec cat {} \;
```

Expected: `permissions` 含 `favicon`/`tabs`，`host_permissions` 不新增 favicon 域名。

- [ ] **Step 4: 真机验收 ChatGPT**

1. 在设置中清空 favicon 缓存。
2. 打开 `https://chatgpt.com`，确认浏览器 Tab 有 favicon。
3. 打开 Octane Home。
4. 确认书签/常驻标签首帧不是空白；Network 中第三方请求后台发生。
5. 第三方成功后确认图标热切换，刷新 Home 后直接命中 Blob 缓存。

Expected: 本地立即显示，第三方成功后最终使用高清缓存。

- [ ] **Step 5: 真机验收 DeepSeek 与 SVG**

对 `https://platform.deepseek.com` 重复 Step 4；在 IndexedDB `favicons` 中确认：

```text
source = icon-horse 或 duckduckgo
mimeType = image/png
width = 64
height = 64
```

Expected: SVG 候选不再被跳过，最终缓存为 64×64 PNG。

- [ ] **Step 6: 真机验收内网隐私边界**

使用 localhost 或私有 IP 书签/常驻标签：

1. 打开对应 Tab，让浏览器获取 favicon；
2. 打开 Octane Home；
3. DevTools Network 过滤 `icon.horse`、`duckduckgo`。

Expected: 图标使用 runtime `favIconUrl` 或 Chrome `_favicon`；没有任何第三方请求。

- [ ] **Step 7: 检查改动范围**

```bash
git status --short
git diff --check
git log --oneline --max-count=10
```

Expected: 工作区干净；没有 manifest host permission、备份 schema、Bookmark/PinnedTab 模型的无关修改。

- [ ] **Step 8: 处理验证阶段发现的问题**

若验证产生代码修改，回到拥有该文件的 Task，先补充能复现问题的失败测试，再运行该 Task 的聚焦测试、全量 typecheck/test，并使用该 Task 已列出的精确 `git add` 文件清单创建修复提交。若验证阶段无文件变化，不创建空提交。

---

## 完成定义

以下条件全部满足才可宣布完成：

- 设计规格 SC1–SC8 均有自动化测试或明确真机验收记录。
- 外网最终优先验证通过的第三方高清缓存。
- 内网不发送 hostname 给第三方。
- 打开 Tab 后补充的 `favIconUrl` 能更新 BookmarkCard 与 PinChip。
- Chrome `_favicon` 默认结果不进入长期缓存。
- CORS 失败不会导致空白、永久失败或覆盖旧成功缓存。
- `pnpm run typecheck`、`pnpm run test`、`pnpm run build` 全部通过。
- 当前 worktree 工作区干净。
