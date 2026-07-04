# Favicon 本地缓存系统设计（A+C 方案）

- 日期：2026-07-04
- 状态：DRAFT（待用户 review）
- 关联：调研见同日对话；云存储 S3+WebDAV 已 ship（PR#10），本设计不动备份载荷

## 1. 背景与问题

当前 favicon 获取链路：

- `src/services/BookmarkService.ts:78` `getFaviconUrl(url)` 生成**远程 URL 字符串**：
  - 公网域名 → `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`
  - 本机/内网 → `${origin}/favicon.ico`
- 该字符串写入 `Bookmark.faviconUrl`，持久化在 IndexedDB `bookmarks` 表
- `src/newtab/components/BookmarkCard/index.tsx:58` 用 `<img src={bookmark.faviconUrl} onError={...}>` 渲染，失败回退首字母

三个问题：

1. **每次重新加载**：`<img>` 每次挂载都向 google.com/源站发请求，仅靠浏览器 HTTP 缓存，无应用层缓存
2. **国内不可用**：`www.google.com/s2/favicons` 在墙内不可达，公网书签 favicon 全部回退首字母
3. **性能隐患**：`src/store/useBookmarks.ts:31` `loadBookmarks` 每次加载分类，对每条书签串行 `await updateBookmark`（N 条 → N 次 IndexedDB put + N 次 broadcast），书签多时打开 newtab 卡顿

## 2. 目标与成功标准

**目标**：favicon 由"远程 URL 直渲"改为"IndexedDB blob 缓存 + 国内可用回退链 + 按需抓取"。

**强成功标准**（可独立验证）：

- SC1：关网状态下，浏览器已访问过的书签 favicon 仍正常显示（`_favicon` 读浏览器缓存）
- SC2：同一 hostname 的多个书签只抓取 1 次、只存 1 份 blob（per-hostname 缓存）
- SC3：打开含 100 条书签的 newtab，IndexedDB put 次数 = 0（不再有 `loadBookmarks` 自愈循环）
- SC4：抓取三源全部失败 → 回退首字母，不抛错、不卡渲染、不写入空记录
- SC5：抓取全过程 fire-and-forget，永不阻塞首屏渲染

## 3. 决策记录（默认采用，待 review 确认）

| # | 决策 | 默认选择 | 理由 |
|---|---|---|---|
| D1 | favicon blob 是否进备份载荷 | **不进**，按需重抓 | blob 体积大、污染云备份、可重建；BackupData 仍是 5 表，BACKUP_VERSION 不变 |
| D2 | 缓存失效策略 | **永久缓存 + URL 变更失效** | 流量最小；站点换 favicon 用户看不到更新可接受（必要时加手动刷新入口） |
| D3 | 抓取回退源链 | **`_favicon` → DuckDuckGo → 源站** | 完全避开 google.com，国内可用；三源串行 + 超时 |
| D4 | 渲染格式 | **Blob → `createObjectURL`** | DB 体积最小、无损；需管理对象 URL 生命周期 |

## 4. 架构

```
BookmarkCard ──> useFavicon(url) ──> FaviconService
                                        │
                 ┌──────────────────────┼──────────────────────────┐
                 ▼                      ▼                          ▼
          getCachedBlob(hostname)  fetchAndStore(url)         invalidate(hostname)
          读 favicons store        三源回退链抓取               URL 变更时清旧
                 │                      │
                 ▼                      ▼
          IndexedDB `favicons`  ←── write Blob
          key=hostname
```

### 4.1 新增组件

#### `src/services/FaviconService.ts`（纯逻辑，TDD 核心）

无 React 依赖，可独立单测。导出：

- `getCachedBlob(hostname: string): Promise<Blob | null>` — 查 `favicons` store，命中返回 Blob，未命中返回 null
- `fetchAndStoreFavicon(url: string): Promise<Blob | null>` — 执行三源回退链抓取，首个有效结果写库并返回；全失败返回 null（不写空记录）
- `invalidateFavicon(hostname: string): Promise<void>` — 删除指定 hostname 缓存（书签 URL 变更时调用）
- `buildFaviconRenderUrl(url: string): string` — 同步构造 `chrome-extension://EXT/_favicon/?pageUrl=${url}&size=32` 占位 URL（缓存未命中时的即时渲染源）

私有：

