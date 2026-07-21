# tab 视图「存为常驻标签」设计

> 状态:设计已确认,待 review
> 日期:2026-07-20
> 分支:`feature/0.1.13.1`

## 1. 目标与范围

### 目标
在 home 页面「标签页」视图(`TabList`)的每个 tab 卡片,新增「存为常驻标签」按钮,与现有「存为书签」并列。用户可把当前窗口任一已打开的 tab 收入**当前工作区**的常驻标签(`PinnedTab`)。

### 语义澄清
- 「常驻标签」= 项目既有的 `PinnedTab` 实体(per-workspace 跨分类,展示于 Sidebar 的 `PinnedArea`)。**非** Chrome 原生 pinned tab(项目里原生 pin 叫「已固定」,TabCard 上 `MapPin` 角标)。
- 「存为书签」存到**当前分类**(走 `openAddForTab` → Modal,要选分类 + 填描述);「存为常驻标签」存到**当前工作区**(跨分类,无需分类/描述)。

### 在范围
- 新建共享 `AddPinnedTabDialog` 组件(提取自 `PinnedArea` 内联 Modal)
- 重构 `PinnedArea` 改用共享组件(行为不变,回归测试保绿)
- `TabList` / `TabCard` 新增「存为常驻标签」按钮 + 前置 dedup/cap
- `Content` 接入常驻标签数据流
- 导出 `normalizePinnedTabUrl` 供前置 dedup 复用

### 不在范围
- 不改 Chrome 原生 pinned tab 行为
- 不改常驻标签 service 层约束(scheme/dedup/cap 不变)
- 不改备份/分享对 pinnedTabs 的处理(`BACKUP_VERSION` 不变)
- 不改书签按钮(外科手术原则)

## 2. 现状盘点

### 常驻标签(PinnedTab)既有链路
- **类型**(`src/shared/types/index.ts`):`PinnedTab { id, workspaceId, name, url, order, createdAt }`,per-workspace 跨分类。
- **service**(`src/services/PinnedTabService.ts`):
  - `createPinnedTab(workspaceId, {name, url})` 单 readwrite 事务原子校验:① `assertValidUrl` 仅 http/https;② dedup(同工作区同规范 URL 抛 `该 URL 已是该工作区的常驻标签`);③ cap(`PINNED_TAB_CAP = 8`,超限抛错);④ `order = 现有最大 + 1`。
  - 私有 `normalizeUrl(raw)`:小写 protocol+host、pathname 缺省补 `/`、保留 query、去 hash —— **dedup 比较真源**。
- **store**(`src/store/usePinnedTabs.ts`):全局单例。`loadPinnedTabs(workspaceId)` 带 `loadSeq` guard(防切工作区 A→B 串台);`createPinnedTab` 不吞错,cap/dedup 向上抛;切片追加返回新 pin。
- **现有创建入口**:`PinnedArea`(`src/entrypoints/home/components/PinnedArea/index.tsx`)的 `+` 按钮 → atCap Toast 警告 → 否则打开内联 `Dialog`(URL + 名称手填 + `BookmarkFaviconPreview`)→ `handleCreate` → `createPinnedTab` → 成功 Toast「已常驻」/ 失败 Toast.warning。

### 标签页视图既有链路
- `useOpenTabs`(`src/entrypoints/home/hooks/useOpenTabs.ts`):监听当前窗口 tab,已过滤内部页(`chrome://` / `edge://` / `about:` / `chrome-extension://`),按 `index` 升序返回。`OpenTab { url, tabId, lastAccessed, title?, favIconUrl?, pinned?, index? }`。
- `TabList` / `TabCard`(`src/entrypoints/home/components/TabList/index.tsx`):props `{ tabs, bookmarks, currentCategoryId, onTabClick, onSaveTab }`。每个 `TabCard` 右侧 actions:`[MapPin 原生pin 展示?] [存为书签(Plus)]`。「存为书签」前置 dedup:`bookmarks.some(bm => bookmarkMatchesOpenTab(bm.url, tab.url))` 命中 → favicon 角 `BookmarkIcon` 角标 + 按钮禁用(Tooltip「已在书签库」)。
- `Content`(`src/entrypoints/home/components/Content/index.tsx`):持有 `currentWorkspaceId` / `currentCategoryId`;`saveFromTab` state + `openAddForTab` 驱动书签 Modal;tab 视图顶部有「保存至:{分类}」提示(仅对书签准确)。

