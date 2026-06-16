# Side Panel P3 — BroadcastChannel 跨上下文同步（M7）

## 背景

side panel v0.1.3.3 的 **P2 组件渲染已完成**（四状态 UI + 按书签分组 + `useHostBookmarks` 全局匹配），测试 113 passed。

P2 的数据获取是一次性的：`useHostBookmarks(hostname)` 仅在 hostname 变化时重新 `getAll('bookmarks')` + 匹配。**当用户在 newtab 改了书签/上下文，side panel 不会自动刷新**——必须切 tab 触发 hostname 变化才能看到更新。

P3 第一项（test plan M7）补这个缺口：**newtab 写数据 → side panel 自动刷新**。机制用 `BroadcastChannel('octane-db')`——同扩展不同页面（newtab / side panel）各自持有一个同名 channel 实例，`postMessage` 扇出到其他实例，无需 background 中转。

**本版本范围决策：专注 Chrome，不做 Firefox 适配**（用户 2026-06-16 指示）。test plan M6（Firefox `sidebarAction` shim）移除，P3 计划里的 Firefox `sidebar_action` 适配层移除。

## 设计决策（brainstorming 定稿）

1. **广播层在 database.ts（单一收口）**。所有写入收口在 `src/shared/db/database.ts`（`putRecord` / `deleteRecord` / 三个级联删除函数），在它们末尾广播。5 个 service × N 方法只改一处收口，零遗漏，级联删除也覆盖。**不选 service 层广播**（十几个广播点、级联删除在 db 层会漏）；**不选组件层广播**（最易遗漏）。

2. **广播内容：最小信号 `{ store, action }`**，不传数据。接收方收到即重新 `getAll` 读取。不传完整 record（避免序列化成本、无必要）。

3. **接收方：`useHostBookmarks` 监听 `store==='bookmarks'` 变化 → 重新匹配**。监听逻辑内联在 `useHostBookmarks`（M7 单一接收方）；未来多处监听（如 contexts 明细刷新）再抽通用 `useDbSync` hook。

4. **contexts 变化经 bookmarks 表广播反映**：ContextService 每次 context 增删改都调 `syncContextMeta` → `updateBookmark`（写 bookmarks 表的 `contextCount` / `hasEncryptedContext` 冗余字段）。因此 bookmarks 广播已覆盖 context 的计数/加密锁变化——side panel 的 StickyHeader 命中数、BookmarkGroup 加密锁标识会更新，无需额外监听 contexts。

5. **M7 不含：BookmarkGroup 已解锁 contexts 明文列表的实时刷新**。已解锁的 `useEncryptedContexts` 不会因 bookmarks 重匹配而重跑（`bookmark.id` 不变 → React key 不变 → 不重挂载）。这是独立的、涉及解锁态信号传递的关注点，列后续 spec。

## 架构 & 数据流

```
newtab (写)                                side panel (读)
  │                                          │
  BookmarkService.createBookmark              useHostBookmarks(hostname)
    └ putRecord('bookmarks', x)                 ├ useCurrentTabContext → hostname
       └ broadcast('bookmarks', 'put') ──────┐   ├ getAll + findBookmarksByHost（hostname 变 / 收到广播时）
                                            │   └ BroadcastChannel('octane-db')
   ContextService.createContext              │       └ onmessage(store==='bookmarks') → refresh()
     └ putRecord('contexts')                  │
     └ syncContextMeta → updateBookmark       │
        └ putRecord('bookmarks')              │
           └ broadcast('bookmarks', 'put') ───┘
```

**不回环**：BroadcastChannel 同名实例 `postMessage` 不会触发自己的 `onmessage`。newtab 发的只到 side panel 实例（及其他 newtab 实例，但 newtab 不监听）。✓

## 发送方 — `src/shared/db/database.ts`

新增 module 级单例 channel + 辅助函数：

```typescript
// src/shared/db/database.ts（顶部，DB_NAME import 之后）
const dbChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DB_NAME) : null;

/** 广播数据变更，让其他上下文（side panel）重新读取刷新。同实例不回环。 */
function broadcast(store: StoreName, action: 'put' | 'delete'): void {
  dbChannel?.postMessage({ store, action });
}
```

