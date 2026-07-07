# home 页目录归位与公用代码抽离 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 home 业务代码从 `src/newtab/` 归位到 `src/entrypoints/home/`(与 popup/sidepanel 结构统一),抽离 4 个跨 entrypoint 共用成员到 `src/components` 与 `src/hooks`,消灭全部 60 处 `@/newtab` import,零运行时行为变更。

**Architecture:** 纯机械重构,三阶段:(1) 抽公用(git mv + 全局 import 替换);(2) 迁 home 私有(git mv + 内部 import 改相对路径);(3) 清理过时 mock/注释/命名 + 全量验证。安全网 = 现有测试套件(typecheck + test)+ build + grep 兜底。**无新测试、无新行为** —— 这是重构,不是功能开发,故 writing-plans 的 TDD 节奏适配为"现有测试在每步后保持全绿"。

**Tech Stack:** WXT 0.20、React 19、TypeScript 6、Vitest 4、pnpm 10.11、Semi Design。

**Spec:** `docs/superpowers/specs/2026-07-06-home-newtab-rename-design.md`

## Global Constraints

- 包管理器:**pnpm**(禁 npm),版本 pnpm@10.11.0。
- typecheck:`pnpm run typecheck`(= `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit`),依赖 `.wxt/`(当前已存在;若被清,先跑一次 `pnpm run dev` 生成)。
- test:`pnpm run test`(= `vitest run`)。
- build:`pnpm run build`(= `timeout 10 wxt build`)。
- husky gate:pre-commit = lint,pre-push = typecheck + test(提交即自动触发)。
- 语言:注释/日志/测试描述用中文(本计划无新代码,仅迁移与改名)。
- **绝不改** `chrome://newtab` 字面量(浏览器自身 URL)。
- **绝不改运行时行为**:不得改动任何组件逻辑、样式命名(home 仍用全局 `App.css`)、props、API 调用。
- 目录迁移一律用 `git mv`(保留历史);删除空目录用 `rm -rf` 后 `git add -A`。
- macOS BSD sed:必须 `sed -i ''`(空串后缀)。
- 每个 Task 末尾 commit;message 用 conventional commits,本计划统一 `refactor:` 前缀。

## File Structure(迁移后目标,详见 spec §3.2)

- `src/components/{UnlockModal,BookmarkFaviconPreview,IconPicker}/` — 公用组件(从 newtab 与 shared/components 抽出)
- `src/hooks/useFavicon.ts` + `src/hooks/__tests__/useFavicon.test.tsx` — 公用 hook(新建 `src/hooks/`)
- `src/entrypoints/home/{App.tsx,App.css,components/,hooks/,__tests__/}` — home 私有(从 `src/newtab/` 迁入)
- 删除:`src/newtab/`(空)、`src/shared/components/`(空)
- `tests/home/import-reload.test.ts`(由 `tests/newtab/` 改名)

---

## Task 1: 抽离 4 个公用成员

**Files:**
- Move: `src/newtab/components/UnlockModal/` → `src/components/UnlockModal/`
- Move: `src/newtab/components/BookmarkFaviconPreview/` → `src/components/BookmarkFaviconPreview/`
- Move: `src/shared/components/IconPicker/` → `src/components/IconPicker/`
- Move: `src/newtab/hooks/useFavicon.ts` → `src/hooks/useFavicon.ts`
- Move: `src/newtab/hooks/__tests__/useFavicon.test.tsx` → `src/hooks/__tests__/useFavicon.test.tsx`
- Modify: 上述 4 个 import 模式的全仓库引用方

**验证锚点(本任务无新行为):**
- `grep -rn "@/newtab/components/UnlockModal\|@/newtab/components/BookmarkFaviconPreview\|@/newtab/hooks/useFavicon\|@/shared/components/IconPicker" src tests` → 空
- `pnpm run typecheck` 绿;`pnpm run test` 绿(测试数不减)

**Interfaces:**
- Produces:`@/components/UnlockModal`、`@/components/BookmarkFaviconPreview`、`@/components/IconPicker`、`@/hooks/useFavicon`(供 Task 2/3 及后续引用)

