# Favicon 第三方高清异步升级设计

- 日期：2026-07-13
- 状态：已选定方案，待用户 review 书面规格
- 取代：`docs/superpowers/specs/2026-07-04-favicon-local-cache-design.md` 中的永久缓存与严格串行回退决策

## 1. 背景

当前书签与常驻标签统一通过 `useFavicon(url)` 获取图标：先读取按 hostname 永久保存的 IndexedDB Blob，未命中时用 Chrome `_favicon` 占位，并串行抓取 Icon Horse、`_favicon`、DuckDuckGo、源站 `/favicon.ico`。

该实现存在以下问题：

1. Chrome `_favicon` 未命中时可能返回默认图标；当前仅检查 Blob 非空，默认图标会被当成成功结果永久缓存。
2. `useOpenTabs()` 已持有浏览器解析完成的 `tab.favIconUrl`，但 BookmarkCard 与 PinnedArea 不使用它。
3. 第三方源严格串行，单源最长等待 5 秒；失败会拖慢后续本地回退。
4. SVG 被无条件丢弃，DeepSeek 等站点失去高清候选。
5. PinnedArea 没有图片加载失败回退。
6. 同 hostname 多组件挂载时缺少 in-flight 去重，可能重复抓取。
7. 当前源链会把内网 hostname 发送给第三方服务。

CORS 不是本缺陷的主因。第三方 `fetch()` 的 CORS 失败只代表该源不可用，应静默回退；本设计不新增 favicon host permissions，继续以普通 CORS 作为第三方抓取的能力边界。

## 2. 用户决策

采用“本地立即显示、第三方异步升级”方案：

- **外网 URL**：第三方高清图标是最终优先来源；没有已缓存高清图时，先显示浏览器本地图标，同时后台抓取第三方候选，成功后热替换并缓存。
- **内网 URL**：不请求第三方，仅使用匹配 Tab 的 `favIconUrl`、Chrome `_favicon` 和首字母回退。
- 不新增 `https://icon.horse/*`、DuckDuckGo 或 `<all_urls>` host permissions。
- 不再请求源站 `${origin}/favicon.ico`；无任意站点 host permission 时该源不稳定，且不如浏览器已解析的 favicon 可靠。

## 3. 目标与成功标准

### 3.1 目标

1. 外网站点最终优先显示经过验证的第三方高清 favicon。
2. 第三方请求期间不显示空白：浏览器本地 favicon 立即可见。
3. 内网站点 hostname 不发送给第三方。
4. 已打开 Tab 的 favicon 变化能即时反映到书签和常驻标签。
5. 坏图、默认图和失败结果不再永久污染缓存。
6. 同 hostname 的并发请求合并为一个后台任务。

### 3.2 可验证成功标准

- SC1：外网 URL 无第三方缓存时，首帧使用匹配 Tab 的 `favIconUrl`；第三方成功后切换为 Blob URL。
- SC2：外网两个第三方源均失败时，始终保留本地 favicon，不出现空白或未处理异常。
- SC3：内网 URL 不调用任何第三方抓取函数。
- SC4：同 hostname 同时挂载多个 BookmarkCard/PinChip，只产生一组第三方请求。
- SC5：Icon Horse/DuckDuckGo 返回空响应、HTTP 非 2xx、非图片、解码失败或低于质量阈值时，不写入成功缓存。
- SC6：SVG 候选解码成功后规范化为 64×64 PNG Blob，并可写入缓存。
- SC7：旧版本无来源元数据的 favicon 缓存在升级后清空，避免历史默认图继续命中。
- SC8：PinnedArea 图片加载失败后依次回退到 Chrome `_favicon`、首字母，不显示破图。

## 4. 总体架构