### 关键差异:常驻标签 vs 书签的保存目标
| 维度 | 书签 | 常驻标签 |
|---|---|---|
| 归属 | 当前**分类**(categoryId) | 当前**工作区**(workspaceId,跨分类) |
| 必填字段 | name + url + 分类 + 描述 | name + url |
| dedup 规则 | `bookmarkMatchesOpenTab`(host + pathname 段边界前缀) | `normalizePinnedTabUrl`(protocol+host+pathname+query) |
| 上限 | 无 | 8 / 工作区 |

## 3. 方案决策(用户已确认)
- **交互形态**:弹 Modal 预填(url + 名称预填 tab 值,可改后确定)。理由:与 Sidebar `PinnedArea` 创建入口一致,允许改名。
- **实现方案 A**:提取共享 `AddPinnedTabDialog` + 前置 dedup。理由:DRY(消除 Modal 重复)、UX 与书签「已收藏」角标对称。

## 4. 组件设计

### (a) 新建 `AddPinnedTabDialog`
路径:`src/entrypoints/home/components/AddPinnedTabDialog/index.tsx`(home 级共享,`PinnedArea` + `Content` 都用)。

**Props**
```ts
interface AddPinnedTabDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** 预填 URL(tab 入口传 tab.url;PinnedArea 入口传空串) */
  initialUrl?: string;
  /** 预填名称(tab 入口传 tab.title;PinnedArea 入口传空串) */
  initialName?: string;
  /** 创建成功回调(可选) */
  onCreated?: (pin: PinnedTab) => void;
}
```

**行为**
- 内部 `url` / `name` state。`open` 由 `false→true` 时一次性重置为当时的 `initialUrl` / `initialName`(预填机制;实现用 `useEffect(() => { if (open) { setUrl(initialUrl ?? ''); setName(initialName ?? ''); } }, [open])`,只依赖 `open` 以避免 Dialog 开着时被 `initialUrl` 变化误触发)。Dialog 是模态(`disablePointerDismissal`),打开期间背后点不到其他 tab,无需处理「开着时换源」。
- 复用 `PinnedArea` 现有 Dialog 结构:`Dialog` + `DialogContent` + `DialogTitle`「添加常驻标签」+ `Input`(URL)+ `Input`(名称)+ `BookmarkFaviconPreview` + `DialogFooter`「确定」。
- 从 `usePinnedTabs` 读 `pinnedTabs`(算 `atCap = pinnedTabs.length >= PINNED_TAB_CAP`)+ `createPinnedTab`。
- 「确定」`handleCreate`:trim url/name → 空值直接 return(不提交)→ `createPinnedTab(workspaceId, {url, name})` → 成功 `Toast.success(\`已常驻「${name}」\`)` + `onCreated?.(pin)` + `onOpenChange(false)`;失败 `Toast.warning((e as Error).message)` 且**不关闭**(让用户改后重试)。
- `atCap` 时「确定」按钮 `disabled`。

### (b) 重构 `PinnedArea`
- 移除内联 Modal state(`url` / `name` / `modalOpen`)与 `Dialog` JSX 及 `handleCreate`(迁入共享组件)。
- 新增 `addOpen` state;`handleAddClick`:atCap → `Toast.warning(...)`(保留),否则 `setAddOpen(true)`。
- 渲染 `<AddPinnedTabDialog open={addOpen} onOpenChange={setAddOpen} workspaceId={workspaceId} initialUrl="" initialName="" />`。
- `handleDelete` / 拖拽排序 / chip 渲染**不动**。
- **行为不变,回归测试保绿(硬指标)。**

