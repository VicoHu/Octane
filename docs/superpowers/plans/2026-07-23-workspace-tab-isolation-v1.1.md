# 工作区标签隔离 v1.1（hide 模式）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 切换行为设置从 2 档（off/close）扩到 4 档，加「折叠·省内存」（hide-discard）和「折叠·保状态」（hide）——离开工作区时折叠 tabGroup（discard 档额外释放内存），切回展开，tab 不关。

**Architecture:** 复用 v1 `requestWorkspaceSwitch` 编排骨架。`performSwitch` 加 `mode` 参数，按 mode 拆 `archiveByMode`/`disposeByMode`/`restoreByMode` 子函数（控圈复杂度）。tabGroup 用 title 拼 workspaceId 哈希作稳定唯一标识，两路径回找（标识回找→兜底 restore）。归属语义：group membership=工作区归属，散 tab=当前 binding ws。失败不更新 binding。undo 入 per-window 串行队列 + generation token。

**Tech Stack:** Chrome MV3（tabGroups/tabs.group/tabs.discard）、React 19、TypeScript、WXT、vitest、@testing-library/react、shadcn/ui (Base UI)、zustand、chrome.storage.local。

## Global Constraints

- **语言**：中文（代码注释、日志、测试描述），技术标识符保留原文。
- **测试规范**：`docs/standards/testing.md` 方案 B——只 mock 副作用边界（chrome API / DB / Toast），真实渲染 `@/components/ui/*`；query 用 `getByRole`/`getByText`；交互用 `userEvent`；断言用 jest-dom matcher。
- **chrome 访问范式**：函数体内 `getChrome()` 读 `chrome as unknown as ChromeLike`，非扩展环境返回 null（参考 v1 `workspaceSwitch.ts`）。
- **fake-browser stub**：WXT fake-browser 的 `tabGroups.*`/`tabs.group`/`tabs.discard` 是未实现 stub，`tests/setup.ts` beforeEach 注入（FIFO 在 per-test reset 后）——T0 阻塞前提。
- **提交前**：`pnpm run typecheck` + `pnpm run test` 双绿（husky pre-push 自动跑 typecheck+test）。
- **外科手术**：只改必要部分；v1 close 路径行为不变（回归测试守护）。
- **DESIGN.md**：tabGroup color 统一 grey（绿仅 accent）；UI 文案 rev5 用户语言。

---

## File Structure

| 文件 | 职责 | 操作 |
|---|---|---|
| `tests/setup.ts` | fake-browser stub 注入（tabGroups/group/discard） | Modify（T0） |
| `src/shared/tabIsolationSetting.ts` | setting type + get/set（加 hide-discard\|hide） | Modify（T1） |
| `wxt.config.ts` | manifest 加 `tabGroups` 权限 | Modify（T1） |
| `src/shared/tabs/tabGroupIdentity.ts` | wsHash + title 格式化/解析 + 标识回找 | Create（T2） |
| `src/shared/tabs/workspaceSwitch.ts` | ChromeLike 扩展 + archiveByMode/disposeByMode/restoreByMode + performSwitch mode 集成 + 失败状态机 + undo generation + normalize | Modify（T3-T7） |
| `src/shared/tabs/workspaceSwitch.ts` 类型 | SwitchResult 加 mode/快照；SwitchPhase 不变 | Modify（T3） |
| `src/entrypoints/home/utils/workspaceSwitcher.tsx` | switchWorkspaceBySetting 门控 hide 档 | Modify（T8） |
| `src/entrypoints/home/components/SettingsModal/sections/WorkspaceTabsSection.tsx` | RadioGroup 4 档 + 首启 AlertDialog 扩展 | Modify（T8） |
| `src/store/useWorkspace.ts` | deleteWorkspace hide 孤儿组清理 | Modify（T9） |

测试文件：每个 task 的 `__tests__/` 对应文件。

---

## Task 0: fake-browser stub（tabGroups/group/discard）— 阻塞前提

**Files:**
- Modify: `tests/setup.ts`（beforeEach 加 tabGroups/group/discard 注入）
- Test: `tests/setup.ts` 自身（通过后续 task 测试间接验证）

**Interfaces:**
- Produces: `globalThis.chrome.tabGroups`（get/query/update 实现）+ `chrome.tabs.group`/`ungroup`/`discard`/`update` 可用，所有 hide 测试依赖。

**背景**：WXT fake-browser 未实现这些 API（memory wxt-fake-browser-test-stub）。beforeEach FIFO：fake-browser reset 先，本 setup 的 beforeEach 后，故本 setup 覆盖 reset。每个测试自建 chrome mock 时自行覆盖（参考既有 `installChromeStorageLocal` 范式）。

- [ ] **Step 1: 扩展 setup.ts beforeEach 注入 stub**

在 `tests/setup.ts` 的 `beforeEach(() => {...})` 内，`if (c?.storage)` 块**之后**追加 tabGroups/tabs 注入。stub 用 per-test 内存状态（Map）模拟 group/tab 持久：

```typescript
  // T0: hide 模式依赖 chrome.tabGroups + tabs.group/ungroup/discard/update。
  // WXT fake-browser 未实现这些（memory wxt-fake-browser-test-stub），注入最小内存实现。
  // FIFO：fake-browser reset 先，本 beforeEach 后，故覆盖 reset。
  // 测试自建 chrome mock 覆盖时自行补全（参考 installChromeStorageLocal 范式）。
  if (c) {
    const chromeAny = c as Record<string, any>;
    // tabGroups 内存态：groupId → {id, windowId, title, color, collapsed}
    const groups = new Map<number, any>();
    let nextGroupId = 1;
    chromeAny.tabGroups = {
      get: async (gid: number) => {
        const g = groups.get(gid);
        if (!g) throw new Error(`Group ${gid} not found`);
        return { ...g };
      },
      query: async (info: { windowId?: number } = {}) =>
        Array.from(groups.values()).filter(
          (g) => info.windowId == null || g.windowId === info.windowId,
        ),
      update: async (gid: number, props: Partial<{ collapsed: boolean; title: string; color: string }>) => {
        const g = groups.get(gid);
        if (!g) throw new Error(`Group ${gid} not found`);
        Object.assign(g, props);
        return { ...g };
      },
    };
    // tabs 内存态：tabId → {id, windowId, url, groupId, active, pinned, ...}
    const tabsStore = new Map<number, any>();
    let nextTabId = 1;
    // chrome.tabs 可能已由 fake-browser 提供部分；补齐 group/ungroup/discard/update/query/create/remove。
    chromeAny.tabs = chromeAny.tabs ?? {};
    const t = chromeAny.tabs;
    t.query = t.query ?? (async (info: any = {}) =>
      Array.from(tabsStore.values()).filter(
        (tab: any) =>
          (info.windowId == null || tab.windowId === info.windowId),
      ));
    t.create = t.create ?? (async (props: any) => {
      const id = nextTabId++;
      const tab = { id, groupId: -1, active: false, ...props };
      tabsStore.set(id, tab);
      return { ...tab };
    });
    t.remove = t.remove ?? (async (id: number) => {
      tabsStore.delete(id);
    });
    t.update = t.update ?? (async (id: number, props: any) => {
      const tab = tabsStore.get(id);
      if (!tab) throw new Error(`Tab ${id} not found`);
      Object.assign(tab, props);
      return { ...tab };
    });
    t.discard = async (id: number) => {
      const tab = tabsStore.get(id);
      if (!tab) throw new Error(`Tab ${id} not found`);
      if (tab.active) throw new Error('Cannot discard active tab');
      return { ...tab, discarded: true };
    };
    t.group = async (opts: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }) => {
      let gid = opts.groupId;
      if (gid == null) {
        gid = nextGroupId++;
        groups.set(gid, { id: gid, windowId: opts.createProperties?.windowId ?? -1, title: '', color: 'grey', collapsed: false });
      }
      for (const tid of opts.tabIds) {
        const tab = tabsStore.get(tid);
        if (tab) tab.groupId = gid;
      }
      return gid;
    };
    t.ungroup = async (tabIds: number[]) => {
      for (const tid of tabIds) {
        const tab = tabsStore.get(tid);
        if (tab) tab.groupId = -1;
      }
    };
    // 暴露给测试重置/种子（测试通过 globalThis.chrome.tabs 访问）
    (chromeAny as any).__testGroups = groups;
    (chromeAny as any).__testTabs = tabsStore;
  }
```

