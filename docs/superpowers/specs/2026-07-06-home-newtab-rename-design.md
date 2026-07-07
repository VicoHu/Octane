# home 页目录归位与公用代码抽离设计

- 日期：2026-07-06
- 状态：待审阅
- 关联分支：feature/0.1.11.1
- 主题：纠正 `src/newtab/` 历史命名债务，让 home entrypoint 对齐 popup/sidepanel 既有结构

---

## 1. 背景与问题

### 1.1 WXT 目录最佳实践（权威来源：[WXT Entrypoints 文档](https://wxt.dev/guide/essentials/entrypoints.html)）

- WXT 按 `entrypoints/` 下文件名识别 entrypoint 类型，**命名即语义**。
- `newtab` entrypoint（`entrypoints/newtab.html` 或 `entrypoints/newtab/index.html`）→ WXT 自动写入 `chrome_url_overrides.newtab`，**覆盖浏览器新标签页**。
- `home` **不在** WXT 预定义类型中 → `entrypoints/home/` 是 **unlisted page**，输出 `/home.html`，经 `runtime.getURL` 打开，**不覆盖任何浏览器页面**。
- entrypoint 目录内可放相关文件（`index` 为入口，其余为它的依赖），WXT 不会把 `entrypoints/{name}/` 子目录深层文件误判为 entrypoint（"zero or one levels deep" 仅指 entrypoint 发现层）。

### 1.2 项目历史脉络

Octane 曾用 `chrome_url_overrides.newtab` 覆盖新标签页，业务代码放在 `src/newtab/`。后改为每窗口常驻一个 pinned home tab（证据：`src/entrypoints/background.ts:41`、`src/shared/tabs/focusOrCreateHomeTab.ts:4` 注释），entrypoint 随之改名为 `home`（unlisted page → `/home.html`）。

**但 `src/newtab/` 目录名与 60 处 `@/newtab/...` import 未跟上**，成为新旧交替的残留命名。

### 1.3 当前偏差

| 层 | 现状 | 是否偏差 |
|---|---|---|
| entrypoint | `src/entrypoints/home/`（unlisted page → `/home.html`） | ✅ 正确 |
| 运行时 URL | `getURL('home.html')`（background / focusOrCreateHomeTab） | ✅ 正确 |
| **业务代码目录** | **`src/newtab/`**（60 处 `@/newtab` import） | ❌ 命名债务 |
| **entrypoint 结构** | home 业务代码散落 `src/newtab/`，未与 popup/sidepanel 统一 | ❌ 结构不一致 |
| **公用组件区** | `src/components/`（backup）与 `src/shared/components/`（IconPicker）并存 | ❌ 归向不一致 |
| **过时 mock** | `popup/testUtils.ts:32` 仍返回 `newtab.html`（运行时实为 `home.html`） | ❌ 功能性偏差 |

### 1.4 关键先例：popup / sidepanel 已采用"entrypoint 目录内放业务代码"模式

`src/entrypoints/sidepanel/` 内部已有 `App.tsx` + `components/`(5) + `hooks/`(5) + `utils/` + 各 `__tests__/`，且正常运行。`src/entrypoints/popup/` 同理（`App.tsx` + `views/` + `hooks/` + 测试散落目录内）。**`home` 是项目里唯一未按此模式组织的 entrypoint**。

import 风格也已定型（见 `sidepanel/App.tsx`）：
- entrypoint 私有 → 相对路径（`./hooks/...`、`./components/...`）
- 跨目录公用 → `@/`（`@/services/...`、`@/shared/tabs/...`、`@/store/...`）

唯一破坏该约定的是 `popup/App.tsx:6`（`@/newtab/components/UnlockModal`）与 `sidepanel/components/StickyHeader.tsx:2`（`@/newtab/hooks/useFavicon`）这两个跨 entrypoint 引用 —— 正是 `StickyHeader.tsx:19` 那条 `CONCERN: 跨 entrypoint import` 注释担心的坏味道。

---

## 2. 目标

1. 消灭 `src/newtab/` 目录与全部 60 处 `@/newtab` import，消除命名债务。
2. 让 home 私有代码迁入 `src/entrypoints/home/`，与 popup/sidepanel 结构统一。
3. 把被多 entrypoint 共用的成员抽到顶层公用区，消灭跨 entrypoint import 坏味道。
4. 统一公用组件区：`src/shared/components/IconPicker` 并入 `src/components/`，`src/shared/components/` 清空删除。
5. 顺带修正与本次直接相关的过时 mock 与命名残留。

非目标：不改任何运行时行为；不重构组件内部实现；不动样式命名（home 仍用 `App.css` 全局）；不统一 backup 与新公用组件的目录深度差异。

---

## 3. 方案

### 3.1 抽公用（4 个成员 → 顶层公用区）