### (c) 扩展 `TabList` / `TabCard`
**`TabList` props 新增**
```ts
pinnedTabs: PinnedTab[];        // 当前工作区常驻标签(前置 dedup 数据源)
onPinTab: (tab: OpenTab) => void;
```

**`TabCard` props 新增**:`pinned: boolean`(dedup 命中)+ `canPin: boolean`(!atCap)+ `onPin: () => void`。

**dedup 判定**(在 `TabList.map` 内,每 tab):
```ts
const pinned = pinnedTabs.some(
  (p) => normalizePinnedTabUrl(p.url) === normalizePinnedTabUrl(tab.url),
);
const canPin = pinnedTabs.length < PINNED_TAB_CAP;
```

**导出 `normalizePinnedTabUrl`**:把 `PinnedTabService` 私有 `normalizeUrl` 重命名并 `export`(文件内自用同步改名,dedup 真源单一)。`TabList` `import { normalizePinnedTabUrl } from '@/services/PinnedTabService'`。注意与 `@/shared/tabs/matchUrl` 的 `normalizeUrl`(host+pathname,不同规则)区分。

**按钮 UI**(actions 区,现有 `[MapPin?] [存为书签]` 之后):
- `Pin` icon-only `Button` variant="ghost" + `Tooltip`「存为常驻标签」(lucide `Pin`,与原生 `MapPin` 区分;书签按钮不动)。
- disabled 条件:`pinned || !canPin`。
- Tooltip 文案:`pinned` →「已常驻」;`!canPin` →「常驻已满(N/8)」;否则「存为常驻标签」。
- 「已常驻」视觉:**仅按钮 disabled + Tooltip**(不加 favicon 角标,避免与书签 saved 角标拥挤;已决议)。

### (d) `Content` 接入
- 从 `usePinnedTabs` 取 `pinnedTabs`;`useEffect(() => { if (currentWorkspaceId) void loadPinnedTabs(currentWorkspaceId); }, [currentWorkspaceId, loadPinnedTabs])`(与 `PinnedArea` 各自 load,store `loadSeq` guard 防串台,同 workspace 幂等无害)。
- `pinFromTab: OpenTab | null` state + `pinDialogOpen: boolean`;`openPinForTab(tab) { setPinFromTab(tab); setPinDialogOpen(true); }`(镜像现有 `saveFromTab` 模式)。
- 渲染:
```tsx
<AddPinnedTabDialog
  open={pinDialogOpen}
  onOpenChange={setPinDialogOpen}
  workspaceId={currentWorkspaceId}
  initialUrl={pinFromTab?.url ?? ''}
  initialName={pinFromTab?.title ?? ''}
/>
```
- 给 `<TabList>` 传 `pinnedTabs={pinnedTabs}` + `onPinTab={openPinForTab}`。

## 5. 数据流
```
点「存为常驻标签」
 → Content.openPinForTab(tab)
 → AddPinnedTabDialog 预填 url=tab.url / name=tab.title
 → 用户改/确认 → 确定
 → usePinnedTabs.createPinnedTab(workspaceId, {name, url})
 → PinnedTabService 单事务原子校验(scheme/dedup/cap)→ 入库 + broadcastChange
 → store 切片追加 pinnedTabs
 → TabList 重渲染 → 命中 dedup 的 tab 按钮 disabled
 → Toast.success「已常驻」
失败(dedup/cap/scheme)→ Dialog 内 Toast.warning,不关闭
```

## 6. 错误处理
| 边界 | 前置(UI) | 兜底(service) |
|---|---|---|
| scheme(仅 http/https) | `useOpenTabs` 已过滤内部页,tab url 均合法 | `assertValidUrl` 抛错 → Toast.warning |
| dedup(同工作区同规范 URL) | 按钮 disabled + Tooltip「已常驻」 | 单事务 `normalizePinnedTabUrl` 比较抛错 → Toast.warning |
| cap(8 / 工作区) | 按钮 disabled + Tooltip「常驻已满 N/8」;Dialog 内「确定」亦 disabled | `existing.length >= CAP` 抛错 → Toast.warning |
| load 失败 | store 静默保上次切片(既有行为) | — |