- [ ] **Step 1: git mv 4 个成员到公用区**

```bash
# 组件(目录整体迁,含 __tests__ 与 *.module.css)
git mv src/newtab/components/UnlockModal src/components/UnlockModal
git mv src/newtab/components/BookmarkFaviconPreview src/components/BookmarkFaviconPreview
git mv src/shared/components/IconPicker src/components/IconPicker

# hook(新建 src/hooks/ 与 src/hooks/__tests__/)
mkdir -p src/hooks/__tests__
git mv src/newtab/hooks/useFavicon.ts src/hooks/useFavicon.ts
git mv src/newtab/hooks/__tests__/useFavicon.test.tsx src/hooks/__tests__/useFavicon.test.tsx
```

- [ ] **Step 2: 全局替换 4 个 import 模式(macOS sed)**

```bash
grep -rl "@/newtab/components/UnlockModal" src tests | xargs sed -i '' 's|@/newtab/components/UnlockModal|@/components/UnlockModal|g'
grep -rl "@/newtab/components/BookmarkFaviconPreview" src tests | xargs sed -i '' 's|@/newtab/components/BookmarkFaviconPreview|@/components/BookmarkFaviconPreview|g'
grep -rl "@/newtab/hooks/useFavicon" src tests | xargs sed -i '' 's|@/newtab/hooks/useFavicon|@/hooks/useFavicon|g'
grep -rl "@/shared/components/IconPicker" src tests | xargs sed -i '' 's|@/shared/components/IconPicker|@/components/IconPicker|g'
```

- [ ] **Step 3: grep 验证 4 个旧引用已清空**

```bash
grep -rn "@/newtab/components/UnlockModal\|@/newtab/components/BookmarkFaviconPreview\|@/newtab/hooks/useFavicon\|@/shared/components/IconPicker" src tests
```
Expected: 无输出。有残留则手动修正。

- [ ] **Step 4: typecheck**

Run: `pnpm run typecheck`
Expected: 通过。

- [ ] **Step 5: test**

Run: `pnpm run test`
Expected: 全绿,测试数与迁移前一致。

- [ ] **Step 6: commit**

```bash
git add -A
git commit -m "refactor: 抽离公用成员 UnlockModal/BookmarkFaviconPreview/IconPicker/useFavicon 到 src/components 与 src/hooks"
```

---

## Task 2: 迁 home 私有代码到 src/entrypoints/home/ + 改相对 import

**Files:**
- Move: `src/newtab/{App.tsx,App.css}` → `src/entrypoints/home/`
- Move: `src/newtab/__tests__/App.broadcast.test.tsx` → `src/entrypoints/home/__tests__/`
- Move: `src/newtab/hooks/useOpenTabs.ts` + `__tests__/useOpenTabs.test.ts` → `src/entrypoints/home/hooks/`
- Move: `src/newtab/components/`(剩余 12 个组件目录)→ `src/entrypoints/home/components/`
- Move: `tests/newtab/` → `tests/home/`
- Modify: `src/entrypoints/home/main.tsx`(App import 改相对)
- Modify: home 内部所有 `@/newtab/` import → 相对路径
- Modify: `tests/home/import-reload.test.ts`(import/mock/describe)
- Delete: `src/newtab/`(空)

**验证锚点:**
- `grep -rn "@/newtab" src tests` → 空
- `pnpm run typecheck` 绿;`pnpm run test` 绿

**Interfaces:**
- Produces:`@/entrypoints/home/App`(供 `tests/home/import-reload.test.ts` 引用);home 内部统一相对路径(`./`、`../`),对齐 sidepanel 风格。

**相对路径改写规则(按文件所在目录层级):**

| 文件目录 | `@/newtab/components/` → | `@/newtab/hooks/` → | `@/newtab/App` → | `@/newtab/App.css` → |
|---|---|---|---|---|
| `entrypoints/home/`(App.tsx) | `./components/` | `./hooks/` | — | `./App.css` |
| `entrypoints/home/components/X/`(各组件 index.tsx) | `../`(同级互引) | `../../hooks/` | `../../App`(若有) | — |
| `entrypoints/home/components/SettingsModal/sections/` | `../../` | `../../../hooks/` | — | — |
| `entrypoints/home/__tests__/` | `../components/` | `../hooks/` | `../App` | — |

