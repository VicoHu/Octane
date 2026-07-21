# 关于 Tab + sidebar 版本号 + 新版本更新提示

- 日期：2026-07-22
- 分支：`feature/about-update-check`（待建；当前在 `feature/cloud-versioning`）
- 状态：设计定稿（经 `/plan-ceo-review` 审查，需求 3 从「完整双源」简化为 C 方案）
- CWS 扩展 ID：`odelppbgchjofnnncknfnbapghggihlj`

## 背景

三个用户需求：

1. 设置中心缺「关于 Octane」项 → 增加该 Tab，显示作者、开源仓库、当前版本号。
2. 版本号同时显示在 sidebar「Octane」title 右侧。
3. 有新版本时提示用户，并引导更新。

需求 3 引出两个产品策略问题（经 `/plan-ceo-review` 澄清）：

- **能否识别分发渠道？** 能。`chrome.runtime.id` 零权限可精确区分 CWS / Edge / 手动安装（不同商店签名 key → 不同 extension ID）。`chrome.management.getSelf()` 路线需要 `management` 权限（权限过重，弃用）。
- **如何引导更新？** Octane 已上架 CWS、计划上 Edge、同时保留 GitHub Release。不同渠道更新机制不同，引导需按渠道区分。

补充：用户提出支持 `chrome.runtime.onUpdateAvailable`（Chrome 检测到商店更新包时被动推送），与主动检查互补。

## 关键决策（CEO review 结论）

### 决策 1：渠道识别 — 做（零权限）

`chrome.runtime.id` 匹配已知商店 ID：

| 渠道 | 判定 | 更新页 URL |
|---|---|---|
| `cws` | `runtime.id === 'odelppbgchjofnnncknfnbapghggihlj'` | `https://chromewebstore.google.com/detail/odelppbgchjofnnncknfnbapghggihlj` |
| `edge` | `runtime.id === EDGE_ID`（待上架后补） | `https://microsoftedge.microsoft.com/addons/detail/<EDGE_ID>` |
| `manual` | 其余（开发 unpacked / GitHub Release 装载） | `https://github.com/VicoHu/Octane/releases` |

未知 ID 一律 fallback `manual`（安全默认）。

### 决策 2：更新检测 — C 方案（纯被动 + 纯跳转）

经审查推翻了最初的「完整双源」设计，简化为：

- **被动层 `chrome.runtime.onUpdateAvailable`（全渠道，零权限）**：Chrome 后台检测到商店更新包时触发，`details.version` 为即将安装的版本。background 顶层 listener → 写 `storage.local.pendingUpdate`；home 读取显示。
- **按渠道「前往更新页」链接**：用户点按渠道跳对应更新页（CWS 详情 / Edge 详情 / GitHub Releases）。
- **不做 GitHub 主动 fetch**。

**为何砍掉主动 GitHub 检查**（CEO review 挑战 2/3/4）：

1. **商店用户误报**：GitHub Release tag 必然领先 CWS 上架版本（审核延迟数小时~数天）。用 GitHub 版本对比 CWS 用户 → 看到"有新版"但 CWS 还没有 → 困惑。
2. **onUpdateAvailable 已覆盖商店用户被动感知**：主动 fetch 的真实服务对象只有 manual 用户。
3. **成本**：GitHub fetch 需 `optional_host_permissions` + `PRIVACY.md` 增条 + CWS 审核增量；对一个 "nice to have" 的更新检测不划算。

**关键技术现实**：CWS / Edge **没有公开 API** 让扩展查询"自己在该商店的最新已发布版本"。CWS/Edge 用户的更新感知只能靠 `onUpdateAvailable`（Chrome 代查商店）+ 商店自动更新。能主动 fetch 对比的只有 GitHub，而它对商店用户必然误报。

**manual 用户的取舍**：unpacked 扩展不触发 `onUpdateAvailable`，且选 C 后无主动对比。manual 用户靠关于 Tab 的「前往 GitHub Releases」链接主动查看版本。这是 C 方案（Completeness 7/10）的已知取舍，用户接受。

## 架构分层

| 层 | 文件 | 职责 |
|---|---|---|
| shared | `src/shared/distribution.ts`（新） | `detectChannel()` + 渠道→更新页 URL 表 + 渠道文案 |
| background | `src/entrypoints/background.ts`（改） | +`onUpdateAvailable` 写 `storage.local.pendingUpdate`；+`onInstalled(update)` 清理 |
| hook | `src/entrypoints/home/hooks/usePendingUpdate.ts`（新） | 读 `storage.local.pendingUpdate` + `storage.onChanged` 监听 + semver 兜底过滤 |
| UI | `src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx`（新） | 版本 / 渠道 chip / 作者 / 仓库 / 反馈 + 按渠道「前往更新页」+ pendingUpdate 提示 |
| UI | `src/entrypoints/home/components/SettingsModal/index.tsx`（改） | Tabs 改受控 + `initialTab` prop（供 sidebar 标记跳转） |
| UI | `src/entrypoints/home/components/Sidebar/index.tsx`（改） | header 加版本号 + pendingUpdate 小标记 |
| 配置 | `wxt.config.ts` | **不改**（零权限增量） |