**构造守卫** `typeof BroadcastChannel !== 'undefined'`：测试环境（jsdom 无原生 BroadcastChannel）若未注入 polyfill，`dbChannel=null`，`postMessage` 静默跳过，不崩溃。

**5 处广播调用**（每个函数末尾一行，在操作完成后）：

| 函数 | 位置 | 广播 |
|------|------|------|
| `putRecord` | `return db.put(...)` 之后 | `broadcast(storeName, 'put')` |
| `deleteRecord` | `return db.delete(...)` 之后 | `broadcast(storeName, 'delete')` |
| `deleteBookmarkCascade` | `await tx.done` 之后 | `broadcast('bookmarks', 'delete')` |
| `cascadeDeleteCategory` | `await tx.done` 之后 | `broadcast('bookmarks', 'delete')` |
| `cascadeDeleteWorkspace` | `await tx.done` 之后 | `broadcast('bookmarks', 'delete')` |

级联删除统一广播 `'bookmarks'`：三者都删 bookmarks，side panel 全局匹配只需 bookmarks 信号（categories/workspaces 删除不影响 side panel 显示，无需广播）。

**消息类型**（放 `database.ts` 导出，供接收方复用）：

```typescript
// src/shared/db/database.ts
export type DbChangeEvent = { store: StoreName; action: 'put' | 'delete' };
```

## 接收方 — `src/entrypoints/sidepanel/hooks/useHostBookmarks.ts`

- **提取 `refresh()`**：把现有 effect 内联的读取逻辑（`getAll` + `findBookmarksByHost` + setMatched/setLoading + active flag 丢弃过期结果）提取为 effect 内闭包函数，hostname 变化和收到广播都调它。
- **新增监听 effect**：`new BroadcastChannel(DB_NAME)`，`onmessage` 收到 `store==='bookmarks'` → 调 `refresh()`；cleanup 时 `channel.close()`。构造同样守卫 `typeof BroadcastChannel !== 'undefined'`。
- **hostname 为 null**：监听仍在，但 `refresh()` 内部短路（`hostname` 为 null 直接 setMatched([]) 返回），无害。

## 错误处理

- BroadcastChannel 构造守卫（见上）：无原生实现时降级为不发/不收，不崩溃。
- `postMessage` 同步、不抛。
- `onmessage → refresh` 异步，复用现有 `active` flag 丢弃卸载后的过期结果（与 hostname 快速切换同一套保护）。
- 快速连发广播（如级联删除后连续 put）：每次触发 `refresh()`，最后一次的结果留下；中间结果被 active flag / 后续 setState 覆盖，无竞态危害（与 P1 M2 useCurrentTabContext 同模式）。

## 测试策略

### BroadcastChannel polyfill — `tests/setup.ts`

jsdom 无原生 BroadcastChannel。在 `tests/setup.ts` 注入最小 polyfill（约 15 行），**模拟真实语义**（同名 channel 互通信义、同实例不回环），而非简单 mock：