- `fetchWithTimeout(url: string, ms: number): Promise<Response>` — 单源超时抓取
- `pickHostname(url: string): string | null` — 提取 hostname，非法返回 null
- 抓取源链构造：`buildSourceList(url): string[]` — 返回 `[url1, url2, url3]`

#### `src/newtab/hooks/useFavicon.ts`

```typescript
type FaviconSrc =
  | { kind: 'blob'; src: string }   // createObjectURL 结果
  | { kind: 'remote'; src: string } // _favicon 占位 URL
  | null;                            // 无可用源 → 首字母回退

function useFavicon(url: string): FaviconSrc;
```

行为：

1. mount 时查 DB → 命中 `getCachedBlob` → `createObjectURL` → `{ kind: 'blob', src }`
2. 未命中 → 立即返回 `{ kind: 'remote', src: buildFaviconRenderUrl(url) }`（同步可渲染），同时后台 `fetchAndStoreFavicon(url)` 抓取，成功后 setState 切到 blob 态
3. 组件卸载 → `revokeObjectURL` 释放 blob URL，取消进行中的后台抓取（active flag）
4. `url` 变化 → 重置流程，旧 blob URL revoke

### 4.2 改造组件

| 文件 | 改动 |
|---|---|
| `src/shared/db/database.ts` | DB_VERSION 2→3；`OctaneDB` 增 `favicons` store；`upgrade(db)` 加防御式建表（`objectStoreNames.contains` 模式，与现有一致） |
| `src/shared/types/index.ts` | 增 `FaviconRecord` 类型；`Bookmark.faviconUrl` 标记 `@deprecated`（类型保留，不删，兼容旧备份） |
| `src/newtab/components/BookmarkCard/index.tsx` | 用 `useFavicon(bookmark.url)` 替换 `bookmark.faviconUrl` 直读；`onError` 仍回退首字母 |
| `src/store/useBookmarks.ts` | **删 `loadBookmarks` 自愈循环**（第 35-42 行）；`createBookmark` 删第 55-60 行 favicon 补充 |
| `src/entrypoints/popup/views/SaveBookmarkView.tsx` | 删第 124-127 行 `getFaviconUrl` + `updateBookmark` 调用 |
| `src/services/BookmarkService.ts` | `getFaviconUrl` 标 `@deprecated`，不删（外科手术原则；外部可能引用） |
| `wxt.config.ts` | manifest permissions 加 `"favicon"` |

### 4.3 数据流

**`favicons` store（per-hostname，非 per-bookmark）**：

```typescript
interface FaviconRecord {
  hostname: string;   // 主键，例如 "github.com"（new URL().hostname）
  blob: Blob;         // 原始字节
  mimeType: string;   // "image/png" / "image/x-icon" 等
  fetchedAt: number;  // Date.now()，永久缓存（D2）
}
```

**抓取回退链**（每源 5s 超时，串行，首个有效字节即停）：

1. `chrome-extension://<EXT_ID>/_favicon/?pageUrl=<encodedUrl>&size=32` — 浏览器 favicon 缓存，国内可用
2. `https://icons.duckduckgo.com/ip3/<hostname>.ico` — 国内可达第三方
3. `<origin>/favicon.ico` — 源站直取（覆盖 localhost/内网，替代原 `isLocalHostname` 分支）

> 三源均不走 google.com。

**有效性判定**：响应 `ok` 且 `Content-Type` 以 `image/` 开头，或字节长度 > 0（防御性，部分源 Content-Type 不准）。

**渲染优先级**（`useFavicon`）：

1. DB 命中 → `createObjectURL(blob)` — 秒开、离线可用
2. 未命中 → `_favicon` chrome-extension URL — 同步可渲染占位
3. 后台抓取成功 → 切 blob 态
4. 全失败/DB 不可用 → 首字母占位（BookmarkCard 现有 `onError`）

## 5. 错误处理

- 任一源超时 / 非 2xx / 非图片 → 试下一源
- 三源全失败 → 返回 null，**不写空记录**，下次访问重试
- 抓取 Promise reject 静默吞掉（fire-and-forget），不阻塞渲染
- IndexedDB 不可用（Quota / 异常）→ `useFavicon` 直接走分支 2/3
- `_favicon` 权限缺失 / 非 Chromium → 跳过源 1，从源 2 开始
- 非 http(s) URL（chrome://、file://）→ 直接返回 null（首字母回退）

## 6. 兼容性