## 数据流

```
  Chrome 后台检查商店更新
            │
            ▼
  background.ts (顶层 listener)
  runtime.onUpdateAvailable(details)
            │  写 storage.local.pendingUpdate = { version: details.version }
            ▼
  ┌─────────────────────────────────┐
  │  storage.local (pendingUpdate)  │
  └─────────────────────────────────┘
            │  storage.onChanged 广播
            ▼
  home: usePendingUpdate()  ──读 + semver 兜底(version<=本地则忽略并清)──▶ 状态
            │
            ├──▶ Sidebar header: 版本号 + pendingUpdate 小标记(↑)
            └──▶ AboutSection: 「新版本 vX 可用」+ 按渠道「前往更新页」按钮

  更新实际安装后:
  runtime.onInstalled(reason='update') ──▶ storage.local.remove('pendingUpdate')  (提示消失)
```

## 组件设计

### `src/shared/distribution.ts`

纯函数 + 常量，零权限，零网络。

```ts
export type Channel = 'cws' | 'edge' | 'manual';

const CWS_EXTENSION_ID = 'odelppbgchjofnnncknfnbapghggihlj';
// Edge 上架后补：const EDGE_EXTENSION_ID = '...';

const UPDATE_URL: Record<Channel, string> = {
  cws: `https://chromewebstore.google.com/detail/${CWS_EXTENSION_ID}`,
  edge: 'https://microsoftedge.microsoft.com/addons/detail/<EDGE_ID>', // 待补
  manual: 'https://github.com/VicoHu/Octane/releases',
};

const CHANNEL_LABEL: Record<Channel, string> = {
  cws: 'Chrome 商店版',
  edge: 'Edge 商店版',
  manual: '手动安装',
};

// runtime.id 读取；未知 ID fallback manual
export function detectChannel(id: string): Channel { /* ... */ }
export function getUpdateUrl(channel: Channel): string { /* ... */ }
export function getChannelLabel(channel: Channel): string { /* ... */ }
```

### background.ts 增量

顶层注册（沿用现有 `onInstalled` 模式，避免 SW 唤醒时序丢事件）：

```ts
// Chrome 检测到商店更新包（details.version 为待装版本）→ 持久化供 home 读取显示。
// 不调用 runtime.reload()（不强制重启，仅提示）。
browser.runtime.onUpdateAvailable.addListener((details) => {
  browser.storage.local.set({ pendingUpdate: { version: details.version } })
    .catch((e) => console.error('[octane] onUpdateAvailable 写 storage 失败', e));
});

// 更新实际安装后清理提示（避免残留）。挂在现有 onInstalled listener 的 update 分支。
// onInstalled 里：if (reason === 'update') { ensureHomeTab...; browser.storage.local.remove('pendingUpdate'); }
```

### `usePendingUpdate.ts`

```ts
// 读 storage.local.pendingUpdate；storage.onChanged 监听多窗口同步；
// semver 兜底：pendingUpdate.version <= getManifest().version 则视为无效（忽略 + 清除）。
export function usePendingUpdate(): { version: string | null } { /* ... */ }
```

### AboutSection

内容（自上而下）：

- **Octane** + 版本号 `v{getManifest().version}`（如 `v0.1.13.0`）
- **渠道 chip**：`detectChannel()` → `Chrome 商店版` / `Edge 商店版` / `手动安装`
- **作者**：VicoHu → `https://github.com/VicoHu`（`chrome.tabs.create` 外链）
- **开源仓库**：VicoHu/Octane → `https://github.com/VicoHu/Octane`
- **License**：本期不显示（仓库根暂无 LICENSE 文件，见 `TODOS.md`「待确认 — 插件 License」）
- **检查更新区**：
  - 有 pendingUpdate（商店用户被动收到）→ 「新版本 vX.X.X 可用」+ 按渠道「前往更新页」主按钮（CWS→CWS 详情页 / Edge→Edge 详情页）+ 文案「新版本将通过商店自动更新（审核可能有延迟）」
  - 无 pendingUpdate + manual 渠道 → 「前往 GitHub Releases 查看新版本」按钮 + 文案「手动安装不会收到自动更新提示，请定期查看」
  - 无 pendingUpdate + 商店渠道 → 「已是最新版本」（静默，商店自动更新）
- **反馈 / 报告问题**：`https://github.com/VicoHu/Octane/issues`

### SettingsModal 改动

Tabs 由 `defaultValue="shortcuts"` 改为受控（`value` + `onValueChange`），新增 `initialTab?: string` prop。Sidebar 版本标记点击时 `setShowSettings(true)` + `initialTab="about"`。