```text
App
└─ useOpenTabs() 只查询一次当前窗口 Tab
   ├─ Content
   │  └─ BookmarkCard(url, runtimeFavIconUrl)
   └─ Sidebar
      └─ PinnedArea
         └─ PinChip(url, runtimeFavIconUrl)

useFavicon(url, runtimeFavIconUrl)
├─ 同步本地候选
│  ├─ runtimeFavIconUrl
│  ├─ Chrome _favicon
│  └─ null（首字母）
├─ 查询第三方高清缓存
│  ├─ 新鲜命中：切换为缓存 Blob
│  └─ 过期命中：继续显示旧 Blob，后台 stale-while-revalidate
└─ 外网且允许重试：后台异步升级
   ├─ Icon Horse ─┐
   └─ DuckDuckGo ─┴─ 并行抓取、验证、质量比较
                         ├─ 成功：规范化 PNG、写缓存、热替换
                         └─ 失败：记录冷却时间、保持本地候选
```

显示速度与最终来源优先级分离：本地来源负责立即可用，第三方来源负责最终高清结果。

## 5. URL 分类与隐私边界

新增纯函数 `isPrivateFaviconTarget(url)`。以下目标视为内网，不访问第三方：

- `localhost`、`*.localhost`；
- `*.local`；
- IPv4 loopback、private、link-local：`127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`；
- IPv6 loopback、ULA、link-local：`::1`、`fc00::/7`、`fe80::/10`。

不通过 DNS 解析判断公网/内网，避免引入新权限和异步依赖。形如 `service.corp.example.com` 但只在内网解析的自定义域名无法自动识别，仍会被视为外网；本期不增加用户配置名单，作为已知限制记录。

## 6. 来源与优先级

### 6.1 第三方来源

并行请求：

1. Icon Horse：使用“无图返回 404”的参数，避免服务默认占位图被视为成功。
2. DuckDuckGo favicon 服务。

不请求 Chrome `_favicon` Blob，不请求源站 `/favicon.ico` Blob。Chrome `_favicon` 只作为本地渲染 URL，不进入长期第三方缓存。

### 6.2 本地来源

优先级：

1. 匹配打开 Tab 的安全 `favIconUrl`；
2. `buildFaviconRenderUrl(url)` 生成的 Chrome `_favicon` URL；
3. 组件首字母占位。

`runtimeFavIconUrl` 加载失败时，hook 切到 `_favicon`；`_favicon` 加载失败时返回 null，由组件显示首字母。

### 6.3 最终显示优先级

```text
有效第三方缓存/新抓取结果
> runtimeFavIconUrl
> Chrome _favicon
> 首字母
```

“第三方优先”指最终稳定结果，不要求在网络请求完成前阻塞本地图标显示。

## 7. 第三方候选验证与质量比较

每个响应必须通过以下验证：

1. HTTP 2xx；
2. Blob 非空；
3. MIME 为 `image/*`，或 MIME 不可信但实际解码成功；
4. 图片可以解码，宽高均大于 0；
5. Icon Horse 使用无图返回 404 的请求参数，不接受其默认占位响应；
6. DuckDuckGo 只接受 HTTP 2xx 且可解码的图片响应；
7. 栅格图最短边至少 32px；SVG 视为高清候选。

候选统一规范化为透明背景 64×64 PNG：

- 保持原宽高比；
- 居中绘制；
- 不拉伸、不裁剪；
- SVG 解码成功后同样 rasterize 为 PNG；
- 解码或 Canvas 转换失败视为该源失败。

并行结果选择：

1. SVG 候选优先于栅格候选；
2. 栅格候选按最短边较大者优先；
3. 质量相同时 Icon Horse 优先于 DuckDuckGo；
4. 低于 32px 的第三方结果不作为“高清升级”缓存。

## 8. 缓存模型

favicon Blob 继续使用 `favicons` store，主键保留 hostname，因为长期缓存只保存公共站点的第三方站点级图标；内网/本地候选不写该 store，因此不再存在不同内网端口共享本地缓存的问题。

`FaviconRecord` 调整为：

```ts
interface FaviconRecord {
  hostname: string;
  blob?: Blob;
  source?: 'icon-horse' | 'duckduckgo';
  mimeType?: string;
  width?: number;
  height?: number;
  fetchedAt?: number;
  expiresAt?: number;
  thirdPartyRetryAt?: number;
}
```

规则：

