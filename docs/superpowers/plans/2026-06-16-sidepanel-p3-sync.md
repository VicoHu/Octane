# Side Panel P3 — BroadcastChannel 跨上下文同步 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** newtab 改书签/上下文 → side panel 自动刷新匹配（跨上下文同步，M7）。

**Architecture:** database.ts 单一收口广播 `{store, action}` 最小信号；useHostBookmarks 监听 `store==='bookmarks'` 重匹配。BroadcastChannel('octane-db') 同名实例互通信义、同实例不回环。jsdom 测试用 tests/setup.ts polyfill。

**Tech Stack:** TypeScript, React hooks, BroadcastChannel API, IndexedDB (fake-indexeddb 测试), vitest, WXT

**Spec:** `docs/superpowers/specs/2026-06-16-sidepanel-p3-sync-design.md`

---

## File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `tests/setup.ts` | 全局测试 setup | 加 BroadcastChannel polyfill（jsdom 无原生） |
| `src/shared/db/database.ts` | IndexedDB CRUD 单一收口 | 加 `dbChannel` + `broadcast` + `DbChangeEvent`；5 处广播 |
| `tests/db/database.test.ts` | database 发送方测试 | 加"数据变更广播" describe |
| `src/entrypoints/sidepanel/hooks/useHostBookmarks.ts` | side panel 接收方 | 提取 `refresh` + 加 BroadcastChannel 监听 |
| `src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts` | 接收方测试 | 加"BroadcastChannel 监听" describe |
| `src/entrypoints/background.ts` | 最小 service worker | 注释简化（专注 Chrome，无行为变化） |

---

## Task 1: BroadcastChannel polyfill（tests/setup.ts）

**Files:**
- Modify: `tests/setup.ts`
- Test: `tests/broadcast-channel.test.ts`

- [ ] **Step 1: 写失败测试（验证 polyfill 行为）**

创建 `tests/broadcast-channel.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';

describe('BroadcastChannel polyfill（tests/setup.ts 注入）', () => {
  it('同名 channel 互通：A.postMessage → B.onmessage 收到数据', () => {
    const a = new BroadcastChannel('test-pair');
    const b = new BroadcastChannel('test-pair');
    let received: unknown = null;
    b.onmessage = (e: MessageEvent) => {
      received = e.data;
    };
    a.postMessage({ store: 'bookmarks', action: 'put' });
    expect(received).toEqual({ store: 'bookmarks', action: 'put' });
    a.close();
    b.close();
  });

  it('同实例不回环：postMessage 不触发自己的 onmessage', () => {
    const a = new BroadcastChannel('test-loop');
    let selfReceived = false;
    a.onmessage = () => {
      selfReceived = true;
    };
    a.postMessage('hello');
    expect(selfReceived).toBe(false);
    a.close();
  });

  it('close 后不再收到消息', () => {
    const a = new BroadcastChannel('test-close');
    const b = new BroadcastChannel('test-close');
    let received = false;
    b.onmessage = () => {
      received = true;
    };
    b.close();
    a.postMessage('after-close');
    expect(received).toBe(false);
    a.close();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/broadcast-channel.test.ts`
Expected: FAIL — `BroadcastChannel is not defined`（jsdom 无原生）

- [ ] **Step 3: 实现 polyfill**

修改 `tests/setup.ts`，完整内容：