- [ ] **Step 1: git mv home 私有代码到 entrypoints/home/**

```bash
# 创建目标子目录
mkdir -p src/entrypoints/home/components src/entrypoints/home/hooks/__tests__ src/entrypoints/home/__tests__

# App + 样式 + 广播测试
git mv src/newtab/App.tsx src/entrypoints/home/App.tsx
git mv src/newtab/App.css src/entrypoints/home/App.css
git mv src/newtab/__tests__/App.broadcast.test.tsx src/entrypoints/home/__tests__/App.broadcast.test.tsx

# useOpenTabs(home 私有 hook)
git mv src/newtab/hooks/useOpenTabs.ts src/entrypoints/home/hooks/useOpenTabs.ts
git mv src/newtab/hooks/__tests__/useOpenTabs.test.ts src/entrypoints/home/hooks/__tests__/useOpenTabs.test.ts

# 剩余 12 个组件目录整体迁(Task 1 已抽走 UnlockModal / BookmarkFaviconPreview)
git mv src/newtab/components/* src/entrypoints/home/components/
```

- [ ] **Step 2: 改 entrypoints/home/main.tsx**

`src/entrypoints/home/main.tsx:7`:
```tsx
// 旧
import App from '@/newtab/App';
// 新
import App from './App';
```

- [ ] **Step 3: 改 home 生产文件 import 为相对路径(按目录分批)**

```bash
# (a) App.tsx:@/newtab/ → ./
sed -i '' 's|@/newtab/|./|g' src/entrypoints/home/App.tsx

# (b) components/*/index.tsx(非 sections、非 __tests__):
#     @/newtab/components/ → ../  ;  @/newtab/hooks/ → ../../hooks/
for f in $(grep -rl "@/newtab/" src/entrypoints/home/components --include="*.tsx" --include="*.ts" | grep -v __tests__ | grep -v /sections/); do
  sed -i '' -e 's|@/newtab/components/|../|g' -e 's|@/newtab/hooks/|../../hooks/|g' "$f"
done

# (c) components/SettingsModal/sections/*.tsx(更深一层):
#     @/newtab/components/ → ../../  ;  @/newtab/hooks/ → ../../../hooks/
for f in $(grep -rl "@/newtab/" src/entrypoints/home/components/SettingsModal/sections --include="*.tsx" 2>/dev/null); do
  sed -i '' -e 's|@/newtab/components/|../../|g' -e 's|@/newtab/hooks/|../../../hooks/|g' "$f"
done
```

- [ ] **Step 4: 改 home 测试文件 mock/import 路径**

```bash
# App.broadcast.test.tsx(在 home/__tests__/):@/newtab/ → ../
sed -i '' 's|@/newtab/|../|g' src/entrypoints/home/__tests__/App.broadcast.test.tsx

# components/*/__tests__/:与生产文件同层级规则
for f in $(grep -rl "@/newtab/" src/entrypoints/home/components --include="*.test.tsx" --include="*.test.ts" | grep -v /SettingsModal/__tests__); do
  sed -i '' -e 's|@/newtab/components/|../|g' -e 's|@/newtab/hooks/|../../hooks/|g' "$f"
done

# SettingsModal/__tests__/(在 components/SettingsModal/__tests__/,比 sections 父层级浅一层):
for f in $(grep -rl "@/newtab/" src/entrypoints/home/components/SettingsModal/__tests__ --include="*.test.tsx" 2>/dev/null); do
  sed -i '' -e 's|@/newtab/components/|../../|g' -e 's|@/newtab/hooks/|../../../hooks/|g' "$f"
done
```

注意:`entrypoints/home/hooks/__tests__/useOpenTabs.test.ts` 含 `chrome://newtab/`(line 146,浏览器 URL)**不要动**;若它还有 `@/newtab/` 引用,按层级(`../../components/`、`../../App`)手动改。先 `grep -n "@/newtab" src/entrypoints/home/hooks/__tests__/useOpenTabs.test.ts` 确认。