```typescript
// tests/setup.ts（在现有 import 之后）
class TestBroadcastChannel {
  private static channels = new Map<string, Set<TestBroadcastChannel>>();
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(public readonly name: string) {
    const set = TestBroadcastChannel.channels.get(name) ?? new Set();
    set.add(this);
    TestBroadcastChannel.channels.set(name, set);
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

这样 database 的 channel 和测试创建的 channel 能真实互通，无需逐测试 mock。

### 发送方测试 — `tests/db/database.test.ts`（扩展现有）

新增 describe：`putRecord` / `deleteRecord` / 三个级联删除 → 创建一个监听 channel，断言收到正确的 `{ store, action }`。利用真实 fake-indexeddb + polyfill，验证"写完就广播"。

### 接收方测试 — `src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts`（扩展现有）

现有测试 `vi.mock('@/shared/db/database')`（mock 了 getAll）。新增：
- 构造 useHostBookmarks(hostname) → mock 的 database 内部 channel postMessage 不经过真 channel（因为 database 被 mock）。因此接收方测试**直接在 useHostBookmarks 创建的 channel 上模拟入站消息**：拿到 hook 内部 channel 不便，改为在测试里 `new BroadcastChannel(DB_NAME)` 并 `postMessage({ store: 'bookmarks', action: 'put' })`，断言 `getAll` 被再次调用、`matched` 更新（polyfill 让两个同名实例互通）。
- 非 bookmarks 消息（`store:'contexts'`）→ 不触发 refresh（`getAll` 调用次数不变）。

### integration（可选）

`tests/services/integration.test.ts` 风格：fake-indexeddb + polyfill，`putRecord('bookmarks', x)` 后断言 side panel 侧 channel 收到消息。若发送方/接收方单测已充分，integration 可省。

## 新增 / 改动文件

- 改 `src/shared/db/database.ts` — 加 `dbChannel` + `broadcast` + `DbChangeEvent` 类型；6 处广播调用
- 改 `src/entrypoints/sidepanel/hooks/useHostBookmarks.ts` — 提取 `refresh` + 加 BroadcastChannel 监听
- 改 `tests/setup.ts` — 加 BroadcastChannel polyfill
- 改 `tests/db/database.test.ts` — 加广播断言
- 改 `src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts` — 加监听触发测试
- 改 `src/entrypoints/background.ts` — 注释更新（专注 Chrome，去掉 Firefox 兼容表述）

## "不做 Firefox"执行项

1. **test plan M6 移除**：Firefox `sidebarAction` shim 不实现（test plan 矩阵对应行作废）。
2. **`background.ts` 简化**：注释去掉"Firefox 无 sidePanel API，可选链保护 / M6 适配层在 P3"，改为说明本版本专注 Chrome。可选链 `sidePanel?.setPanelBehavior?.` 可简化为直接调用（专注 Chrome，`chrome.sidePanel` 必然存在）；TS 类型缺失（TS2304）仍用类型断言绕过，`@types/chrome` 列后续统一修。
3. **memory `side-panel-design.md` + 后续 spec**：记录"本版本专注 Chrome，不做 Firefox 适配"，移除 Firefox 相关的"不在范围"遗留项。
4. **整体 design doc**（`~/.gstack/projects/octane/vicohu-feature-0.1.3.2-design-20260615-201117.md`）：同步记录此范围决策。

## scope（本次）

含：database.ts 单一收口广播 + `useHostBookmarks` 监听重匹配 + BroadcastChannel polyfill + 发送方/接收方测试 + background.ts 注释简化

## 不在范围内（列后续）

- BookmarkGroup 已解锁 contexts 明文列表实时刷新（涉及解锁态信号，独立 spec）
- `tabId→contexts` 缓存（M8）
- 右键菜单入口（contextMenus）
- `@types/chrome` 类型修复（10+ TS2304，单独）
- 完整"添加书签"内联保存表单、分类名 Tag、ContextCard 编辑交互（P2 遗留）

## 关联 artifact

- P2 spec（含修订记录）：`docs/superpowers/specs/2026-06-16-sidepanel-p2-render-design.md`
- 整体 design（APPROVED）：`~/.gstack/projects/octane/vicohu-feature-0.1.3.2-design-20260615-201117.md`
- test plan（15 codepath）：`~/.gstack/projects/octane/vicohu-feature-0.1.3.2-test-plan-20260615-210232.md`
- memory：`side-panel-design.md`

## 修订记录

- **2026-06-16（执行时）**：取消 BroadcastChannel polyfill。原因：执行时探测发现 Node 18+ 全局已有原生 BroadcastChannel（`typeof === 'function'`），vitest jsdom 继承，无需 polyfill；且原生为异步派发。强制注入同步 polyfill 会偏离生产异步语义、覆盖全局有风险。改为：测试直接用原生异步（`postMessage` 后 `await`/`waitFor` 断言）；保留烟雾测试 `tests/broadcast-channel.test.ts`（2 case）确认测试环境 BroadcastChannel 可用；`tests/setup.ts` 不改。database.ts / useHostBookmarks 的 `typeof BroadcastChannel !== 'undefined'` 守卫保留（生产防御，无害）。