### Sidebar header 改动

`index.tsx:140-143` header 内 title 右侧追加：

```tsx
<div className={styles.title}>Octane</div>
<span className={styles.version}>v{version}</span>
{pendingUpdate && (
  <span className={styles.updateBadge} title={`新版本 v${pendingUpdate.version} 可用，点击查看`}
        onClick={() => { setShowSettings(true); setInitialTab('about'); }}>↑</span>
)}
```

`.version` 样式：小号、`var(--sidebar-text-muted)`、`font-weight: 400`、左侧小间距。`.updateBadge`：小标记，`cursor: pointer`。

## 失败模式与边界

| # | 模式 | 处理 |
|---|---|---|
| 1 | manual 用户 `onUpdateAvailable` 不触发 | C 方案已知取舍；关于 Tab manual 渠道文案提示定期查看 Releases |
| 2 | pendingUpdate 残留（更新已装未清） | `onInstalled(update)` 清理；`usePendingUpdate` 启动时 semver 兜底（`version<=本地` 忽略并清） |
| 3 | SW 休眠丢事件 | `onUpdateAvailable` 顶层注册（沿用 `onInstalled` 模式） |
| 4 | 渠道 ID 不匹配 | 未知 ID fallback `manual`（安全）；Edge ID 上架后补 |
| 5 | `storage` 读写失败 | 写 try/catch + `console.error`；读失败降级不显示（不阻塞 UI） |
| 6 | pendingUpdate.version <= 本地版本 | `usePendingUpdate` semver 比较，忽略并清除 |
| 7 | 外链安全 | URL 硬编码常量（`distribution.ts`），无外部输入，无注入；`chrome.tabs.create` |
| 8 | sidebar 标记点击去向 | 打开 SettingsModal 并切到「关于」Tab（Tabs 受控 + `initialTab`） |
| 9 | 多窗口 / 多 home 实例 | 都读同一 `storage.local`，`storage.onChanged` 广播同步；全读无竞态 |
| 10 | 版本号格式 | `getManifest().version` 返回 `0.1.13.0`（无 v 前缀）；显示统一加 `v` 前缀 |

## 测试策略（对齐 `docs/standards/testing.md`）

- **`distribution.ts`**（纯函数）：`detectChannel()` ID→渠道映射（CWS ID 命中 / 未知 ID fallback manual）；URL / label 表。mock `chrome.runtime.id`。
- **background 增量**：`onUpdateAvailable` → 写 `storage.local.pendingUpdate`；`onInstalled(update)` → 清理。mock `browser.runtime` / `browser.storage` 副作用边界，不 mock 被测逻辑。
- **`usePendingUpdate`**：读 storage + `storage.onChanged` 触发更新 + semver 兜底过滤（pending version<=本地 → 忽略并清）。
- **AboutSection**：真实渲染 ui 组件；各渠道（cws/edge/manual）× 各 pendingUpdate 状态（有/无）的渲染矩阵；引导按钮跳转 URL 正确；`userEvent` 点击外链触发 `chrome.tabs.create`。不整体 mock ui 组件。
- **Sidebar**：版本号渲染；pendingUpdate 标记出现/消失；标记点击打开设置关于 Tab。
- chrome API mock 最小子集（参考 `ShortcutsSection` 的 `declare const chrome` 模式）。
- 提交前 `pnpm run typecheck` + `pnpm run test` 双绿。

## 权限与 CWS 合规

- **零权限增量**：`onUpdateAvailable` 是 `runtime` 事件（无权限）；`storage.local` 已有 `storage` 权限；`runtime.id` 零权限；`chrome.tabs.create` 已有 `tabs` 权限；渠道识别纯本地。
- **零 PRIVACY 增量**：不联网（`onUpdateAvailable` 是本地 Chrome 事件；`storage.local` 本地；外链由用户主动点击）。无需改 `docs/PRIVACY.md`。
- CWS 审核友好（无新权限警告、无新网络访问）。

## 不做（YAGNI）

- GitHub 主动 fetch 检查（C 方案砍掉；避免商店误报 + 权限/PRIVACY 成本）
- `optional_host_permissions` / `host_permissions` 增量
- `PRIVACY.md` 更新
- fetch / 版本对比状态机（只有 pendingUpdate 有/无两态）
- `management` 权限路线（权限过重）
- 自动后台检测（alarms + fetch 轮询）
- Edge 渠道 URL 精确化（ID 待上架后补，先占位）
- 内嵌 changelog 展示（Release notes 直接走 GitHub Releases 页）
- 自建各渠道独立版本源

## 待确认

- **License**：仓库根暂无 LICENSE 文件。「关于」是否显示 License 项待确认仓库实际 License 类型（已记入 `TODOS.md`「待确认 — 插件 License」）。本期不显示。
- **Edge 扩展 ID**：上架后补入 `distribution.ts`。