- **旧 `Bookmark.faviconUrl` 字段**：渲染层不再读；类型保留（避免破坏旧备份导入），不主动迁移
- **备份 schema 不变（D1）**：`BackupData` 仍是 5 表，`BACKUP_VERSION` 不变；导入含旧 faviconUrl 字符串的书签时忽略该字段
- **`getFaviconUrl` 函数**：标 `@deprecated` 不删（CLAUDE.md 外科手术原则；可能存在外部引用）

## 7. 测试策略

遵循 `docs/standards/testing.md`（方案 B Testing Trophy）：不 mock Semi、只 mock 副作用边界。

### W1 单测（FaviconService）

- `pickHostname`：合法/非法 URL、端口、IPv6
- `buildSourceList`：公网域名、localhost、IP 三种分支返回的源序
- `fetchAndStoreFavicon`：mock fetch 各源
  - 源 1 命中 → 不请求源 2/3
  - 源 1 超时 → 源 2 命中
  - 源 1+2 失败 → 源 3 命中
  - 全失败 → 返回 null，DB 无新记录
  - 非图片响应 → 视为失败继续回退
- `getCachedBlob`：命中/未命中
- `invalidateFavicon`：删除后 `getCachedBlob` 返回 null

### W2 单测 + 组件测试

- `useFavicon` hook：命中（blob 态）/未命中（remote 态 + 后台抓取切态）/卸载 revoke/`url` 变化重置
- `BookmarkCard`：blob 态渲染 `<img src="blob:...">`；首字母回退态；三态 a11y 不回归
- DB schema：v2→v3 升级后 `favicons` store 存在，旧 store 不丢
- 性能验证：100 条书签 `loadBookmarks` 后 `putRecord` mock 调用次数 = 0

### W3 验证

- `pnpm typecheck` + `pnpm test` 双绿（husky pre-push 自动跑）
- 真机 e2e：国内公网站点（github.com、baidu.com）favicon 显示；从未访问的小众站点后台抓取后秒开
- 关网：已缓存站点正常显示

## 8. Wave 切分

每 wave 结束派独立 subagent 跑 `pnpm typecheck` + `pnpm test` + code-review，通过才进下一 wave。

### Wave 1 — 基础设施（无 UI 依赖，可并行）

- T1.1 DB schema：`DB_VERSION` → 3，`favicons` store，`FaviconRecord` 类型（subagent A）
- T1.2 FaviconService：抓取回退链 + 缓存 + 失效 + `_favicon` URL 构造（TDD）（subagent B，与 A 并行）
- T1.3 manifest `favicon` 权限（subagent A 收尾）

**并行性**：A 做 DB + manifest，B 做 FaviconService（B 依赖 A 的 `FaviconRecord` 类型定义，可用接口约定先行的 stub 解耦，或串行 B 在 A 后）

### Wave 2 — 渲染接入（串行为主）

- T2.1 `useFavicon` hook（TDD）
- T2.2 `BookmarkCard` 接入（删 faviconUrl 直读，用 hook）
- T2.3 删 `loadBookmarks` 自愈循环 + `createBookmark` favicon 补充 + `SaveBookmarkView` favicon 调用（可与 T2.1/T2.2 部分并行）

### Wave 3 — 清理与验证

- T3.1 `getFaviconUrl` 标 deprecated
- T3.2 备份兼容回归（导入含旧 faviconUrl 的备份不报错）
- T3.3 真机 e2e + 性能验证（100 书签 0 put）

## 9. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| `_favicon` 读不到从未访问的站点 | 首次无图标 | 三源回退（DuckDuckGo 覆盖广）+ 后台抓取 |
| `createObjectURL` 泄漏 | 内存涨 | hook 卸载/url 变化严格 revoke |
| DB 配额（大量 blob） | 写入失败 | per-hostname 去重已大幅降量；catch 静默 |
| 备份不含 favicon（D1） | 跨设备首次无图标 | 走 `_favicon` 占位 + 后台重抓，体验可接受 |
| 删自愈循环后旧"占位 URL"书签 | 现有书签 faviconUrl 字段失效 | 渲染层不再读该字段，无影响；不主动迁移 |

## 10. 非目标（YAGNI）

- 不做 TTL 自动刷新（D2）
- 不做手动"刷新 favicon"按钮（YAGNI，必要时再加）
- 不做 favicon 抓取优先级队列/限流（书签量级未到）
- 不把 favicon blob 纳入备份/云同步（D1）
- 不迁移/清理旧 `faviconUrl` 字段值