- [ ] **Step 2: 验证 setup 不破坏现有测试**

Run: `pnpm run test -- --run 2>&1 | tail -20`
Expected: 现有 v1 测试全绿（stub 注入不影响 close 路径；tabGroups/tabs 扩展是新增字段）。

- [ ] **Step 3: Commit**

```bash
git add tests/setup.ts
git commit -m "test(ws-tab-iso): T0 fake-browser stub 注入 tabGroups/group/discard（hide 前提）"
```

---

## Task 1: tabIsolationSetting 加 hide 档 + manifest 权限

**Files:**
- Modify: `src/shared/tabIsolationSetting.ts`
- Modify: `wxt.config.ts`（permissions 加 `tabGroups`）
- Test: `src/shared/__tests__/tabIsolationSetting.test.ts`

**Interfaces:**
- Produces: `TabIsolationSetting = 'off' | 'close' | 'hide-discard' | 'hide'`；`getTabIsolationSetting` 接受新两档；`setTabIsolationSetting` 写新两档。

- [ ] **Step 1: 写失败测试**

追加到 `src/shared/__tests__/tabIsolationSetting.test.ts`：

```typescript
describe('tabIsolationSetting hide 档', () => {
  it('getTabIsolationSetting 接受 hide-discard / hide（默认 off）', async () => {
    const { getTabIsolationSetting, setTabIsolationSetting } = await import('../tabIsolationSetting');
    await setTabIsolationSetting('hide-discard');
    expect(await getTabIsolationSetting()).toBe('hide-discard');
    await setTabIsolationSetting('hide');
    expect(await getTabIsolationSetting()).toBe('hide');
    // 非法值回退 off
    await setTabIsolationSetting('unknown' as never);
    expect(await getTabIsolationSetting()).toBe('off');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run src/shared/__tests__/tabIsolationSetting.test.ts`
Expected: FAIL（getTabIsolationSetting 不认 hide-discard，回退 off）。

- [ ] **Step 3: 修改 tabIsolationSetting.ts**

```typescript
export type TabIsolationSetting = 'off' | 'close' | 'hide-discard' | 'hide';

const VALID: TabIsolationSetting[] = ['off', 'close', 'hide-discard', 'hide'];

// getTabIsolationSetting：把 `return r[KEY] === 'close' ? 'close' : 'off';` 改为：
export async function getTabIsolationSetting(): Promise<TabIsolationSetting> {
  const local = getLocal();
  if (!local) return 'off';
  const r = await local.get([KEY]);
  const v = r[KEY];
  return VALID.includes(v as TabIsolationSetting) ? (v as TabIsolationSetting) : 'off';
}
```

- [ ] **Step 4: 加 manifest 权限**

`wxt.config.ts` 的 `manifest.permissions` 数组加 `'tabGroups'`：

```typescript
permissions: ['storage', 'tabs', 'tabGroups', 'sidePanel', 'favicon'],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run test -- --run src/shared/__tests__/tabIsolationSetting.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/shared/tabIsolationSetting.ts wxt.config.ts src/shared/__tests__/tabIsolationSetting.test.ts
git commit -m "feat(ws-tab-iso): T1 setting 加 hide-discard/hide 档 + tabGroups 权限"
```

---

## Task 2: tabGroupIdentity helper（wsHash + title + 标识回找）

**Files:**
- Create: `src/shared/tabs/tabGroupIdentity.ts`
- Test: `src/shared/tabs/__tests__/tabGroupIdentity.test.ts`

**Interfaces:**
- Produces:
  - `wsHash(workspaceId: string): string` —— 去横线前 8 hex（跨重启稳定、重名唯一）
  - `makeGroupTitle(workspaceName: string, workspaceId: string): string` —— `${name} ·${wsHash}`
  - `IDENTITY_SUFFIX(wsId: string): string` —— ` ·${wsHash}`（匹配用）
  - `findGroupByIdentity(windowId: number, workspaceId: string): Promise<number | null>` —— tabGroups.query 本窗 + 精确匹配后缀；唯一命中返回 groupId，否则 null（0 或多结果歧义）
- Consumes: `chrome.tabGroups.query`（通过 getChrome）

- [ ] **Step 1: 写失败测试**

`src/shared/tabs/__tests__/tabGroupIdentity.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { wsHash, makeGroupTitle, findGroupByIdentity } from '../tabGroupIdentity';

describe('tabGroupIdentity', () => {
  it('wsHash：去横线前 8 hex，跨重启稳定', () => {
    expect(wsHash('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400');
    expect(wsHash('550E8400-e29b-41d4')).toBe('550e8400'); // 小写化
  });

  it('makeGroupTitle：工作区名 + 标识后缀', () => {
    expect(makeGroupTitle('工作', '550e8400-e29b-41d4')).toBe('工作 ·550e8400');
  });

  describe('findGroupByIdentity', () => {
    beforeEach(() => {
      // 种子 tabGroups（用 setup.ts 注入的 __testGroups）
      const c = (globalThis as any).chrome;
      c.__testGroups.clear();
      let gid = (c as any).__nextGid ?? 100;
      c.__testGroups.set(gid, { id: gid, windowId: 1, title: '工作 ·550e8400', color: 'grey', collapsed: false });
      c.__testGroups.set(gid + 1, { id: gid + 1, windowId: 1, title: '学习 ·abc12345', color: 'grey', collapsed: true });
    });

    it('唯一命中返回 groupId', async () => {
      const gid = await findGroupByIdentity(1, '550e8400-e29b-41d4');
      expect(gid).toBe(100);
    });

    it('未命中返回 null（走兜底 restore）', async () => {
      expect(await findGroupByIdentity(1, '00000000-0000-0000')).toBeNull();
    });

    it('多结果歧义返回 null（不任选，走兜底）', async () => {
      const c = (globalThis as any).chrome;
      c.__testGroups.set(102, { id: 102, windowId: 1, title: '副本 ·550e8400', color: 'grey', collapsed: false });
      expect(await findGroupByIdentity(1, '550e8400-e29b-41d4')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/tabGroupIdentity.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 tabGroupIdentity.ts**

```typescript
/**
 * tabGroup 稳定标识：Chrome tabGroup 的 groupId 会话内唯一但重启后变（C3 易失），
 * 无自定义元数据字段（只有 title/color/collapsed）。用 title 拼 workspaceId 派生哈希
 * 作跨重启稳定、重名唯一的标识。wsHash = workspaceId 去横线前 8 hex（UUID 前 8 位
 * 碰撞概率 << 工作区数）。用户可编辑 title 删标识 → 回找不到 → 走兜底 restore（容忍）。
 */

declare const chrome: unknown;

interface TabGroupLike {
  id: number;
  windowId: number;
  title?: string;
}

interface ChromeLike {
  tabGroups: {
    query(info: { windowId?: number }): Promise<TabGroupLike[]>;
  };
}

function getChrome(): ChromeLike | null {
  const c = chrome as unknown as ChromeLike | undefined;
  if (!c?.tabGroups?.query) return null;
  return c;
}

/** workspaceId 去横线前 8 hex，小写。跨重启稳定、重名工作区唯一。 */
export function wsHash(workspaceId: string): string {
  return workspaceId.replace(/-/g, '').slice(0, 8).toLowerCase();
}

/** 标识后缀（匹配用）：` ·${wsHash}`。 */
export function IDENTITY_SUFFIX(workspaceId: string): string {
  return ` ·${wsHash(workspaceId)}`;
}

/** tabGroup title：`${工作区名} ·${wsHash}`。 */
export function makeGroupTitle(workspaceName: string, workspaceId: string): string {
  return `${workspaceName}${IDENTITY_SUFFIX(workspaceId)}`;
}

/**
 * 在窗口内按标识回找 tabGroup。唯一命中返回 groupId；未命中 / 多结果（wsHash 碰撞
 * 或用户复制组）返回 null → 调用方走兜底 restore（重建组，不任选防关错组）。
 */