- 成功缓存 TTL：30 天；
- 过期成功缓存采用 stale-while-revalidate：旧图继续显示，后台刷新；
- 两个第三方源均失败：写入/更新 `thirdPartyRetryAt = now + 24h`，不写空 Blob；
- 冷却期内不重新请求第三方，直接使用本地候选；
- 手动刷新忽略 TTL 和冷却时间，强制重新抓取第三方；失败时保留原成功 Blob，不先删除旧缓存；
- 同 hostname 抓取使用模块级 `Map<string, Promise<...>>` single-flight，Promise settle 后删除 Map 项。

### 8.1 旧缓存处理

现有记录没有可信 `source` 元数据，可能包含 Chrome 默认 favicon。数据库版本从 4 升到 5；升级时只清空并重建 `favicons` store，其他业务 store 不变。favicon 不进备份，可安全重建。

## 9. Hook 状态机

`useFavicon` 接口调整为：

```ts
interface FaviconRenderSource {
  kind: 'third-party' | 'tab' | 'chrome';
  src: string;
  onError: () => void;
}

function useFavicon(
  url: string,
  runtimeFavIconUrl?: string,
): FaviconRenderSource | null;
```

行为：

1. URL 非法：返回 null，不访问 DB/网络。
2. 初始同步状态：安全的 `runtimeFavIconUrl`，否则 Chrome `_favicon`。
3. 异步读取第三方缓存：
   - 新鲜命中：切换 third-party Blob；
   - 过期命中：切换旧 Blob，并后台刷新；
   - 未命中：保持本地候选。
4. 目标为外网且不在冷却期：启动/复用 single-flight 第三方升级任务。
5. 第三方成功：创建 Blob URL、切换 third-party。
6. 第三方失败：保持当前本地候选。
7. `onError`：
   - third-party Blob 失败：使该记录失效，回退 tab/Chrome；
   - tab URL 失败：回退 Chrome；
   - Chrome `_favicon` 失败：返回 null。
8. URL、runtime favicon 变化或卸载时 revoke 由当前 hook 创建的 Blob URL；丢弃过期异步结果。

## 10. OpenTabs 接入

`useOpenTabs()` 从 `Content` 上移到 `App`，确保当前窗口只注册一套 query/listener，并将 `openTabs` 传给：

- `Content`：为每个 Bookmark 选择 `pickMostRecentMatchingTab()`，把其 `favIconUrl` 传给 BookmarkCard；
- `Sidebar` → `PinnedArea`：为每个 PinnedTab 选择匹配 Tab，把其 `favIconUrl` 传给 PinChip。

Tab 的 `onUpdated` 已触发 `useOpenTabs` 刷新；当浏览器在页面加载完成后补充 `favIconUrl`，新 prop 会驱动 `useFavicon` 立即切换本地候选。

本期不引入新的全局 store/context，使用 App 到两个直接子树的 props，避免额外状态层。

## 11. UI 行为

- BookmarkCard、PinChip、BookmarkFaviconPreview 统一把 `<img onError>` 连接到 hook 返回的 `onError`。
- 所有来源失败后显示现有首字母/问号占位。
- 本地到第三方热切换不增加额外动画；沿用图片本身渲染，避免列表大面积动画干扰。
- 手动刷新按钮表示“重新尝试第三方高清图标”；刷新失败保留当前图标并 Toast 提示。
- 设置页“清空 favicon 缓存”只清除第三方高清缓存；下次展示仍先使用浏览器本地 favicon，并后台重新升级。

## 12. 错误处理

- CORS、网络、超时、HTTP 非 2xx、解码和 Canvas 错误均按单源失败处理，不向 UI 抛出。
- 每个第三方源超时从 5 秒缩短为 3 秒；两个源并行，因此总等待上限约为 3 秒而非串行累加。
- 一个源失败不影响另一个源；使用 `Promise.allSettled()` 收集结果。
- IndexedDB 读取失败：跳过缓存，继续本地显示和第三方 best-effort 抓取。
- IndexedDB 写入失败：仍可使用本次内存 Blob，不阻断 UI。
- 手动刷新是唯一向用户报告第三方抓取失败的入口；自动升级静默。

## 13. 测试策略