| 成员 | 现位置 | 目标位置 | 被谁引用 |
|---|---|---|---|
| `UnlockModal` | `src/newtab/components/UnlockModal/` | `src/components/UnlockModal/` | home App + popup App |
| `BookmarkFaviconPreview` | `src/newtab/components/BookmarkFaviconPreview/` | `src/components/BookmarkFaviconPreview/` | home BookmarkOpsPanel + home PinnedArea + popup SaveBookmarkView |
| `IconPicker` | `src/shared/components/IconPicker/` | `src/components/IconPicker/` | home Sidebar + home ManagePanel |
| `useFavicon` | `src/newtab/hooks/useFavicon.ts` | `src/hooks/useFavicon.ts`（新建 `src/hooks/`） | home (BookmarkCard/BookmarkFaviconPreview/PinnedArea) + sidepanel StickyHeader |

各成员自带的 `__tests__/` 随目录整体迁移；其中 `useFavicon` 是单文件 hook，其测试 `src/newtab/hooks/__tests__/useFavicon.test.tsx` → `src/hooks/__tests__/useFavicon.test.tsx`（新建 `src/hooks/__tests__/`）。

迁后顶层公用区划分清晰：
- `src/components/` — 公用 UI 组件（backup / UnlockModal / BookmarkFaviconPreview / IconPicker）
- `src/hooks/` — 公用 hooks（useFavicon）
- `src/shared/` — 纯逻辑与数据（db / tabs / utils / types / lastSelection）
- `src/services/` / `src/store/` — 不变

### 3.2 home 私有迁入 `src/entrypoints/home/`（照搬 sidepanel 模式）

迁入目标结构：
```
src/entrypoints/home/
├── index.html              (已存在，不动)
├── main.tsx                (已存在，改 import App from './App')
├── App.tsx                 (从 src/newtab/ 迁入)
├── App.css                 (从 src/newtab/ 迁入)
├── components/             (从 src/newtab/components/ 迁入，去掉 3.1 抽出的两件)
│   ├── Sidebar/            (含 __tests__)
│   ├── Content/            (含 __tests__)
│   ├── PinnedArea/         (含 __tests__)
│   ├── ContextList/        (含 __tests__)
│   ├── BookmarkCard/       (含 __tests__)
│   ├── BookmarkOpsPanel/   (含 __tests__)
│   ├── ContextEditor/
│   ├── ChangePasswordModal/
│   ├── ManagePanel/        (含 __tests__)
│   ├── SettingsModal/      (含 sections/ 与 __tests__)
│   ├── TabList/            (含 safeFavIcon.ts 与 __tests__)
│   └── EmptyState/
├── hooks/
│   ├── useOpenTabs.ts      (home 私有)
│   └── __tests__/useOpenTabs.test.ts
└── __tests__/
    └── App.broadcast.test.tsx
```

### 3.3 import 改写规则（消灭全部 60 处 `@/newtab`）

| 场景 | 旧 | 新 |
|---|---|---|
| home 内部自引（App 引子组件） | `@/newtab/components/Sidebar` | `./components/Sidebar` |
| home 子组件同级互引 | `@/newtab/components/BookmarkCard` | `../BookmarkCard` |
| home 引私有 hook | `@/newtab/hooks/useOpenTabs` | `./hooks/useOpenTabs` 或 `../hooks/useOpenTabs` |
| home 引自身样式 | `@/newtab/App.css` | `./App.css` |
| home / popup / sidepanel 引公用组件 | `@/newtab/components/UnlockModal` 等 | `@/components/UnlockModal` 等 |
| home / sidepanel 引公用 hook | `@/newtab/hooks/useFavicon` | `@/hooks/useFavicon` |
| 引 IconPicker | `@/shared/components/IconPicker` | `@/components/IconPicker` |
| `entrypoints/home/main.tsx` | `import App from '@/newtab/App'` | `import App from './App'` |
| `tests/home/import-reload.test.ts` | `@/newtab/App`、`@/newtab/components/*`（含 mock 路径） | `@/entrypoints/home/App`、`@/entrypoints/home/components/*`；`UnlockModal` mock 改 `@/components/UnlockModal` |

### 3.4 顺带清理（与本次直接相关）

- **功能性**：`src/entrypoints/popup/testUtils.ts:32` mock 返回值 `newtab.html` → `home.html`。
- **坏味道注释**：删除 `src/entrypoints/sidepanel/components/StickyHeader.tsx:19` 的 `CONCERN: 跨 entrypoint import` 注释（坏味道已消除）。
- **命名同步**：`src/entrypoints/sidepanel/App.tsx:21` 函数 `openNewtab()` → `openHomeTab()`。
- **指向代码位置的注释**（更新到新路径）：
  - `src/styles/semi-theme-override.css:24`：`src/newtab/App.tsx` → `src/entrypoints/home/App.tsx`
  - `src/components/backup/LocalBackupSection.module.css:1`、`LocalBackupSection.tsx:6`、`CloudBackupSection.tsx:22,24`：`popup/newtab 共享` → `popup/home 共享`
  - `src/shared/db/database.ts:51,56`：`newtab 订阅 / reload` → `home 订阅 / reload`
  - `src/shared/lastSelection.ts:8`：`newtab 首屏关键路径` → `home 首屏关键路径`
  - `src/entrypoints/home/components/SettingsModal/index.tsx:18`：`与 newtab 浅色主体` → `与 home 浅色主体`
  - `tests/services/backup-import.test.ts:97`：`newtab reload 用` → `home reload 用`
  - `tests/home/import-reload.test.ts`：`describe('newtab import reload')` → `describe('home import reload')`
