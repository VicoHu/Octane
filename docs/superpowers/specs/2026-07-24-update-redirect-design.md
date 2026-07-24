# 商店渠道更新入口重构：去商店 → 立即更新（reload）+ 扩展管理页兜底

- 日期：2026-07-24
- 状态：设计已批准（brainstorming），待实现
- 范围：商店渠道（cws/edge）检测到新版时的「关于」面板更新入口
- 关联记忆：Octane CWS 上架与渠道（PR#39，更新检测 C 方案 `onUpdateAvailable` 被动）

## 1. 背景

当前商店用户在「关于」面板看到「新版本 vX 可用」时，唯一的操作按钮是「前往商店」，点击 `chrome.tabs.create({ url: UPDATE_URL[channel] })` 跳转到 Chrome Web Store 商店页。

**问题：** 已安装的扩展在商店页**只显示「移除」按钮，从不显示「更新」按钮**——这是 Chrome 的设计，并非 bug。因此「前往商店」这个跳转对「完成更新」**毫无价值且误导**：用户点了反而更困惑。

## 2. 关键事实（网络研究 + 官方文档）

1. 商店对已装扩展只显示「移除」= 正常现象。社区标准强制更新法：`chrome://extensions` → 开「开发者模式」→ 点「更新」。
2. `chrome.runtime.onUpdateAvailable` 官方原文："Fired when an update is available, but isn't installed immediately because the app is currently running." —— 触发于「可用」而非「下载完成」。
3. **不存在「更新下载完成」事件**（无 `onUpdateDownloaded`）。`onInstalled(reason:'update')` 是更新**已应用后**才触发，可用于验证、不能用于决定何时 reload。
4. Oliver Dunk（Google 扩展团队，2024）确认：Chrome 有时「在下载完成前就报告有更新」（大扩展/慢网络更明显），且无 API 可靠获知下载完成时机。`requestUpdateCheck()` + `reload()` 因此有「下载未完成即 reload → 更新未应用」的边界风险。

## 3. 目标

- 解决核心矛盾：点「更新」不再跳到一个没法更新的页面。
- 商店渠道提供**一键丝滑更新**（`reload`）作为主操作。
- 因 API 无法可靠检测 reload 是否生效，提供 `chrome://extensions` **常驻兜底**，让用户在 reload 没起效时总有手动出路。
- 外科手术式：只动必需的 UI，复用现有 SW 闭环逻辑。

## 4. 非目标（YAGNI）

- 不动 `manual` 渠道（GitHub Releases，`onUpdateAvailable` 不触发，无此问题）。
- 不动「已是最新」状态。
- 不改 `UPDATE_URL` 定义（`manual` 仍用；`cws/edge` 值保留无害，未来 Edge 上架可能复用）。
- 不引入「reload 失败后自动浮现兜底」的状态机（需额外 storage 标记 + 三态 UI，过度工程；常驻兜底链接更简单透明）。
- 不动 `UpdateStore`（已有完整测试）与 `background.ts`（已挂 `onInstalled(update)→clearPendingUpdate` 闭环）。

## 5. 现状（已核实）

- `src/entrypoints/background.ts:43` — `onUpdateAvailable` → `savePendingUpdate(version)`。
- `src/entrypoints/background.ts:54-69` — `onInstalled`，`reason==='update'` → `clearPendingUpdate()`（**已存在，零改动**）。
- `src/services/UpdateStore.ts` — `readPendingUpdate` 含 semver 兜底（pending.version > 本地版本才有效）。
- `src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx` — `UpdateStatus` 三分支：manual（Releases）/ 商店+pending（「前往商店」）/ 商店无 pending（「已是最新」）。
- `src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx` — 现测「CWS+pending → 前往商店 → tabs.create(UPDATE_URL.cws)」（将被改写）。

## 6. 方案

商店渠道 + pendingVersion 分支改为**一个区块两处入口**：

- **主按钮「立即更新」** → `await chrome.runtime.requestUpdateCheck()`（强制即时检查）→ `chrome.runtime.reload()`（应用待装更新）。
- **次要小字链接「未生效？在扩展管理页手动更新」** → `chrome.tabs.create({ url: 'chrome://extensions' })` 常驻兜底。
- 保留说明文「新版本将通过商店自动更新（审核可能有延迟）。」

### 为何常驻兜底而非「失败后浮现」
API 无法可靠检测 reload 是否生效。常驻入口无需额外 storage 标记即可让用户在 reload 没起效时手动出路——两态而非三态，更简单。