写测试前遵循 `docs/standards/testing.md`。

### 13.1 FaviconService

- URL 内外网分类：localhost、私有 IPv4、IPv6、`.local`、公网域名。
- 第三方来源构造：Icon Horse 含无图 404 参数，DuckDuckGo URL 正确。
- 两源并行：一个失败一个成功；两者成功时按 SVG/尺寸/来源顺序选择。
- 空 Blob、非图片、解码失败、低于 32px 均拒绝。
- SVG 成功转换为 64×64 PNG。
- CORS reject/超时 → 返回失败并写 24h 冷却，不覆盖旧成功 Blob。
- fresh cache、stale cache、失败冷却三种读取结果。
- single-flight：同 hostname 并发调用只触发一组 fetch。
- 手动刷新忽略冷却；失败保留旧 Blob。

### 13.2 useFavicon

- runtime favicon 存在 → 首帧 tab 态。
- runtime favicon 不存在 → 首帧 Chrome `_favicon` 态。
- 第三方缓存命中 → 切 third-party Blob。
- 后台抓取成功 → 从 tab/Chrome 热切换到 third-party。
- 后台抓取失败 → 保持本地来源。
- 内网 → 不调用第三方升级。
- tab `onError` → Chrome；Chrome `onError` → null；third-party `onError` → 本地。
- URL/runtime favicon 变化与卸载时正确 revoke Blob URL。

### 13.3 组件与集成

- BookmarkCard 使用传入 runtime favicon，并在所有来源失败后显示首字母。
- PinnedArea 使用匹配 Tab favicon；图片失败后不显示破图。
- App 只调用一次 `useOpenTabs`，Content 与 Sidebar 使用同一份数组。
- `tabs.onUpdated` 补充 `favIconUrl` 后，匹配书签和 PinChip 更新。
- DB v4→v5：只重建 `favicons`，workspaces/categories/bookmarks/contexts/pinnedTabs/cryptoMetadata 不丢失。

### 13.4 最终验证

- `pnpm run typecheck`
- `pnpm run test`
- 真机：`https://chatgpt.com`、`https://platform.deepseek.com`、至少一个私有 IP/localhost URL。
- DevTools Network：内网 URL 不出现 Icon Horse/DuckDuckGo 请求。
- 清空缓存后：本地 favicon 立即显示，约 3 秒内第三方成功时热切换。

## 14. 预计改动范围

核心文件：

- `src/services/FaviconService.ts`
- `src/hooks/useFavicon.ts`
- `src/shared/types/index.ts`
- `src/shared/db/database.ts`
- `src/entrypoints/home/App.tsx`
- `src/entrypoints/home/components/Content/index.tsx`
- `src/entrypoints/home/components/Sidebar/index.tsx`
- `src/entrypoints/home/components/PinnedArea/index.tsx`
- `src/entrypoints/home/components/BookmarkCard/index.tsx`
- `src/components/BookmarkFaviconPreview/index.tsx`

测试随对应模块更新。不修改 bookmark/pinnedTab 持久化模型，不修改备份载荷，不新增 manifest host permissions。

## 15. 非目标

- 不解析目标网页 HTML 的 `<link rel="icon">`。
- 不新增任意站点 host permissions。
- 不新增用户可配置的内网 hostname 列表。
- 不缓存浏览器 `tab.favIconUrl` 或 Chrome `_favicon` Blob。
- 不把 favicon Blob 纳入备份或云同步。
- 不删除遗留 `Bookmark.faviconUrl` 字段。
- 不重构 Tab 匹配规则。

## 16. 已知限制

1. 普通 CORS 由第三方服务控制；服务未来取消 CORS 时，该源会自动降级为本地 favicon，但无法继续写入高清缓存。
2. 自定义企业内网域名若不符合第 5 节规则，会被当作外网并向第三方发送 hostname。
3. Chrome `_favicon` 仍可能显示默认图标，但它不再进入长期缓存；打开目标 Tab 后 `runtimeFavIconUrl` 会取代它。
4. 第三方服务本身可能更新延迟；30 天 TTL 到期后自动刷新，用户也可手动强制刷新。