**并发安全**:cap 前置仅作 UI 提示,真值由 service 单 readwrite 事务保证(防 TOCTOU)。前置 disabled 不构成安全依赖。

## 7. 测试计划
遵循 `docs/standards/testing.md`:真实渲染 `@/components/ui/*` 与被测组件,只 mock 副作用边界(`PinnedTabService` 或 DB 层,参考 `PinnedArea/__tests__/PinnedArea.test.tsx` 既有模式);Toast 走命令式 mock。query 用 `getByRole` / `getByLabelText` / `getByText`,交互用 `userEvent`,断言用 jest-dom matcher。

**场景**
1. `AddPinnedTabDialog`
   - `open=true` + `initialUrl/initialName`:输入框预填正确
   - 输入合法值 → 点「确定」→ 调 `createPinnedTab` 一次,参数 = workspaceId + 预填/编辑值
   - `createPinnedTab` reject(dedup/cap)→ `Toast.warning` 被调,Dialog 仍 `open`(不关闭)
   - `pinnedTabs.length >= 8` → 「确定」按钮 disabled
   - `open` 由 false→true → url/name 重置为最新 `initialUrl/initialName`(防上次残留)
2. `PinnedArea` **回归**(重构未改行为):添加常驻标签 / 删除 / 拖拽排序 / atCap Toast —— 全绿
3. `TabList` / `TabCard`
   - `pinnedTabs` 含同规范 URL 的 tab → 该 tab「存为常驻标签」按钮 disabled,Tooltip「已常驻」
   - `pinnedTabs.length >= 8` → 所有 tab 的常驻按钮 disabled,Tooltip「常驻已满 8/8」
   - 点启用的常驻按钮 → `onPinTab` 以该 tab 被调
   - dedup 用真实 `normalizePinnedTabUrl`(query 差异不算重复,host 大小写归一算重复)
4. `Content`:`openPinForTab` → Dialog 预填 `tab.url` / `tab.title`;`pinnedTabs` 正确透传 `TabList`

**绿标准**:`pnpm run typecheck` + `pnpm run test` 双绿(husky pre-push 已强制 typecheck + test)。

## 8. 范围与风险
- **重构 `PinnedArea`**:提取共享 Modal,有测试覆盖。回归保绿是硬指标;改动限于 Modal state/JSX,删除/排序逻辑不动。
- **导出 `normalizePinnedTabUrl`**:重命名 PinnedTabService 内私有函数并 export。风险:与 `matchUrl.normalizeUrl` 同名不同义 —— 通过语义化命名 + alias import 消歧;全仓搜索确认无其他 caller 依赖旧私有名(私有本无外部 caller)。
- **`TabList` props 变更**:仅 `Content` 一个 caller,改动可控。
- **二次 load**:`Content` 与 `PinnedArea` 各自 `loadPinnedTabs(workspaceId)`,store `loadSeq` guard 保平安,同 workspace 幂等。

## 9. 交付清单
- [ ] `src/services/PinnedTabService.ts`:导出 `normalizePinnedTabUrl`(原 `normalizeUrl` 重命名)
- [ ] `src/entrypoints/home/components/AddPinnedTabDialog/index.tsx`:新建共享组件
- [ ] `src/entrypoints/home/components/PinnedArea/index.tsx`:重构改用共享组件
- [ ] `src/entrypoints/home/components/TabList/index.tsx`:加常驻按钮 + 前置 dedup/cap
- [ ] `src/entrypoints/home/components/Content/index.tsx`:接入常驻数据流 + Dialog
- [ ] 测试:`AddPinnedTabDialog` / `PinnedArea` 回归 / `TabList` / `Content`
- [ ] 双绿:typecheck + test