### 闭环（验证机制）
```
点「立即更新」
  → requestUpdateCheck()（throttled/异常都忽略，因 pendingUpdate 已证明有更新）
  → reload()
        ├─ 常见：更新应用 → SW onInstalled(reason:'update') 触发
        │       → clearPendingUpdate() → home 重开显示「已是最新」✓
        └─ 边界（下载未完成）：版本未变 → onInstalled(update) 不触发
                → pendingUpdate 保留 → home 重开仍显示 pendingVersion
                → 用户点次要链接 → chrome://extensions 手动「更新」
```
判断依据：reload 后 `onInstalled(reason:'update')` 触发 ≡ 更新成功（更新应用才触发，可靠）。

## 7. 改动文件

| 文件 | 改动 |
|---|---|
| `src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx` | `UpdateStatus` 商店+pending 分支：主按钮改「立即更新」（`requestUpdateCheck`+`reload`），加次要链接跳 `chrome://extensions`；`ChromeLike` 接口加 `runtime.requestUpdateCheck` / `runtime.reload` |
| `src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx` | 改写「CWS+pending」用例：主按钮断言 `requestUpdateCheck`+`reload` 被调；新增用例断言次要链接 `tabs.create({url:'chrome://extensions'})`；`setupChrome` 加 `requestUpdateCheck`/`reload` mock |
| `src/entrypoints/background.ts` | **零改动**（已挂 `onInstalled(update)→clearPendingUpdate`） |
| `src/services/UpdateStore.ts` | **零改动**（已有完整测试） |

新增常量：`chrome://extensions` URL。内联于 `AboutSection.tsx`（如 `const EXTENSIONS_PAGE_URL = 'chrome://extensions'`），不污染 `distribution.ts`（其语义是「渠道更新页」，与此处「手动兜底页」不同）。

## 8. 错误处理

- `requestUpdateCheck()` 返回 `throttled` / `no_update` / 抛异常 → **一律忽略后仍 `reload()`**：`pendingUpdate` 存在即证明确有更新，不依赖检查结果。`reload` 本身极少失败。
- reload 后若更新未应用（边界），`pendingUpdate` 自然保留，home 重开复现提示，次要链接兜底——无需额外错误态。

## 9. 代价（已告知用户并接受）

`chrome.runtime.reload()` 中断当前扩展会话——home/newtab/sidepanel 全部重载。持久化数据（IndexedDB / storage）与工作区配置不丢；运行时临时状态（如工作区标签隔离的会话追踪）会重置。

## 10. 测试策略（方案 B Testing Trophy）

- **改写** `AboutSection.test.tsx`「CWS 渠道有 pending」用例：渲染主按钮「立即更新」+ 次要链接；点击主按钮断言 `requestUpdateCheck` 与 `reload` 被调（顺序：先 check 后 reload）。
- **新增**「次要链接 → chrome://extensions」用例：点击断言 `tabs.create({ url: 'chrome://extensions' })`。
- mock 边界：`setupChrome` 在 `chromeObj.runtime` 加 `requestUpdateCheck: vi.fn().mockResolvedValue(...)` 与 `reload: vi.fn()`；其余沿用现有 `installChromeStorageLocal` + `tabs.create` mock。不 mock 被测组件本身。
- query：主按钮 `getByRole('button', { name: '立即更新' })`；次要入口沿用现有 `Button variant="link"`（渲染为 `<button>`，role=button），用 `getByRole('button', { name: /扩展管理页手动更新/ })`。
- 不改 `UpdateStore.test.ts`（已覆盖）。

## 11. 验证（强成功标准）

1. `pnpm run typecheck` 绿。
2. `pnpm run test` 绿（含改写/新增的 AboutSection 用例）。
3. 真机 QA（手动）：商店渠道下，构造 `onUpdateAvailable`（或装旧版等商店推新版）→ home「关于」见「立即更新」+ 次要链接；点「立即更新」→ 扩展 reload → 重开显示「已是最新」；次要链接打开 `chrome://extensions`。

## 12. 风险

- **`chrome://extensions` 可被扩展打开**：业界标准做法（Bitwarden、1Password 等「打开扩展管理页」沿用），Chromium 对扩展开放管理类 chrome:// 页。技术上高可行，**需真机验证一次**（官方 tabs 文档未明列 `chrome://` 限制）。
- **reload 边界风险**：Octane 小扩展（zip ~600KB），且 `onUpdateAvailable` 触发远早于用户点击（通常几分钟到数小时窗口），下载基本已就绪；Dunk 警告的边界概率极低，且有 `chrome://extensions` 常驻兜底。