export async function findGroupByIdentity(
  windowId: number,
  workspaceId: string,
): Promise<number | null> {
  const c = getChrome();
  if (!c) return null;
  const suffix = IDENTITY_SUFFIX(workspaceId);
  const groups = await c.tabGroups.query({ windowId });
  const matched = groups.filter((g) => g.title?.endsWith(suffix));
  return matched.length === 1 ? matched[0]!.id : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/tabGroupIdentity.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/shared/tabs/tabGroupIdentity.ts src/shared/tabs/__tests__/tabGroupIdentity.test.ts
git commit -m "feat(ws-tab-iso): T2 tabGroupIdentity（wsHash + title 标识 + 回找）"
```

---

## Task 3: ChromeLike 扩展 + archiveByMode

**Files:**
- Modify: `src/shared/tabs/workspaceSwitch.ts`（ChromeLike/ChromeTab 扩展 + archiveByMode）
- Test: `src/shared/tabs/__tests__/workspaceSwitch.test.ts`

**Interfaces:**
- Produces:
  - `ChromeLike` 加 `tabGroups: { get, query, update }` + `tabs: { ..., group, ungroup, discard, update }`
  - `ChromeTab` 加 `groupId?: number`
  - `archiveByMode(c, windowId, fromId, mode, onProgress): Promise<{ tabs: {id:number;entry:TabEntry}[] } | null>`（null=硬屏障）
  - `TabIsolationMode`（内部）= 'close' | 'hide-discard' | 'hide'
- Consumes: `findGroupByIdentity`（T2）、`TabEntry`、`saveTabSession`（v1）

**背景**：v1 `archive` 是全窗 query。hide 模式窗口有多 ws 组共存，archive 只取当前 ws 组 tab + 散 tab（含 pinned，散 tab 视为当前 ws），不取别 ws 组（污染）。

- [ ] **Step 1: 写失败测试**

追加到 `src/shared/tabs/__tests__/workspaceSwitch.test.ts`：

```typescript
import { archiveByMode } from '../workspaceSwitch';

describe('archiveByMode', () => {
  beforeEach(() => {
    const c = (globalThis as any).chrome;
    c.__testTabs.clear();
    c.__testGroups.clear();
    // 当前 ws（ws-a）的组（gid=10）含 2 tab；别 ws（ws-b）折叠组（gid=11）含 1 tab；散 tab 1 个
    c.__testGroups.set(10, { id: 10, windowId: 1, title: '工作 ·aaaa1111', color: 'grey', collapsed: false });
    c.__testGroups.set(11, { id: 11, windowId: 1, title: '学习 ·bbbb2222', color: 'grey', collapsed: true });
    const tabs = c.__testTabs as Map<number, any>;
    tabs.set(1, { id: 1, windowId: 1, url: 'https://a1.com', groupId: 10 });
    tabs.set(2, { id: 2, windowId: 1, url: 'https://a2.com', groupId: 10 });
    tabs.set(3, { id: 3, windowId: 1, url: 'https://b1.com', groupId: 11 }); // 别 ws，不应归档
    tabs.set(4, { id: 4, windowId: 1, url: 'https://loose.com', groupId: -1 }); // 散 tab，视为当前 ws
  });

  it('hide：只归档当前 ws 组 + 散 tab（不污染别 ws 组）', async () => {
    const c = (globalThis as any).chrome;
    const result = await archiveByMode(c, 1, 'aaaa1111-0000-0000', 'hide');
    expect(result).not.toBeNull();
    const urls = result!.tabs.map((t: any) => t.entry.url).sort();
    expect(urls).toEqual(['https://a1.com', 'https://a2.com', 'https://loose.com']);
    // 别 ws tab 不在
    expect(urls).not.toContain('https://b1.com');
  });

  it('hide：找不到当前 ws 组时，散 tab 仍归档（兜底前保全）', async () => {
    const c = (globalThis as any).chrome;
    const result = await archiveByMode(c, 1, 'zzzz9999-0000-0000', 'hide'); // 无此 ws 组
    expect(result!.tabs.map((t: any) => t.entry.url)).toEqual(['https://loose.com']);
  });

  it('close：归档全窗 restorable tab（v1 行为不变）', async () => {
    const c = (globalThis as any).chrome;
    const result = await archiveByMode(c, 1, 'aaaa1111-0000-0000', 'close');
    expect(result!.tabs.map((t: any) => t.entry.url).sort()).toEqual([
      'https://a1.com', 'https://a2.com', 'https://b1.com', 'https://loose.com',
    ]);
  });

  it('query 抛错 → null（硬屏障）', async () => {
    const c = (globalThis as any).chrome;
    const orig = c.tabs.query;
    c.tabs.query = async () => { throw new Error('boom'); };
    const result = await archiveByMode(c, 1, 'aaaa1111-0000-0000', 'hide');
    expect(result).toBeNull();
    c.tabs.query = orig;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/workspaceSwitch.test.ts`
Expected: FAIL（archiveByMode 未导出）。

- [ ] **Step 3: 扩展 ChromeLike/ChromeTab + 实现 archiveByMode**

在 `workspaceSwitch.ts` 顶部 import 加 `findGroupByIdentity`，扩展接口，新增 `archiveByMode`（保留 v1 `archive` 供 v1 close 内部用，或重构 archive 调 archiveByMode）：

```typescript
import { findGroupByIdentity } from '@/shared/tabs/tabGroupIdentity';

// 扩展 ChromeLike（在既有 tabs 基础上加 group/ungroup/discard/update + tabGroups）
interface ChromeTab {
  id?: number;
  windowId: number;
  url?: string;
  pinned?: boolean;
  index?: number;
  groupId?: number; // -1 或缺省=无组（需 tabGroups 权限填充）
}

interface ChromeLike {
  tabs: {
    query(info: { windowId?: number }): Promise<ChromeTab[]>;
    create(props: { url: string; pinned?: boolean; windowId?: number; index?: number; active?: boolean }): Promise<unknown>;
    remove(id: number): Promise<unknown>;
    update(id: number, props: { active?: boolean }): Promise<unknown>;
    discard(id: number): Promise<unknown>;
    group(opts: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }): Promise<number>;
    ungroup(tabIds: number[]): Promise<unknown>;
  };
  tabGroups: {
    get(gid: number): Promise<{ id: number; windowId: number; title?: string }>;
    query(info: { windowId?: number }): Promise<{ id: number; windowId: number; title?: string }[]>;
    update(gid: number, props: { collapsed?: boolean; title?: string; color?: string }): Promise<unknown>;
  };
}

/** 隔离模式（内部，setting 的归档三档）。 */
export type TabIsolationMode = 'close' | 'hide-discard' | 'hide';

/**
 * 按 mode 归档窗口内当前 ws 的 tab（archiveByMode）。
 * - close：全窗 restorable tab（v1 行为）。
 * - hide：当前 ws 标识组的 tab + 散 tab（groupId=-1，含 pinned，视为当前 ws），不取别 ws 组。
 * 任何异常返回 null（硬屏障信号，调用方不 dispose）。返回 {tabs: {id, entry}[]} 供 dispose/restore。
 */
export async function archiveByMode(
  c: ChromeLike,
  windowId: number,
  fromId: string,
  mode: TabIsolationMode,
  onProgress?: (p: SwitchProgress) => void,
): Promise<{ tabs: { id: number; entry: TabEntry }[] } | null> {
  try {
    const tabs = await c.tabs.query({ windowId });
    const restorable = tabs.filter(isRestorable);
    let mine: ChromeTab[];
    if (mode === 'close') {
      mine = restorable;
    } else {
      const gid = await findGroupByIdentity(windowId, fromId);
      mine = restorable.filter((t) => t.groupId === gid || t.groupId === -1 || t.groupId == null);
    }
    const entries = mine.map((t) => ({ id: t.id!, entry: toEntry(t) }));
    await saveTabSession(fromId, entries.map((e) => e.entry));
    onProgress?.({ phase: 'archive', count: entries.length, total: entries.length });
    return { tabs: entries };
  } catch {
    return null; // 硬屏障
  }
}
```

> 注：v1 既有 `archive(windowId, fromId, onProgress)` 改为内部委托 `archiveByMode(c, windowId, fromId, 'close', onProgress)` 后返回 `{id}[]`（保持 v1 调用点签名）——见 Step 3b。

- [ ] **Step 3b: 重构 v1 archive 委托 archiveByMode**

把 v1 `archive` 函数体改为：
```typescript
async function archive(windowId, fromId, onProgress) {
  const c = getChrome();
  if (!c) return null;
  const r = await archiveByMode(c, windowId, fromId, 'close', onProgress);
  return r ? r.tabs.map((t) => ({ id: t.id })) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/workspaceSwitch.test.ts`
Expected: PASS（含 archiveByMode 新测 + v1 archive 回归）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/tabs/workspaceSwitch.ts src/shared/tabs/__tests__/workspaceSwitch.test.ts
git commit -m "feat(ws-tab-iso): T3 archiveByMode（close 全窗 / hide 按 groupId 过滤 + 散 tab）"
```

---

## Task 4: disposeByMode + restoreByMode

**Files:**
- Modify: `src/shared/tabs/workspaceSwitch.ts`
- Test: `src/shared/tabs/__tests__/workspaceSwitch.test.ts`

**Interfaces:**
- Produces:
  - `disposeByMode(c, windowId, fromId, mode, toDispose, onProgress): Promise<{ ok: boolean }>`（false=关键失败，调用方不更新 binding）
  - `restoreByMode(c, windowId, toId, toName, mode, onProgress): Promise<{ opened: number[]; failed: TabEntry[] }>`
- Consumes: `findGroupByIdentity`、`makeGroupTitle`（T2）、`getTabSession`/`openTabsInWindow`（v1）

**关键逻辑**：
- dispose hide：先激活 home（避 active 阻塞 discard）→ pinned tab（除 home）remove（C4b）→ 散 tab tabs.group 入当前 ws 组 → collapse（[discard 档逐 tab discard，失败降级]）。collapse/group 任一失败 → ok=false。
- restore hide：findGroupByIdentity(toId) 命中 → expand（collapsed:false）；未命中 → openTabsInWindow（TabSession.toId）+ tabs.group 建组 + update(title=makeGroupTitle, collapsed:false)。返回 {opened, failed}。

- [ ] **Step 1: 写失败测试**

```typescript
import { disposeByMode, restoreByMode } from '../workspaceSwitch';

describe('disposeByMode hide', () => {
  beforeEach(() => {
    const c = (globalThis as any).chrome;
    c.__testTabs.clear(); c.__testGroups.clear();
    c.__testGroups.set(10, { id: 10, windowId: 1, title: '工作 ·aaaa1111', color: 'grey', collapsed: false });
    const tabs = c.__testTabs as Map<number, any>;
    tabs.set(1, { id: 1, windowId: 1, url: 'https://a1.com', groupId: 10 });
    tabs.set(2, { id: 2, windowId: 1, url: 'https://home.html', groupId: -1 }); // home（isInternalPage，已被 archive 排除）
    tabs.set(3, { id: 3, windowId: 1, url: 'https://loose.com', groupId: -1 }); // 散 tab
    tabs.set(4, { id: 4, windowId: 1, url: 'https://pinned.com', groupId: -1, pinned: true }); // pinned 非 home
  });

  it('hide：散 tab 入组 + 折叠 + pinned remove', async () => {
    const c = (globalThis as any).chrome;
    const toDispose = [
      { id: 1, entry: { url: 'https://a1.com', pinned: false, order: 0 } },
      { id: 3, entry: { url: 'https://loose.com', pinned: false, order: 1 } },
      { id: 4, entry: { url: 'https://pinned.com', pinned: true, order: 2 } },
    ];
    const r = await disposeByMode(c, 1, 'aaaa1111-0000-0000', 'hide', toDispose as any);
    expect(r.ok).toBe(true);
    // 组折叠
    expect(c.__testGroups.get(10).collapsed).toBe(true);
    // pinned tab 被 remove（不在 tabsStore）
    expect(c.__testTabs.has(4)).toBe(false);
    // 散 tab 纳入组 10
    expect(c.__testTabs.get(3).groupId).toBe(10);
  });

  it('hide-discard：折叠 + discard 非 active tab', async () => {
    const c = (globalThis as any).chrome;
    const toDispose = [{ id: 1, entry: { url: 'https://a1.com', pinned: false, order: 0 } }];
    const r = await disposeByMode(c, 1, 'aaaa1111-0000-0000', 'hide-discard', toDispose as any);
    expect(r.ok).toBe(true);
    expect(c.__testGroups.get(10).collapsed).toBe(true);
  });

  it('collapse 失败 → ok=false（调用方不更新 binding）', async () => {
    const c = (globalThis as any).chrome;
    const orig = c.tabGroups.update;
    c.tabGroups.update = async () => { throw new Error('boom'); };
    const r = await disposeByMode(c, 1, 'aaaa1111-0000-0000', 'hide', []);
    expect(r.ok).toBe(false);
    c.tabGroups.update = orig;
  });
});

describe('restoreByMode hide', () => {
  it('命中标识组 → expand（不重开）', async () => {
    const c = (globalThis as any).chrome;
    c.__testGroups.set(20, { id: 20, windowId: 1, title: '目标 ·cccc3333', color: 'grey', collapsed: true });
    const r = await restoreByMode(c, 1, 'cccc3333-0000-0000', '目标', 'hide');
    expect(r.opened).toEqual([]);
    expect(c.__testGroups.get(20).collapsed).toBe(false);
  });

  it('未命中 → 兜底 restore 重开 + 建组（title=标识）', async () => {
    const c = (globalThis as any).chrome;
    c.__testTabs.clear(); c.__testGroups.clear();
    // TabSession.<toId> 存在（通过 saveTabSession 预存，或测试注入）
    const { saveTabSession } = await import('@/services/TabSessionService');
    await saveTabSession('cccc3333-0000-0000', [{ url: 'https://x.com', pinned: false, order: 0 }]);
    const r = await restoreByMode(c, 1, 'cccc3333-0000-0000', '目标', 'hide');
    expect(r.opened.length).toBe(1);
    // 新组 title = 标识
    const groups = await c.tabGroups.query({ windowId: 1 });
    expect(groups.some((g: any) => g.title === '目标 ·cccc3333')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/workspaceSwitch.test.ts`
Expected: FAIL（disposeByMode/restoreByMode 未导出）。

- [ ] **Step 3: 实现 disposeByMode + restoreByMode**

```typescript
import { findGroupByIdentity, makeGroupTitle } from '@/shared/tabs/tabGroupIdentity';

/**
 * 按 mode 处置（dispose）。返回 {ok}：false=关键失败（collapse/group 抛错），调用方不更新 binding。
 * - close：remove（v1）。
 * - hide/hide-discard：激活 home → pinned（除 home）remove → 散 tab group 入当前 ws 组 →
 *   collapse 组（hide-discard 额外逐 tab discard，单 tab 失败 try/catch 跳过，部分失败不阻断）。
 * archive 已排除 home/isInternalPage；toDispose 的 id 是 restorable tab。
 */
export async function disposeByMode(
  c: ChromeLike,
  windowId: number,
  fromId: string,
  mode: TabIsolationMode,
  toDispose: { id: number; entry: TabEntry }[],
  onProgress?: (p: SwitchProgress) => void,
): Promise<{ ok: boolean }> {
  if (mode === 'close') {
    await disposeTabs(c, toDispose.map((t) => t.id), onProgress); // v1：部分失败不阻断
    return { ok: true };
  }
  // hide / hide-discard
  try {
    // pinned tab（除 home）无法入组（Chrome 限制 C4b）→ remove
    const pinned = toDispose.filter((t) => t.entry.pinned).map((t) => t.id);
    const nonPinned = toDispose.filter((t) => !t.entry.pinned);
    for (const id of pinned) {
      try { await c.tabs.remove(id); } catch { /* 部分失败不阻断 */ }
    }
    // 散 tab（groupId=-1）纳入当前 ws 组
    let gid = await findGroupByIdentity(windowId, fromId);
    const looseIds: number[] = [];
    for (const t of nonPinned) {
      // 需读 tab.groupId 判断散；简化：archive 阶段已知散 tab，这里重查
    }
    // 重查窗口 tab 拿散 tab id（archive 返回的 entry 不含 groupId）
    const allTabs = await c.tabs.query({ windowId });
    const looseTabIds = allTabs
      .filter((t) => t.id != null && (t.groupId === -1 || t.groupId == null) && isRestorable(t))
      .map((t) => t.id!);
    if (gid == null && looseTabIds.length) {
      // 无当前 ws 组但有散 tab → 建组
      gid = await c.tabs.group({ tabIds: looseTabIds, createProperties: { windowId } });
      await c.tabGroups.update(gid, { title: makeGroupTitle('', fromId), color: 'grey' });
    } else if (gid != null && looseTabIds.length) {
      await c.tabs.group({ tabIds: looseTabIds, groupId: gid });
    }
    if (gid != null) {
      await c.tabGroups.update(gid, { collapsed: true });
      if (mode === 'hide-discard') {
        const groupTabs = (await c.tabs.query({ windowId })).filter((t) => t.groupId === gid && t.id != null);
        for (const t of groupTabs) {
          try { await c.tabs.discard(t.id!); } catch { /* active/受限 tab 跳过，部分失败降级 */ }
        }
      }
    }
    onProgress?.({ phase: 'dispose', count: toDispose.length, total: toDispose.length });
    return { ok: true };
  } catch {
    return { ok: false }; // collapse/group 关键失败 → 调用方不更新 binding
  }
}

/**
 * 按 mode 恢复目标 ws。返回 {opened, failed}。
 * - close：openTabsInWindow（v1）。
 * - hide/hide-discard：标识回找命中 → expand；未命中 → 兜底 restore 重开 + 建组 + update(标识, collapsed:false)。
 * binding 只在调用方确认 opened/failed 可接受后写（见 performSwitch）。
 */
export async function restoreByMode(
  c: ChromeLike,
  windowId: number,
  toId: string,
  toName: string,
  mode: TabIsolationMode,
  onProgress?: (p: SwitchProgress) => void,
): Promise<{ opened: number[]; failed: TabEntry[] }> {
  if (mode === 'close') {
    const session = await getTabSession(toId);
    const opened = session ? await openTabsInWindow(c, windowId, session.tabs, onProgress) : [];
    return { opened, failed: [] };
  }
  // hide / hide-discard
  const gid = await findGroupByIdentity(windowId, toId);
  if (gid != null) {
    await c.tabGroups.update(gid, { collapsed: false }); // expand
    onProgress?.({ phase: 'restore', count: 0, total: 0 });
    return { opened: [], failed: [] };
  }
  // 兜底 restore：重开 + 建组
  const session = await getTabSession(toId);
  if (!session || !session.tabs.length) return { opened: [], failed: [] };
  const opened: number[] = [];
  const failed: TabEntry[] = [];
  for (const t of session.tabs) {
    try {
      const created = (await c.tabs.create({ url: t.url, pinned: t.pinned, windowId, index: t.order, active: false })) as { id?: number } | undefined;
      if (created?.id != null) opened.push(created.id);
      else failed.push(t);
    } catch { failed.push(t); }
  }
  if (opened.length) {
    const newGid = await c.tabs.group({ tabIds: opened, createProperties: { windowId } });
    await c.tabGroups.update(newGid, { title: makeGroupTitle(toName, toId), color: 'grey', collapsed: false });
  }
  onProgress?.({ phase: 'restore', count: opened.length, total: session.tabs.length });
  return { opened, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/workspaceSwitch.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/shared/tabs/workspaceSwitch.ts src/shared/tabs/__tests__/workspaceSwitch.test.ts
git commit -m "feat(ws-tab-iso): T4 disposeByMode + restoreByMode（collapse/discard/散 tab 收纳/兜底 restore）"
```

---

## Task 5: performSwitch mode 集成 + 失败状态机

**Files:**
- Modify: `src/shared/tabs/workspaceSwitch.ts`（performSwitch 加 mode + 失败不更新 binding）
- Test: `src/shared/tabs/__tests__/workspaceSwitch.test.ts`

**Interfaces:**
- Produces: `performSwitch(toId, windowId, mode, options)` —— archive 硬屏障 + dispose ok 校验 + restore {opened,failed}，binding 只在 dispose.ok 且 restore 可接受后写。
- Consumes: archiveByMode/disposeByMode/restoreByMode（T3/T4）、setWorkspaceBinding（v1）

**关键**：dispose ok=false 或 archive null → 不更新 binding、Toast 报错、返回 fromId=null（不视为成功切换）。restore failed 非空 → 仍更新 binding（部分成功）但 closedCount 反映、进 repair（Toast 提示）。

- [ ] **Step 1: 写失败测试**

```typescript
describe('performSwitch hide 失败状态机', () => {
  it('dispose 失败 → 不更新 binding（停留源 ws）', async () => {
    const c = (globalThis as any).chrome;
    c.__testTabs.clear(); c.__testGroups.clear();
    c.__testGroups.set(10, { id: 10, windowId: 1, title: 'A ·aaaa1111', color: 'grey', collapsed: false });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: 10 });
    // 预存 binding=ws-a
    const { setWorkspaceBinding, getWorkspaceBinding } = await import('@/shared/windowWorkspaceBinding');
    await setWorkspaceBinding(1, 'ws-a');
    // dispose 制造 collapse 失败
    const orig = c.tabGroups.update;
    c.tabGroups.update = async () => { throw new Error('boom'); };
    const { performSwitch } = await import('../workspaceSwitch');
    const r = await performSwitch('ws-b', 1, 'hide');
    expect(r.fromId).toBeNull(); // 未成功切换
    expect(await getWorkspaceBinding(1)).toBe('ws-a'); // binding 未动
    c.tabGroups.update = orig;
  });

  it('archive 失败 → 硬屏障，不折叠不更新 binding', async () => {
    const c = (globalThis as any).chrome;
    const orig = c.tabs.query;
    c.tabs.query = async () => { throw new Error('boom'); };
    const { setWorkspaceBinding, getWorkspaceBinding } = await import('@/shared/windowWorkspaceBinding');
    await setWorkspaceBinding(1, 'ws-a');
    const { performSwitch } = await import('../workspaceSwitch');
    const r = await performSwitch('ws-b', 1, 'hide');
    expect(r.fromId).toBeNull();
    expect(await getWorkspaceBinding(1)).toBe('ws-a');
    c.tabs.query = orig;
  });

  it('close 模式回归：v1 行为不变（archive→remove→restore→binding）', async () => {
    const c = (globalThis as any).chrome;
    c.__testTabs.clear(); c.__testGroups.clear();
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: -1 });
    const { setWorkspaceBinding, getWorkspaceBinding } = await import('@/shared/windowWorkspaceBinding');
    await setWorkspaceBinding(1, 'ws-a');
    const { saveTabSession } = await import('@/services/TabSessionService');
    await saveTabSession('ws-b', [{ url: 'https://b.com', pinned: false, order: 0 }]);
    const { performSwitch } = await import('../workspaceSwitch');
    const r = await performSwitch('ws-b', 1, 'close');
    expect(r.fromId).toBe('ws-a');
    expect(await getWorkspaceBinding(1)).toBe('ws-b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/workspaceSwitch.test.ts`
Expected: FAIL（performSwitch 不接 mode 参数）。

- [ ] **Step 3: 重构 performSwitch 加 mode + 失败状态机**

把 v1 `performSwitch(toId, windowId, options)` 改为 `performSwitch(toId, windowId, mode, options)`，archive/dispose/restore 委托 ByMode：

```typescript
async function performSwitch(
  toId: string,
  windowId: number,
  mode: TabIsolationMode,
  options?: SwitchOptions,
): Promise<SwitchResult> {
  const onProgress = options?.onProgress;
  const c = getChrome();
  if (!c) return { undo: noopUndo, fromId: null, closedCount: 0 };
  const fromId = await getWorkspaceBinding(windowId);
  if (!fromId || fromId === toId) return { undo: noopUndo, fromId: null, closedCount: 0 };

  // 1. archive（硬屏障）
  const archived = await archiveByMode(c, windowId, fromId, mode, onProgress);
  if (archived === null) {
    Toast.error('切换中止：无法保存当前标签');
    return { undo: noopUndo, fromId: null, closedCount: 0 };
  }

  // 2. dispose（hide：失败 → 不更新 binding）
  const disposed = await disposeByMode(c, windowId, fromId, mode, archived.tabs, onProgress);
  if (!disposed.ok) {
    Toast.error('切换中止：无法收起当前标签，已保留');
    return { undo: noopUndo, fromId: null, closedCount: 0 };
  }

  // 3. restore 目标 ws（close：openTabsInWindow；hide：expand/兜底）
  const toName = await getWorkspaceName(toId); // 见 Step 3b
  const { opened, failed } = await restoreByMode(c, windowId, toId, toName, mode, onProgress);

  // 4. 更新绑定（dispose.ok 后；restore failed 非空仍更新 = 部分成功）
  await setWorkspaceBinding(windowId, toId);
  onProgress?.({ phase: 'done', count: 0, total: 0 });

  if (failed.length) {
    Toast.error(`切换未完成：还有 ${failed.length} 个标签未恢复`);
  }

  return {
    undo: buildUndo(c, windowId, fromId, toId, mode, opened, onProgress),
    fromId,
    closedCount: archived.tabs.length,
  };
}
```

- [ ] **Step 3b: getWorkspaceName helper（performSwitch 传给 restoreByMode 建 group title）**

performSwitch 需要目标 ws 名（建组 title）。但 workspaceSwitch.ts 不依赖 store（v1 设计）。解法：`requestWorkspaceSwitch`/`performSwitch` 加 `toName` 参数，由上层（switchWorkspaceBySetting，能访问 store）传入。

修改签名：`performSwitch(toId, toName, windowId, mode, options)` + `requestWorkspaceSwitch(toId, toName, windowId, mode, options)`。`restoreByMode` 已接 toName。`getWorkspaceName` 删除，toName 由参数传入。

```typescript
async function performSwitch(
  toId: string, toName: string, windowId: number, mode: TabIsolationMode, options?: SwitchOptions,
): Promise<SwitchResult> {
  // ... restoreByMode(c, windowId, toId, toName, mode, onProgress)
}

export async function requestWorkspaceSwitch(
  toId: string, toName: string, windowId: number, mode: TabIsolationMode, options?: SwitchOptions,
): Promise<SwitchResult> {
  const run = () => performSwitch(toId, toName, windowId, mode, options);
  // ... 串行队列不变
}
```

`buildUndo` 占位见 Task 6（先返回 noopUndo，T6 实现）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/workspaceSwitch.test.ts`
Expected: PASS（更新测试用新签名 `performSwitch('ws-b', 'B', 1, 'hide')`）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/tabs/workspaceSwitch.ts src/shared/tabs/__tests__/workspaceSwitch.test.ts
git commit -m "feat(ws-tab-iso): T5 performSwitch mode 集成 + 失败不更新 binding"
```

---

## Task 6: undo generation 入队

**Files:**
- Modify: `src/shared/tabs/workspaceSwitch.ts`（buildUndo + generation token + undo 走串行队列）
- Test: `src/shared/tabs/__tests__/workspaceSwitch.test.ts`

**Interfaces:**
- Produces: `buildUndo(...)` 返回带 generation 校验的 undo；undo 走 `requestWorkspaceSwitch` 同一 per-window 队列。

**关键**：undo 前校验源/目标组结构未变（groupId 仍存、成员一致）→ 变化则拒绝 undo（Toast「工作区已变化，可手动切回」）。

- [ ] **Step 1: 写失败测试**

```typescript
describe('undo generation', () => {
  it('undo 走串行队列，组结构变化拒绝', async () => {
    // 切换 ws-a→ws-b（hide），拿 undo；手动改组结构后 undo 应拒绝
    const c = (globalThis as any).chrome;
    c.__testTabs.clear(); c.__testGroups.clear();
    c.__testGroups.set(10, { id: 10, windowId: 1, title: 'A ·aaaa1111', color: 'grey', collapsed: false });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: 10 });
    const { setWorkspaceBinding } = await import('@/shared/windowWorkspaceBinding');
    const { saveTabSession } = await import('@/services/TabSessionService');
    await setWorkspaceBinding(1, 'ws-a');
    await saveTabSession('ws-b', [{ url: 'https://b.com', pinned: false, order: 0 }]);
    const { requestWorkspaceSwitch } = await import('../workspaceSwitch');
    const r = await requestWorkspaceSwitch('ws-b', 'B', 1, 'hide');
    expect(r.fromId).toBe('ws-a');
    // 组结构变化：删组 10
    c.__testGroups.delete(10);
    await r.undo();
    // undo 拒绝 → binding 仍 ws-b（未回滚）
    const { getWorkspaceBinding } = await import('@/shared/windowWorkspaceBinding');
    expect(await getWorkspaceBinding(1)).toBe('ws-b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/workspaceSwitch.test.ts`
Expected: FAIL（buildUndo 未实现 / undo 不校验）。

- [ ] **Step 3: 实现 buildUndo + generation**

```typescript
/** 快照切换时的源/目标组结构，undo 前校验未变。 */
interface UndoSnapshot {
  fromId: string;
  toId: string;
  mode: TabIsolationMode;
  targetGroupId: number | null; // restore 建的/展开的目标组
  openedIds: number[];
}

function buildUndo(
  c: ChromeLike,
  windowId: number,
  snapshot: UndoSnapshot,
  onProgress?: (p: SwitchProgress) => void,
): () => Promise<void> {
  return async () => {
    // generation 校验：目标组结构未变
    const gid = await findGroupByIdentity(windowId, snapshot.toId);
    if (gid !== snapshot.targetGroupId) {
      Toast.error('工作区已变化，无法撤销，可手动切回');
      return;
    }
    // 反转：折叠目标组 + 展开源组（源组兜底 restore）+ 回滚 binding
    if (gid != null) {
      try { await c.tabGroups.update(gid, { collapsed: true }); } catch { /* 忽略 */ }
    }
    // dispose 本次 restore 的 opened tab（close 模式）/ 折叠（hide 由上面 collapse 覆盖）
    if (snapshot.mode === 'close' && snapshot.openedIds.length) {
      await disposeTabs(c, snapshot.openedIds);
    }
    // 源组：标识回找 → expand；找不到兜底 restore
    const { opened } = await restoreByMode(c, windowId, snapshot.fromId, '', snapshot.mode, onProgress);
    void opened;
    await setWorkspaceBinding(windowId, snapshot.fromId);
  };
}
```

performSwitch 内 `buildUndo(c, windowId, {fromId, toId, mode, targetGroupId, openedIds: opened}, onProgress)`。targetGroupId = restoreByMode 命中/新建的 gid（restoreByMode 返回值加 `groupId`）。

修改 `restoreByMode` 返回 `{ opened, failed, groupId }`（命中=该 gid，兜底=新建 gid，无=None）。

- [ ] **Step 4: undo 走串行队列**

undo 不直接调 buildUndo 逻辑，而是经 `requestWorkspaceSwitch` 同一 inflight 队列。最简：`SwitchResult.undo` 内部用同一 `inflight` Map 排队（参考 v1 requestWorkspaceSwitch 队列模式）。实现：把 undo 包一层排队：

```typescript
// performSwitch 末尾：
const snapshot: UndoSnapshot = { fromId, toId, mode, targetGroupId: restored.groupId, openedIds: opened };
const undoFn = buildUndo(c, windowId, snapshot, onProgress);
const queuedUndo = async () => {
  const prev = inflight.get(windowId) ?? Promise.resolve();
  const task = prev.then(undoFn, undoFn);
  inflight.set(windowId, task.then(noopUndo, noopUndo));
  try { await task; } finally { if (inflight.get(windowId) === task.then(noopUndo, noopUndo)) inflight.delete(windowId); }
};
return { undo: queuedUndo, fromId, closedCount: archived.tabs.length };
```

- [ ] **Step 5: Run test to verify it passes + Run typecheck**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/workspaceSwitch.test.ts && pnpm run typecheck`
Expected: PASS + typecheck 绿。

- [ ] **Step 6: Commit**

```bash
git add src/shared/tabs/workspaceSwitch.ts src/shared/tabs/__tests__/workspaceSwitch.test.ts
git commit -m "feat(ws-tab-iso): T6 undo generation 校验 + 入 per-window 串行队列"
```

---

## Task 7: 跨档 normalize（hide→close）

**Files:**
- Modify: `src/shared/tabs/workspaceSwitch.ts`（新增 `normalizeOnModeChange`）
- Modify: `src/entrypoints/home/utils/workspaceSwitcher.tsx`（setting 变更时调 normalize）
- Test: `src/shared/tabs/__tests__/workspaceSwitch.test.ts`

**Interfaces:**
- Produces: `normalizeOnModeChange(windowId, newMode): Promise<void>` —— hide→close 时，dispose 窗口内非当前 ws 标识组（其 tab 已在各自 session），窗口回归 close 干净语义。
- Consumes: `getWorkspaceBinding`、`findGroupByIdentity`（T2）

- [ ] **Step 1: 写失败测试**

```typescript
describe('normalizeOnModeChange hide→close', () => {
  it('清非当前 ws 标识组，保留当前 ws', async () => {
    const c = (globalThis as any).chrome;
    c.__testTabs.clear(); c.__testGroups.clear();
    const { setWorkspaceBinding } = await import('@/shared/windowWorkspaceBinding');
    await setWorkspaceBinding(1, 'ws-a');
    // 当前 ws-a 组（gid 10）+ 别 ws-b 折叠组（gid 11）
    c.__testGroups.set(10, { id: 10, windowId: 1, title: 'A ·aaaa1111', color: 'grey', collapsed: false });
    c.__testGroups.set(11, { id: 11, windowId: 1, title: 'B ·bbbb2222', color: 'grey', collapsed: true });
    c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://a.com', groupId: 10 });
    c.__testTabs.set(2, { id: 2, windowId: 1, url: 'https://b.com', groupId: 11 });
    const { normalizeOnModeChange } = await import('../workspaceSwitch');
    await normalizeOnModeChange(1, 'close');
    // 别 ws 组的 tab 被 remove（窗口回归只有当前 ws）
    expect(c.__testTabs.has(2)).toBe(false);
    expect(c.__testTabs.has(1)).toBe(true);
    expect(c.__testGroups.has(11)).toBe(false); // 空组清理
  });

  it('close→hide / off 不 normalize', async () => {
    const { normalizeOnModeChange } = await import('../workspaceSwitch');
    await expect(normalizeOnModeChange(1, 'hide')).resolves.toBeUndefined(); // no-op
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/workspaceSwitch.test.ts`
Expected: FAIL（normalizeOnModeChange 未导出）。

- [ ] **Step 3: 实现 normalizeOnModeChange**

```typescript
/**
 * 跨档 normalize：hide→close 时，清窗口内非当前 ws 标识组（tab 已在各自 session），
 * 窗口回归 close「只剩当前 ws tab」干净语义，避免 close 全窗 archive 污染。
 * 其他切档（close→hide / off↔任意）no-op。
 */
export async function normalizeOnModeChange(windowId: number, newMode: TabIsolationMode | 'off'): Promise<void> {
  if (newMode !== 'close') return;
  const c = getChrome();
  if (!c) return;
  const currentWs = await getWorkspaceBinding(windowId);
  const groups = await c.tabGroups.query({ windowId });
  for (const g of groups) {
    // Octane 管的组（title 含 ` ·xxxxxxxx`）且非当前 ws → 清
    const m = g.title?.match(/ ·([0-9a-f]{8})$/);
    if (!m) continue; // 用户手动组，不碰
    const hash = m[1];
    const isCurrent = currentWs && wsHash(currentWs) === hash;
    if (isCurrent) continue;
    // remove 该组所有 tab
    const groupTabs = (await c.tabs.query({ windowId })).filter((t) => t.groupId === g.id && t.id != null);
    for (const t of groupTabs) {
      try { await c.tabs.remove(t.id!); } catch { /* 部分失败 */ }
    }
  }
}
```

（需 import `wsHash` from tabGroupIdentity）

- [ ] **Step 4: workspaceSwitcher 在 setting 变更时调 normalize**

`workspaceSwitcher.tsx` 的 `useTabIsolationSetting` hook 的 `updateSetting` 内，写 setting 后调 normalize（若新档是 close）：

```typescript
const updateSetting = useCallback(async (value: TabIsolationSetting) => {
  await setTabIsolationSetting(value);
  setSetting(value);
  // T7: hide→close normalize（清非当前 ws 组）
  if (value === 'close') {
    const wid = await getCurrentWindowId();
    if (wid != null) {
      const { normalizeOnModeChange } = await import('@/shared/tabs/workspaceSwitch');
      void normalizeOnModeChange(wid, 'close').catch(() => {});
    }
  }
}, []);
```

- [ ] **Step 5: Run test to verify it passes + typecheck**

Run: `pnpm run test -- --run src/shared/tabs/__tests__/workspaceSwitch.test.ts && pnpm run typecheck`
Expected: PASS + 绿。

- [ ] **Step 6: Commit**

```bash
git add src/shared/tabs/workspaceSwitch.ts src/entrypoints/home/utils/workspaceSwitcher.tsx src/shared/tabs/__tests__/workspaceSwitch.test.ts
git commit -m "feat(ws-tab-iso): T7 跨档 normalize（hide→close 清非当前 ws 组）"
```

---

## Task 8: switchWorkspaceBySetting 门控 hide + UI 4 档 + 首启 AlertDialog 扩展

**Files:**
- Modify: `src/shared/tabs/workspaceSwitch.ts`（switchWorkspaceBySetting 加 hide 分支）
- Modify: `src/entrypoints/home/components/SettingsModal/sections/WorkspaceTabsSection.tsx`（RadioGroup 4 档）
- Test: `src/entrypoints/home/utils/__tests__/workspaceSwitcher.test.tsx`、`src/entrypoints/home/components/SettingsModal/sections/__tests__/WorkspaceTabsSection.test.tsx`

**Interfaces:**
- Produces: `switchWorkspaceBySetting` 接 setting（4 档），close/hide-discard/hide 走 `requestWorkspaceSwitch`（带 mode + toName）；off 走纯 selectWorkspace。
- Consumes: `requestWorkspaceSwitch`（T5 新签名 toId/toName/windowId/mode）、`useWorkspace`（取 toName）

- [ ] **Step 1: 写失败测试（switchWorkspaceBySetting hide 分流）**

追加到 `workspaceSwitcher.test.tsx`：

```typescript
it('hide 档走 requestWorkspaceSwitch（mode=hide-discard/hide）', async () => {
  // mock requestWorkspaceSwitch 捕获 mode 参数
  // 验证 setting='hide' → mode='hide'；setting='hide-discard' → mode='hide-discard'
});
```

（具体 mock 范式参考该文件既有 close 档测试。）

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run src/entrypoints/home/utils/__tests__/workspaceSwitcher.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 修改 switchWorkspaceBySetting**

```typescript
export async function switchWorkspaceBySetting(params: {
  toId: string;
  toName: string; // 新增：建组 title 用
  setting: TabIsolationSetting;
  windowId: number | null;
  selectWorkspace: (id: string) => Promise<void>;
  onProgress?: (p: SwitchProgress) => void;
}): Promise<SwitchResult> {
  const { toId, toName, setting, windowId, selectWorkspace, onProgress } = params;
  const mode = setting === 'close' ? 'close' : setting === 'hide-discard' ? 'hide-discard' : setting === 'hide' ? 'hide' : null;
  if (mode && windowId != null) {
    const result = await requestWorkspaceSwitch(toId, toName, windowId, mode, onProgress ? { onProgress } : undefined);
    await selectWorkspace(toId);
    return result;
  }
  await selectWorkspace(toId);
  return { undo: noopUndo, fromId: null, closedCount: 0 };
}
```

`workspaceSwitcher.tsx` 的 `switchWorkspace` 调用处加 `toName`（从 store 取 `workspaces.find(w=>w.id===toId)?.name ?? toId`）。

- [ ] **Step 4: WorkspaceTabsSection RadioGroup 4 档**

在既有 RadioGroup 加两档 label + 描述（aria-describedby 绑定）：

```tsx
<label className="flex min-h-11 items-start gap-3">
  <RadioGroupItem value="hide-discard" aria-describedby="iso-hide-d-desc" className="mt-1" />
  <span className="flex flex-col gap-0.5">
    <span className="text-sm font-medium">折叠·省内存</span>
    <span id="iso-hide-d-desc" className="text-sm text-muted-foreground">
      离开时折叠为标签组并释放内存，返回时展开重新加载（页面状态不保留）。
    </span>
  </span>
</label>
<label className="flex min-h-11 items-start gap-3">
  <RadioGroupItem value="hide" aria-describedby="iso-hide-desc" className="mt-1" />
  <span className="flex flex-col gap-0.5">
    <span className="text-sm font-medium">折叠·保状态</span>
    <span id="iso-hide-desc" className="text-sm text-muted-foreground">
      离开时折叠为标签组但保留页面状态，返回时直接展开（占用内存）。
    </span>
  </span>
</label>
```

`handleSelect` 的首启判断：`value !== 'off' && setting === 'off'`（任一归档档都弹首启，复用 `countRestorableTabsInWindow`）。即把 `if (value === 'close' && setting === 'off')` 改为 `if (value !== 'off' && setting === 'off')`，`confirmEnable` 写入对应 value（`updateSetting(value)` 而非硬编码 'close'）。

- [ ] **Step 5: Run test to verify it passes + typecheck**

Run: `pnpm run test -- --run src/entrypoints/home/utils/__tests__/workspaceSwitcher.test.tsx src/entrypoints/home/components/SettingsModal/sections/__tests__/WorkspaceTabsSection.test.tsx && pnpm run typecheck`
Expected: PASS + 绿。

- [ ] **Step 6: Commit**

```bash
git add src/shared/tabs/workspaceSwitch.ts src/entrypoints/home/components/SettingsModal/sections/WorkspaceTabsSection.tsx src/entrypoints/home/utils/workspaceSwitcher.tsx src/entrypoints/home/utils/__tests__/workspaceSwitcher.test.tsx src/entrypoints/home/components/SettingsModal/sections/__tests__/WorkspaceTabsSection.test.tsx
git commit -m "feat(ws-tab-iso): T8 switchWorkspaceBySetting 门控 hide + UI 4 档 + 首启扩展"
```

---

## Task 9: deleteWorkspace hide 孤儿组清理

**Files:**
- Modify: `src/store/useWorkspace.ts`（deleteWorkspace 加 hide 组清理）
- Test: `src/store/__tests__/useWorkspace.test.ts`

**Interfaces:**
- Consumes: `findGroupByIdentity` + chrome.tabGroups/tabs（清该 ws 标识组的 tab）

**背景**：删 ws X 时，窗口内可能有其 hide 标识组（折叠）。清之（与 v1 delete 清 tabSession 对齐，不留已删 ws 的 tab URL/组）。

- [ ] **Step 1: 写失败测试**

```typescript
it('deleteWorkspace：清该 ws 的 hide 标识组（孤儿组）', async () => {
  const c = (globalThis as any).chrome;
  c.__testTabs.clear(); c.__testGroups.clear();
  c.__testGroups.set(10, { id: 10, windowId: 1, title: 'X ·xxxx0000', color: 'grey', collapsed: true });
  c.__testTabs.set(1, { id: 1, windowId: 1, url: 'https://x.com', groupId: 10 });
  // ... 走 deleteWorkspace('ws-x')，验证组 10 的 tab 被 remove + 组清
  expect(c.__testTabs.has(1)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run src/store/__tests__/useWorkspace.test.ts`
Expected: FAIL。

- [ ] **Step 3: deleteWorkspace 加 hide 清理**

在 `useWorkspace.ts` 的 deleteWorkspace 逻辑里（v1 已 rebind + 清 tabSession），追加扫所有窗口清该 ws 标识组：

```typescript
// T9：清该 ws 的 hide 标识组（孤儿组，隐私：不留已删 ws tab）
try {
  const wins = await chrome.windows.getAll();
  for (const w of wins) {
    if (w.id == null) continue;
    const gid = await findGroupByIdentity(w.id, deletedWsId);
    if (gid != null) {
      const tabs = await chrome.tabs.query({ windowId: w.id });
      for (const t of tabs.filter((t) => t.groupId === gid && t.id != null)) {
        await chrome.tabs.remove(t.id!);
      }
    }
  }
} catch { /* 非扩展环境 / 部分失败，不阻断 delete */ }
```

（import `findGroupByIdentity` from tabGroupIdentity；chrome 访问参考 v1 范式。）

- [ ] **Step 4: Run test to verify it passes + typecheck**

Run: `pnpm run test -- --run src/store/__tests__/useWorkspace.test.ts && pnpm run typecheck`
Expected: PASS + 绿。

- [ ] **Step 5: Commit**

```bash
git add src/store/useWorkspace.ts src/store/__tests__/useWorkspace.test.ts
git commit -m "feat(ws-tab-iso): T9 deleteWorkspace 清 hide 孤儿组（隐私）"
```

---

## Task 10: 集成测试（承重用例）

**Files:**
- Test: `src/shared/tabs/__tests__/workspaceSwitch.integration.test.ts`（新建，参考 v1 既有 integration test 范式）

**覆盖的承重用例**（codex #9 + spec 测试段）：
- hide 切走折叠 + 切回展开往返（tab 不关）
- 重启标识失效 → 兜底 restore 不丢 tab
- 用户改 title 删标识 → 兜底 restore 重建
- 用户手动解散组（tabGroups.onRemoved 模拟）→ 下次切回兜底
- 多窗口独立（per-window group）
- discard 档切回重载（页面状态不保留）
- undo generation：组结构变化拒绝 undo
- 硬屏障回归：archive 失败不 collapse/discard（hide 模式）
- 失败不更新 binding：dispose/restore 失败停留源 ws
- 跨档 hide→close→hide 往返无 session 污染
- off↔hide↔close 全组合 + 旧 v1 session 兼容
- pinned tab（除 home）remove 处理；incognito 不纳入

- [ ] **Step 1: 写集成测试**

参考 v1 `workspaceSwitch.integration.test.ts` 范式，用 setup.ts 注入的 fake-browser stub 种子 tab/group，端到端跑 `requestWorkspaceSwitch`。每个承重用例一个 `it`，断言 tab/group/binding/session 最终态。完整测试代码遵循 docs/standards/testing.md（只 mock chrome 副作用，真实编排逻辑）。

（测试用例骨架：种子状态 → 调 requestWorkspaceSwitch(wsB, 'B', windowId, mode) → 断言 `__testTabs`/`__testGroups`/binding/session。）

- [ ] **Step 2: Run test to verify it passes + 全量 typecheck/test**

Run: `pnpm run test -- --run && pnpm run typecheck`
Expected: 全绿（含 v1 回归 + v1.1 全部）。

- [ ] **Step 3: Commit**

```bash
git add src/shared/tabs/__tests__/workspaceSwitch.integration.test.ts
git commit -m "test(ws-tab-iso): T10 集成测试（承重用例：往返/兜底/undo/失败/跨档）"
```

---

## Self-Review

**1. Spec coverage**：
- C3 两路径回找 → T2（findGroupByIdentity）+ T4（restoreByMode 兜底）✓
- 归属语义（group=归属，散 tab=当前 ws）→ T3（archiveByMode 过滤）✓
- 失败状态机（不更新 binding）→ T4（disposeByMode ok）+ T5（performSwitch 校验）✓
- restore 原子性 {opened,failed} → T4 ✓
- undo 入队 generation → T6 ✓
- 跨档 normalize → T7 ✓
- pinned（除 home）remove / incognito 不纳入 → T4（disposeByMode pinned remove）+ isRestorable/incognito（边界，T0 stub + T4）✓
- 切换前激活 home → T4 disposeByMode（注：需在 dispose hide 开头加 `chrome.tabs.update(homeTabId, {active:true})`——**补丁：T4 disposeByMode 开头加激活 home tab**，home tab id 由 archive 阶段识别或重查 isInternalPage）
- manifest tabGroups → T1 ✓
- UI 4 档 + 首启 → T8 ✓
- delete 孤儿组 → T9 ✓
- 测试（codex #9）→ T0-T10 各 task 测试 + T10 集成 ✓

**2. 补丁（Self-Review 发现的 gap）**：
- **T4 disposeByMode 切换前激活 home tab**：spec 要求「切换前先激活 pinned home（避 active 阻塞 discard + 避抢焦点）」。T4 disposeByMode hide 分支开头加：
  ```typescript
  // 激活 home tab（避 active tab 在待折叠组致 discard 失败 + 避 restore 抢焦点）
  const allTabs0 = await c.tabs.query({ windowId });
  const homeTab = allTabs0.find((t) => t.id != null && isInternalPage(t));
  if (homeTab?.id != null) { try { await c.tabs.update(homeTab.id, { active: true }); } catch {} }
  ```
  （isInternalPage 复用 v1 isRestorable 的反向；home url 识别参考 v1 focusOrCreateHomeTab HOME_URL）
- incognito：archive/dispose 应跳过 incognito tab。`chrome.tabs.query` 默认含 incognito？补：query 后过滤 `t.incognito`（ChromeTab 加 incognito?: boolean，archiveByMode mine 过滤 `!t.incognito`）。

**3. Type consistency**：
- `TabIsolationMode` = 'close'|'hide-discard'|'hide'（T3 定义，T4/T5/T6/T7 用）✓
- `restoreByMode` 返回 {opened, failed, groupId}（T4 定义，T6 buildUndo 用 groupId）✓ —— **补丁：T4 restoreByMode 返回值加 groupId**
- `requestWorkspaceSwitch(toId, toName, windowId, mode, options)`（T5 定义，T8 switchWorkspaceBySetting 调）✓
- `performSwitch(toId, toName, windowId, mode, options)`（T5）✓

补丁已标注，执行时在对应 task 落实。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-workspace-tab-isolation-v1.1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 每个 task 派新 subagent，task 间 review，快速迭代
2. **Inline Execution** — 本 session 内用 executing-plans 批量执行 + checkpoint

哪种？