- [ ] **Step 5: 迁 tests/newtab → tests/home,改 import-reload.test.ts**

```bash
git mv tests/newtab tests/home
```

修改 `tests/home/import-reload.test.ts`(此文件在 tests/ 下,用 `@/entrypoints/home/...` 绝对路径,不对齐 home 内部相对风格):
- `vi.mock('@/newtab/components/Sidebar', ...)` → `vi.mock('@/entrypoints/home/components/Sidebar', ...)`
- `vi.mock('@/newtab/components/Content', ...)` → `vi.mock('@/entrypoints/home/components/Content', ...)`
- `vi.mock('@/newtab/components/UnlockModal', ...)` → `vi.mock('@/components/UnlockModal', ...)`(Task 1 已抽公用;Step 2 全局 sed 若已改此行可跳过,先 `grep -n "UnlockModal" tests/home/import-reload.test.ts` 确认)
- `await import('@/newtab/App')` → `await import('@/entrypoints/home/App')`(2 处,line 31/60)
- `describe('newtab import reload', ...)` → `describe('home import reload', ...)`

- [ ] **Step 6: grep 验证 @/newtab 彻底清空**

```bash
grep -rn "@/newtab" src tests
```
Expected: 无输出。有残留对照"相对路径改写规则"表修正。

- [ ] **Step 7: 删除空目录 src/newtab/**

```bash
rm -rf src/newtab
git add -A
ls src/newtab 2>/dev/null || echo "(已删除)"
```

- [ ] **Step 8: typecheck**

Run: `pnpm run typecheck`
Expected: 通过。失败多为相对路径深度算错 —— 看 error 文件对照规则表修正。

- [ ] **Step 9: test**

Run: `pnpm run test`
Expected: 全绿,测试数与 Task 1 后一致。

- [ ] **Step 10: commit**

```bash
git add -A
git commit -m "refactor: home 业务代码归位 src/entrypoints/home/,内部 import 改相对路径,消灭 @/newtab"
```

---

## Task 3: 清理过时 mock / 注释 / 命名 + 全量验证

**Files:**
- Modify: `src/entrypoints/popup/testUtils.ts:32`(过时 mock)
- Modify: `src/entrypoints/sidepanel/components/StickyHeader.tsx`(删 CONCERN 注释)
- Modify: `src/entrypoints/sidepanel/App.tsx`(openNewtab → openHomeTab)
- Modify: ~7 处指向代码位置的注释
- Delete: `src/shared/components/`(空)

**验证锚点(spec §5 全部 6 条):**
- `pnpm run typecheck` 绿
- `pnpm run test` 绿
- `pnpm run build` 成功(WXT 不误判 entrypoints/home/ 文件)
- `grep -rn "@/newtab" src tests` → 空
- `grep -rn "shared/components" src tests` → 空
- 真机三入口正常

- [ ] **Step 1: 修正过时 mock**

`src/entrypoints/popup/testUtils.ts:32`:
```ts
// 旧
runtime: { getURL: vi.fn().mockReturnValue('chrome-extension://x/newtab.html') },
// 新
runtime: { getURL: vi.fn().mockReturnValue('chrome-extension://x/home.html') },
```

- [ ] **Step 2: 删 CONCERN 注释**

删除 `src/entrypoints/sidepanel/components/StickyHeader.tsx` 第 19 行附近的注释:
```
// CONCERN: 跨 entrypoint import（sidepanel → newtab/hooks）。wxt/vite 可解析，
```
(useFavicon 已是 `@/hooks/useFavicon` 公用,坏味道消除。)

- [ ] **Step 3: openNewtab → openHomeTab**

`src/entrypoints/sidepanel/App.tsx`:
- line 21:`function openNewtab()` → `function openHomeTab()`
- 同文件所有 `openNewtab()` 调用 → `openHomeTab()`

验证:`grep -n "openNewtab" src/entrypoints/sidepanel/App.tsx` → 空

- [ ] **Step 4: 更新指向代码位置的注释**

```bash
# semi-theme-override.css
sed -i '' 's|src/newtab/App.tsx|src/entrypoints/home/App.tsx|g' src/styles/semi-theme-override.css

# backup 区:popup/newtab 共享 → popup/home 共享
sed -i '' 's|popup/newtab 共享|popup/home 共享|g' src/components/backup/LocalBackupSection.module.css src/components/backup/LocalBackupSection.tsx src/components/backup/CloudBackupSection.tsx

# database.ts
sed -i '' -e 's|供 newtab 整体 reload|供 home 整体 reload|g' -e 's|newtab 订阅后整体 reload|home 订阅后整体 reload|g' src/shared/db/database.ts

# lastSelection.ts
sed -i '' 's|newtab 首屏关键路径|home 首屏关键路径|g' src/shared/lastSelection.ts

# SettingsModal
sed -i '' 's|与 newtab 浅色主体|与 home 浅色主体|g' src/entrypoints/home/components/SettingsModal/index.tsx

# backup-import.test.ts
sed -i '' 's|newtab reload 用|home reload 用|g' tests/services/backup-import.test.ts
```

**保留** history narrative(不改):`src/shared/tabs/focusOrCreateHomeTab.ts:4` "放弃了 chrome_url_overrides.newtab"、`src/entrypoints/background.ts:41` "放弃 newtab override 后"。

- [ ] **Step 5: 删除空目录 src/shared/components/**

```bash
rm -rf src/shared/components
git add -A
ls src/shared/components 2>/dev/null || echo "(已删除)"
```

- [ ] **Step 6: grep 兜底**

```bash
grep -rn "@/newtab" src tests           # 期望:空
grep -rn "shared/components" src tests  # 期望:空
```

- [ ] **Step 7: typecheck**

Run: `pnpm run typecheck` — Expected: 通过。

- [ ] **Step 8: test**

Run: `pnpm run test` — Expected: 全绿。

- [ ] **Step 9: build(关键:验证 WXT 不误判 entrypoints/home/ 文件)**

Run: `pnpm run build`
Expected: 成功,无 "treated as entrypoint" 类报错;`.output/chrome-mv3/` 下 `home.html`、`popup.html`、`sidepanel.html` 均生成。

- [ ] **Step 10: commit**

```bash
git add -A
git commit -m "refactor: 清理 newtab 残留(过时 mock/注释/函数名),统一公用组件区"
```

- [ ] **Step 11: 真机/手工验证**

- `pnpm run dev` 加载扩展到 Chrome
- home tab:新窗口自动出现 pinned home tab;Alt+Shift+H 聚焦;书签/上下文/PinnedArea 正常
- sidepanel:Alt+Shift+S 打开;StickyHeader favicon 正常;"在 Octane 管理" 跳 home tab 正常
- popup 入口(若触发):UnlockModal、BookmarkFaviconPreview 正常
- 控制台无报错

---

## Self-Review

**1. Spec coverage:**
- spec §3.1(抽 4 公用成员)→ Task 1 ✓
- spec §3.2(home 私有迁入结构)→ Task 2 Step 1 ✓
- spec §3.3(import 改写规则)→ Task 1 Step 2(公用)+ Task 2 Step 3/4(相对路径)+ Task 2 Step 5(tests)✓
- spec §3.4(清理:过时 mock / CONCERN / openNewtab / 注释 / describe)→ Task 3 Step 1-4 ✓
- spec §3.5(绝不改 chrome://newtab)→ Global Constraints + Task 2 Step 4 注意事项 ✓
- spec §3.6(配置层无需改)→ Global Constraints 已声明 ✓
- spec §5(6 条验证标准)→ Task 3 Step 6-11 全覆盖 ✓

**2. Placeholder scan:** 无 TBD/TODO/"implement later";所有 step 含具体命令或确切新旧代码。✓

**3. Type consistency:** 纯重构无新 type。Task 1 产出 `@/components/*`、`@/hooks/useFavicon`,Task 2/3 消费,路径一致。Task 2 相对路径规则表覆盖 home 全部 4 个目录层级(App.tsx / components/X / components/SettingsModal/sections / __tests__)。✓