```typescript
import '@testing-library/react';

/**
 * 最小 BroadcastChannel polyfill（jsdom 无原生实现）。
 * 模拟真实语义：同名 channel 互通信义，同实例 postMessage 不回环。
 * 仅供测试，生产用浏览器原生 BroadcastChannel。
 */
class TestBroadcastChannel {
  private static channels = new Map<string, Set<TestBroadcastChannel>>();
  onmessage: ((ev: MessageEvent) => void) | null = null;

  constructor(public readonly name: string) {
    const set = TestBroadcastChannel.channels.get(this.name) ?? new Set();
    set.add(this);
    TestBroadcastChannel.channels.set(this.name, set);
  }

  postMessage(data: unknown): void {
    TestBroadcastChannel.channels.get(this.name)?.forEach((ch) => {
      if (ch !== this) ch.onmessage?.({ data } as MessageEvent);
    });
  }

  close(): void {
    TestBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

if (typeof globalThis.BroadcastChannel === 'undefined') {
  (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = TestBroadcastChannel;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/broadcast-channel.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 提交**

```bash
git add tests/setup.ts tests/broadcast-channel.test.ts
git commit -m "test(sidepanel): 加 BroadcastChannel polyfill 支持 jsdom 测试"
```

---

## Task 2: database.ts putRecord / deleteRecord 广播

**Files:**
- Modify: `src/shared/db/database.ts`
- Test: `tests/db/database.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/db/database.test.ts` 末尾追加（`import` 区先加 `DB_NAME`，见 Step 3 说明）。先在文件顶部 import 块补 `DB_NAME`：

`tests/db/database.test.ts` 第 15-16 行现为：
```typescript
import type { Workspace, Category, Bookmark, Context } from '@/shared/types';
import { ContextType } from '@/shared/types';
```
改为：
```typescript
import type { Workspace, Category, Bookmark, Context } from '@/shared/types';
import { ContextType, DB_NAME } from '@/shared/types';
```

在文件末尾追加新 describe：

```typescript
describe('数据变更广播', () => {
  let received: { store: string; action: string }[] = [];
  let channel: BroadcastChannel;

  beforeEach(() => {
    received = [];
    channel = new BroadcastChannel(DB_NAME);
    channel.onmessage = (e: MessageEvent) => {
      received.push(e.data as { store: string; action: string });
    };
  });

  afterEach(() => channel.close());

  it('putRecord → 广播 { store, action: "put" }', async () => {
    await putRecord('bookmarks', makeBookmark('bm-1', 'ws-1', 'cat-1'));
    expect(received).toContainEqual({ store: 'bookmarks', action: 'put' });
  });

  it('deleteRecord → 广播 { store, action: "delete" }', async () => {
    await putRecord('bookmarks', makeBookmark('bm-1', 'ws-1', 'cat-1'));
    received = [];
    await deleteRecord('bookmarks', 'bm-1');
    expect(received).toContainEqual({ store: 'bookmarks', action: 'delete' });
  });

  it('不同 store 各自广播', async () => {
    await putRecord('workspaces', makeWorkspace('ws-1', '工作'));
    expect(received).toContainEqual({ store: 'workspaces', action: 'put' });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/db/database.test.ts`
Expected: FAIL — `received` 为空（database 尚未广播）

- [ ] **Step 3: 实现 dbChannel + broadcast + putRecord/deleteRecord 广播**

修改 `src/shared/db/database.ts`。

在 `type StoreName = ...`（第 12 行）之后、`let dbPromise`（第 14 行）之前，插入 channel 与辅助函数（`DbChangeEvent` 引用了 `StoreName`，故须在其定义之后）：

```typescript
/**
 * 数据变更事件：数据库写入后广播，让其他上下文（side panel）重新读取刷新。
 * 同名 BroadcastChannel 实例互通信义，同实例 postMessage 不回环。
 */
export type DbChangeEvent = { store: StoreName; action: 'put' | 'delete' };

const dbChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DB_NAME) : null;

/** 广播数据变更。无原生 BroadcastChannel（如未注入 polyfill 的环境）时静默跳过。 */
function broadcast(store: StoreName, action: 'put' | 'delete'): void {
  dbChannel?.postMessage({ store, action } satisfies DbChangeEvent);
}
```

替换 `putRecord`（原第 88-92 行）：

```typescript
/** 写入（put）记录 */
export async function putRecord(storeName: StoreName, value: unknown): Promise<IDBValidKey> {
  const db = await getDB();
  const key = await db.put(storeName, value);
  broadcast(storeName, 'put');
  return key;
}
```

替换 `deleteRecord`（原第 95-98 行）：

```typescript
/** 删除记录 */
export async function deleteRecord(storeName: StoreName, key: string): Promise<void> {
  const db = await getDB();
  await db.delete(storeName, key);
  broadcast(storeName, 'delete');
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/db/database.test.ts`
Expected: PASS（含新增"数据变更广播"3 个 + 原有全部）

- [ ] **Step 5: 提交**

```bash
git add src/shared/db/database.ts tests/db/database.test.ts
git commit -m "feat(db): putRecord/deleteRecord 广播数据变更"
```

---

## Task 3: database.ts 级联删除广播

**Files:**
- Modify: `src/shared/db/database.ts`
- Test: `tests/db/database.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/db/database.test.ts` 的"数据变更广播" describe 内（`afterEach` 之前）追加：

```typescript
  it('deleteBookmarkCascade → 广播 bookmarks delete', async () => {
    await putRecord('bookmarks', makeBookmark('bm-1', 'ws-1', 'cat-1'));
    await putRecord('contexts', makeContext('ctx-1', 'bm-1', '笔记'));
    received = [];
    await deleteBookmarkCascade('bm-1');
    expect(received).toContainEqual({ store: 'bookmarks', action: 'delete' });
  });

  it('cascadeDeleteCategory → 广播 bookmarks delete', async () => {
    await putRecord('workspaces', makeWorkspace('ws-1', '工作'));
    await putRecord('categories', makeCategory('cat-1', 'ws-1', '工具'));
    await putRecord('bookmarks', makeBookmark('bm-1', 'ws-1', 'cat-1'));
    received = [];
    await cascadeDeleteCategory('cat-1');
    expect(received).toContainEqual({ store: 'bookmarks', action: 'delete' });
  });

  it('cascadeDeleteWorkspace → 广播 bookmarks delete', async () => {
    await putRecord('workspaces', makeWorkspace('ws-1', '工作'));
    await putRecord('categories', makeCategory('cat-1', 'ws-1', '工具'));
    await putRecord('bookmarks', makeBookmark('bm-1', 'ws-1', 'cat-1'));
    received = [];
    await cascadeDeleteWorkspace('ws-1');
    expect(received).toContainEqual({ store: 'bookmarks', action: 'delete' });
  });
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/db/database.test.ts -t "数据变更广播"`
Expected: 3 个新测试 FAIL（级联删除未广播 bookmarks）

- [ ] **Step 3: 实现级联删除广播**

修改 `src/shared/db/database.ts`，在三个级联删除函数的 `await tx.done;` 之后各加一行 `broadcast('bookmarks', 'delete');`。

`cascadeDeleteWorkspace`（`await tx.objectStore('workspaces').delete(workspaceId);` 之后，`await tx.done;` 之后）：

```typescript
  await tx.objectStore('workspaces').delete(workspaceId);

  await tx.done;
  broadcast('bookmarks', 'delete');
}
```

`cascadeDeleteCategory`（`await tx.objectStore('categories').delete(categoryId);` 之后）：

```typescript
  await tx.objectStore('categories').delete(categoryId);

  await tx.done;
  broadcast('bookmarks', 'delete');
}
```

`deleteBookmarkCascade`（`await tx.objectStore('bookmarks').delete(bookmarkId);` 之后）：

```typescript
  await tx.objectStore('bookmarks').delete(bookmarkId);

  await tx.done;
  broadcast('bookmarks', 'delete');
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/db/database.test.ts`
Expected: PASS（全部，含 3 个级联删除广播测试）

- [ ] **Step 5: 提交**

```bash
git add src/shared/db/database.ts tests/db/database.test.ts
git commit -m "feat(db): 级联删除广播 bookmarks 变更"
```

---

## Task 4: useHostBookmarks 监听广播自动刷新

**Files:**
- Modify: `src/entrypoints/sidepanel/hooks/useHostBookmarks.ts`
- Test: `src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts` 的 import 区加 `DB_NAME`：

第 14 行现为：
```typescript
import { findBookmarksByHost } from '@/services/BookmarkService';
import type { Bookmark } from '@/shared/types';
```
改为：
```typescript
import { findBookmarksByHost } from '@/services/BookmarkService';
import type { Bookmark } from '@/shared/types';
import { DB_NAME } from '@/shared/types';
```

在文件末尾追加新 describe：

```typescript
describe('useHostBookmarks — BroadcastChannel 监听', () => {
  beforeEach(() => vi.clearAllMocks());

  it('收到 bookmarks 广播 → 重新匹配（getAll 再调一次）', async () => {
    const all = [makeBookmark('b1', 'https://a.com')];
    (getAll as ReturnType<typeof vi.fn>).mockResolvedValue(all);
    (findBookmarksByHost as ReturnType<typeof vi.fn>).mockReturnValue([all[0]]);

    const { result } = renderHook(() => useHostBookmarks('a.com'));
    await waitFor(() => expect(result.current.matched).toHaveLength(1));
    expect(getAll).toHaveBeenCalledTimes(1);

    // 模拟 newtab 广播 bookmarks 变化
    const ch = new BroadcastChannel(DB_NAME);
    ch.postMessage({ store: 'bookmarks', action: 'put' });
    ch.close();

    await waitFor(() => expect(getAll).toHaveBeenCalledTimes(2));
    ch.close();
  });

  it('收到非 bookmarks 广播 → 不重新匹配', async () => {
    const all = [makeBookmark('b1', 'https://a.com')];
    (getAll as ReturnType<typeof vi.fn>).mockResolvedValue(all);
    (findBookmarksByHost as ReturnType<typeof vi.fn>).mockReturnValue([all[0]]);

    const { result } = renderHook(() => useHostBookmarks('a.com'));
    await waitFor(() => expect(result.current.matched).toHaveLength(1));
    expect(getAll).toHaveBeenCalledTimes(1);

    const ch = new BroadcastChannel(DB_NAME);
    ch.postMessage({ store: 'contexts', action: 'put' });
    ch.close();

    // 非 bookmarks 不触发 refresh，getAll 调用次数不变
    expect(getAll).toHaveBeenCalledTimes(1);
    ch.close();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts -t "BroadcastChannel 监听"`
Expected: FAIL（第一个测试：getAll 仍只调 1 次，未收到广播触发）

- [ ] **Step 3: 实现 refresh 提取 + BroadcastChannel 监听**

修改 `src/entrypoints/sidepanel/hooks/useHostBookmarks.ts`，完整内容：

```typescript
import { useState, useEffect } from 'react';
import { getAll } from '@/shared/db/database';
import { findBookmarksByHost } from '@/services/BookmarkService';
import type { Bookmark } from '@/shared/types';
import { DB_NAME } from '@/shared/types';

export interface HostBookmarksState {
  /** hostname 命中的书签（跨所有 workspace） */
  matched: Bookmark[];
  loading: boolean;
}

/**
 * 按 hostname 全局匹配书签（跨所有 workspace，不限定 workspace 范围）。
 *
 * - hostname 为 null（非 http(s) 页面）→ matched=[]，不调 getAll
 * - hostname 有值 → getAll('bookmarks') + findBookmarksByHost
 * - hostname 变化 → 重新匹配（active flag 丢弃过期结果）
 * - 收到跨上下文 bookmarks 变更广播（newtab 改书签/上下文）→ 重新匹配
 *
 * 全局匹配的理由：side panel 入口语义是"当前页面"，不是"某个工作区"；
 * 用户在不同 workspace 存了同 host 的书签都应可见。来源信息由书签名/锁标识体现。
 *
 * @param hostname 当前 tab 的 hostname（null 表示不可用）
 */
export function useHostBookmarks(hostname: string | null): HostBookmarksState {
  const [matched, setMatched] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hostname) {
      setMatched([]);
      setLoading(false);
      return;
    }

    let active = true;

    const refresh = async () => {
      const all = await getAll<Bookmark>('bookmarks');
      if (!active) return;
      setMatched(findBookmarksByHost(all, hostname));
      setLoading(false);
    };

    setLoading(true);
    refresh();

    // 监听跨上下文数据变更：newtab 改书签/上下文（经 syncContextMeta 写 bookmarks 表）
    // → 广播 store==='bookmarks' → 自动重新匹配。
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DB_NAME) : null;
    channel.onmessage = (e: MessageEvent) => {
      const data = e.data as { store?: string };
      if (data?.store === 'bookmarks') refresh();
    };

    return () => {
      active = false;
      channel?.close();
    };
  }, [hostname]);

  return { matched, loading };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts`
Expected: PASS（原有 3 个 + 新增 2 个）

- [ ] **Step 5: 提交**

```bash
git add src/entrypoints/sidepanel/hooks/useHostBookmarks.ts src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts
git commit -m "feat(sidepanel): useHostBookmarks 监听广播自动刷新"
```

---

## Task 5: background.ts 注释简化（专注 Chrome）

**Files:**
- Modify: `src/entrypoints/background.ts`

> 非 TDD：本 task 无行为变化（Chrome 下 `chrome.sidePanel` 必然存在，去可选链行为一致），仅更新注释 + 移除 Firefox 兼容表述。

- [ ] **Step 1: 修改 background.ts**

替换 `src/entrypoints/background.ts` 完整内容：

```typescript
export default defineBackground({
  main() {
    // 左击扩展图标直达 side panel（Chrome sidePanel API）。
    //
    // 必须在 background(service worker) 调用：side panel 页面只有在被打开时才加载，
    // 若放在 side panel 的 main.tsx，首次使用（side panel 从未打开）时这段代码不执行，
    // openPanelOnActionClick 保持默认 false → 左击走 default_popup 开 popup（缺陷）。
    // setPanelBehavior 是 upsert：每次 service worker 启动设置，确保安装后即生效。
    //
    // 本版本专注 Chrome（不做 Firefox sidebar_action 适配）。
    // chrome 全局 TS 类型缺失（TS2304），类型断言绕过，@types/chrome 列后续统一修。
    (chrome as unknown as {
      sidePanel: {
        setPanelBehavior: (behavior: { openPanelOnActionClick: boolean }) => Promise<void>;
      };
    }).sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => {
        console.error('[octane] setPanelBehavior 失败', err);
      });
  },
});
```

- [ ] **Step 2: 确认 build 通过**

Run: `npx wxt build`
Expected: 成功（chrome-mv3 manifest 仍含 `background.service_worker` + `side_panel.default_path`）

- [ ] **Step 3: 提交**

```bash
git add src/entrypoints/background.ts
git commit -m "chore(background): 专注 Chrome，移除 Firefox 兼容注释"
```

---

## Task 6: 全量验证

- [ ] **Step 1: 全套测试无回归**

Run: `npx vitest run`
Expected: 全部 PASS（原有 113 + 新增 11：polyfill 3 + database 广播 6 + useHostBookmarks 2）

- [ ] **Step 2: build 成功**

Run: `npx wxt build`
Expected: 成功

- [ ] **Step 3: 用户实测（手动）**

在 Chrome 加载 `.output/chrome-mv3`：
1. 打开 side panel（左击扩展图标），打开某 http 页面，确认书签列表正常
2. 在 newtab 新增/编辑/删除一个同 host 书签
3. 切回 side panel，确认列表自动刷新（无需切 tab）
4. 给某书签加 context，确认 side panel 该书签命中数/加密锁标识更新

---

## Self-Review

**1. Spec coverage：**
- database.ts 单一收口广播（5 处）→ Task 2（putRecord/deleteRecord）+ Task 3（3 级联删除）✓
- 最小信号 `{store, action}` → Task 2 Step 3（DbChangeEvent）✓
- useHostBookmarks 监听 `store==='bookmarks'` 重匹配 → Task 4 ✓
- BroadcastChannel polyfill → Task 1 ✓
- 构造守卫 `typeof !== 'undefined'` → Task 2（database）+ Task 4（useHostBookmarks）✓
- "不做 Firefox"（M6 移除、background 简化）→ Task 5 ✓
- 错误处理（active flag 丢弃过期结果、postMessage 不抛）→ Task 4 refresh 复用 active flag ✓
- 不含：contexts 明细实时刷新（spec 明确列后续，本 plan 无 task）✓

**2. Placeholder scan：** 无 TBD/TODO，每步含完整代码与命令。✓

**3. Type consistency：**
- `DbChangeEvent = { store: StoreName; action: 'put' | 'delete' }` — Task 2 定义，Task 4 接收方读 `e.data.store`（不直接引用类型，用 `{store?: string}` 宽松匹配，避免跨模块耦合）✓
- `broadcast(store, action)` 签名 Task 2 定义，Task 3 复用（`broadcast('bookmarks', 'delete')`）✓
- `DB_NAME`：Task 2 从 `@/shared/types` import（database.ts 已有），Task 4 从 `@/shared/types` import ✓
- `StoreName` 类型在 `DbChangeEvent` 之前定义（Task 2 Step 3 说明放在 `type StoreName` 之后）✓

无遗漏、无占位、类型一致。