- **保留历史 narrative 注释**（叙述历史事实，非路径引用）：
  - `src/shared/tabs/focusOrCreateHomeTab.ts:4`："放弃了 chrome_url_overrides.newtab"
  - `src/entrypoints/background.ts:41`："放弃 newtab override 后"

### 3.5 绝不改动

- `chrome://newtab` 字面量（浏览器自身 URL，与目录无关）：
  - `src/entrypoints/popup/utils.test.ts:37`
  - `src/entrypoints/home/hooks/__tests__/useOpenTabs.test.ts:146`（迁后路径）
  - `src/entrypoints/popup/views/SaveBookmarkView.test.tsx:73`
  - `src/entrypoints/sidepanel/utils/__tests__/url.test.ts:26`
  - `src/entrypoints/home/hooks/useOpenTabs.ts:55` 注释（指浏览器 newtab 页）

### 3.6 配置层确认（无需改动）

- `wxt.config.ts`：`srcDir: 'src'` 不变；entrypoint 名已是 `home`；不新增/删除 entrypoint。
- `tsconfig.json`：`@/* → ./src/*` 通配，覆盖新位置。
- `vitest.config.ts`：`include` 为 `src/**/*.test.ts(x)` 与 `tests/**/*.test.ts(x)`，覆盖迁移后路径。
- 运行时 `getURL('home.html')`（background / focusOrCreateHomeTab）：已是 home.html。

---

## 4. 影响面汇总

| 类别 | 范围 |
|---|---|
| 目录迁移 | `src/newtab/` 整体拆分迁出（17 个组件目录 + hooks + App + 测试）；`src/shared/components/IconPicker` → `src/components/IconPicker`；`tests/newtab` → `tests/home`；新建 `src/hooks/`、`src/entrypoints/home/{components,hooks,__tests__}/` |
| import 改写 | 60 处 `@/newtab/...` + 4 处 `@/shared/components/IconPicker` |
| 清理 | 1 处过时 mock、1 处坏味道注释、1 处函数重命名、~8 处注释更新、1 处 describe 重命名 |
| 删除 | `src/newtab/`（空）、`src/shared/components/`（空）、`tests/newtab/`（改名） |
| 不动 | `chrome://newtab` 字面量；wxt.config / alias / 运行时 URL；任何运行时行为 |

---

## 5. 验证标准（强成功标准）

1. `pnpm typecheck` 通过（`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit`）。
2. `pnpm test` 全绿（现有测试数不减少；迁移的测试在新路径被发现）。
3. `pnpm build` 成功 —— **关键**：确认 `src/entrypoints/home/` 内的大量文件不被 WXT 误判为 entrypoint（sidepanel 是先例，但 home 文件更多，需实测；build 产物中 home.html 正常生成）。
4. `grep -rn "@/newtab" src tests` 返回空（命名债务彻底清除）。
5. `grep -rn "shared/components" src tests` 返回空（公用组件区统一）。
6. 真机/手工：加载扩展，验证 home tab（pinned logo tab）、popup、sidepanel 三个入口均正常显示与交互。

---

## 6. 风险与回退

| 风险 | 概率 | 缓解 |
|---|---|---|
| WXT build 误判 `entrypoints/home/` 子文件为 entrypoint | 低（sidepanel 先例） | 验证标准 3 实测；若有问题，WXT 会在 build 期报错，易于发现 |
| import 路径遗漏 | 中 | typecheck + 验证标准 4/5 的 grep 兜底 |
| 测试 mock 路径未同步 | 中 | 测试失败会立即暴露；逐文件核对 mock 路径 |
| CSS module 引用断裂 | 低 | 连同 `index.module.css` 一起 `git mv`，不改名 |

**回退**：纯目录与 import 重构，无逻辑改动，`git revert` 即可完整回退。

---

## 7. 实施顺序建议（供 writing-plans 细化）

1. 先抽公用（4 个成员 `git mv` + 改引用方 import）→ typecheck。
2. 再迁 home 私有（`src/newtab/` 剩余整体迁入 `entrypoints/home/`）→ 改内部 import 为相对路径 → typecheck。
3. 改 entrypoints/home/main.tsx、tests/home/import-reload.test.ts → typecheck。
4. 清理（过时 mock、CONCERN 注释、openNewtab 重命名、注释更新）。
5. 删除空目录 `src/newtab/`、`src/shared/components/`。
6. 全量验证（typecheck + test + build + grep 兜底）。

每步后跑 typecheck，保证增量可定位。
