# 关于 Tab + sidebar 版本号 + 新版本更新提示 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Octane 加「关于」设置 Tab（作者/仓库/版本/渠道）、sidebar 版本号、以及基于 `onUpdateAvailable` 的被动新版本提示 + 按渠道引导更新。

**Architecture:** 渠道识别用 `chrome.runtime.id` 零权限匹配已知商店 ID（CWS 已知 / Edge 待补 / 其余 fallback manual）。更新提示走纯被动：background 顶层监听 `runtime.onUpdateAvailable` 写 `storage.local.pendingUpdate`，home 读 storage 显示；按渠道给「前往更新页」链接（CWS/Edge 详情页 / GitHub Releases）。不做 GitHub 主动 fetch（避免商店误报 + 零权限增量）。

**Tech Stack:** React 19 + TypeScript + WXT（`browser.*` 全局）+ shadcn/ui（Base UI）+ Tailwind v4 + CSS Modules + Vitest + Testing Library。

## Global Constraints

- **语言**：代码注释 / 日志 / 测试描述强制中文。
- **chrome 类型**：项目无 `@types/chrome`。组件内用 `declare const chrome: unknown` + 最小接口断言（参考 `ShortcutsSection.tsx`）；background 用 WXT 的 `browser.*` 全局（有类型）。
- **测试**（遵循 `docs/standards/testing.md`）：Vitest + Testing Library；真实渲染 `@/components/ui/*`，不整体 mock；副作用边界（chrome storage）用 `@/test/storageMock` 的 `installChromeStorageLocal`；query 用 `getByRole` / `getByText`；交互用 `userEvent`；断言用 jest-dom matcher（`toBeInTheDocument` 等）。
- **提交前**：`pnpm run typecheck` + `pnpm run test` 双绿（husky pre-push 自动跑）。
- **包管理器**：pnpm。
- **版本号来源**：`chrome.runtime.getManifest().version`（wxt 从 `package.json` 注入 `manifest.version`，运行时直接取）。
- **分支**：`feature/about-update-check`（已建并已提交设计文档，commit `c2dd218`）。

---

## 文件结构

| 文件 | 责任 | 类型 |
|---|---|---|
| `src/shared/distribution.ts` | 渠道识别纯函数 + 渠道→URL/文案表 + semver 比较 | 新建 |
| `src/services/UpdateStore.ts` | `pendingUpdate` 的 storage CRUD + semver 兜底过滤 | 新建 |
| `src/entrypoints/background.ts` | `onUpdateAvailable` 写入 + `onInstalled(update)` 清理（接线） | 改 |
| `src/entrypoints/home/hooks/usePendingUpdate.ts` | 读 `pendingUpdate` + `storage.onChanged` 监听 | 新建 |
| `src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx` | 关于 Tab UI（版本/渠道/作者/仓库/反馈/更新提示） | 新建 |
| `src/entrypoints/home/components/SettingsModal/index.tsx` | Tabs 受控 + `initialTab` prop + 挂载「关于」Tab（接线） | 改 |
| `src/entrypoints/home/components/Sidebar/index.tsx` | header 版本号 + pendingUpdate 小标记（接线） | 改 |
| `src/entrypoints/home/components/Sidebar/index.module.css` | `.version` / `.updateBadge` 样式 | 改 |

测试边界：**逻辑层**（distribution / UpdateStore / usePendingUpdate / AboutSection）TDD 深测；**UI 接线**（background / SettingsModal / Sidebar）手动验证（逻辑已在逻辑层覆盖，接线靠 review + 真机）。

---

## Task 1: `distribution.ts` — 渠道识别 + semver（纯函数）

**Files:**
- Create: `src/shared/distribution.ts`
- Test: `src/shared/__tests__/distribution.test.ts`

**Interfaces:**
- Produces: `detectChannel(id: string): Channel`、`compareVersions(a: string, b: string): number`、`UPDATE_URL: Record<Channel, string>`、`CHANNEL_LABEL: Record<Channel, string>`、`CWS_EXTENSION_ID: string`、`Channel` 类型。

- [ ] **Step 1: 写失败测试**

创建 `src/shared/__tests__/distribution.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  detectChannel,
  compareVersions,
  UPDATE_URL,
  CHANNEL_LABEL,
  CWS_EXTENSION_ID,
} from '../distribution';

describe('detectChannel', () => {
  it('CWS ID 命中 → cws', () => {
    expect(detectChannel(CWS_EXTENSION_ID)).toBe('cws');
  });
  it('未知 ID → manual（安全 fallback）', () => {
    expect(detectChannel('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('manual');
    expect(detectChannel('')).toBe('manual');
  });
});

describe('UPDATE_URL / CHANNEL_LABEL', () => {
  it('CWS URL 含扩展 ID', () => {
    expect(UPDATE_URL.cws).toContain(CWS_EXTENSION_ID);
  });
  it('manual URL 指向 GitHub Releases', () => {
    expect(UPDATE_URL.manual).toBe('https://github.com/VicoHu/Octane/releases');
  });
  it('每个渠道有非空 label', () => {
    expect(CHANNEL_LABEL.cws).toBe('Chrome 商店版');
    expect(CHANNEL_LABEL.manual).toBe('手动安装');
  });
});

describe('compareVersions', () => {
  it('a 更新 → 正数', () => {
    expect(compareVersions('0.1.14.0', '0.1.13.0')).toBeGreaterThan(0);
  });
  it('相等 → 0', () => {
    expect(compareVersions('0.1.13.0', '0.1.13.0')).toBe(0);
  });
  it('b 更新 → 负数', () => {
    expect(compareVersions('0.1.12.0', '0.1.13.0')).toBeLessThan(0);
  });
  it('容忍 v 前缀', () => {
    expect(compareVersions('v0.1.14.0', '0.1.13.0')).toBeGreaterThan(0);
  });
  it('不等长缺位补 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/shared/__tests__/distribution.test.ts`
Expected: FAIL（`Cannot find module '../distribution'`）

- [ ] **Step 3: 写实现**

创建 `src/shared/distribution.ts`：

```ts
/** 分发渠道：由 chrome.runtime.id 匹配已知商店 ID 判定。 */
export type Channel = 'cws' | 'edge' | 'manual';

/** CWS 扩展 ID（已上架）。 */
export const CWS_EXTENSION_ID = 'odelppbgchjofnnncknfnbapghggihlj';
// Edge 上架后补：export const EDGE_EXTENSION_ID = '...';

/** runtime.id → 渠道。未命中已知商店 ID 一律视为手动安装（安全默认）。 */
const CHANNEL_BY_ID: Record<string, Channel> = {
  [CWS_EXTENSION_ID]: 'cws',
  // [EDGE_EXTENSION_ID]: 'edge', // 上架后补
};

/** 各渠道更新页 URL。Edge 待上架后补实际 ID。 */
export const UPDATE_URL: Record<Channel, string> = {
  cws: `https://chromewebstore.google.com/detail/${CWS_EXTENSION_ID}`,
  edge: 'https://microsoftedge.microsoft.com/addons/detail/<EDGE_ID>',
  manual: 'https://github.com/VicoHu/Octane/releases',
};

/** 渠道展示文案。 */
export const CHANNEL_LABEL: Record<Channel, string> = {
  cws: 'Chrome 商店版',
  edge: 'Edge 商店版',
  manual: '手动安装',
};

/** runtime.id → 渠道；未知 ID fallback manual。 */
export function detectChannel(id: string): Channel {
  return CHANNEL_BY_ID[id] ?? 'manual';
}

/**
 * semver 比较：a vs b（容忍前缀 v）。正数=a 更新，0=相等，负数=b 更新。
 * 逐段数值比较，缺位补 0。用于 pendingUpdate 兜底过滤（version<=本地 则无效）。
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run src/shared/__tests__/distribution.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/shared/distribution.ts src/shared/__tests__/distribution.test.ts
git commit -m "feat: 渠道识别 + semver 比较纯函数(distribution.ts)"
```

---

## Task 2: `UpdateStore.ts` — pendingUpdate storage CRUD + semver 兜底

**Files:**
- Create: `src/services/UpdateStore.ts`
- Test: `src/services/__tests__/UpdateStore.test.ts`

**Interfaces:**
- Consumes: `compareVersions` from `@/shared/distribution`（Task 1）。
- Produces: `savePendingUpdate(version: string): Promise<void>`、`clearPendingUpdate(): Promise<void>`、`readPendingUpdate(): Promise<string | null>`。

- [ ] **Step 1: 写失败测试**

创建 `src/services/__tests__/UpdateStore.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';
import { savePendingUpdate, clearPendingUpdate, readPendingUpdate } from '../UpdateStore';

// readPendingUpdate 读 getManifest().version 做兜底；installChromeStorageLocal 会重设
// globalThis.chrome = { storage: { local } }（覆盖 runtime），故每次 install 后补 runtime。
function setRuntimeVersion(v: string) {
  const existing = (globalThis as Record<string, unknown>).chrome ?? {};
  (globalThis as Record<string, unknown>).chrome = {
    ...existing,
    runtime: { getManifest: () => ({ version: v }) },
  };
}

describe('UpdateStore', () => {
  beforeEach(() => {
    vi.clearAllMocks?.();
  });

  it('savePendingUpdate → 写 storage.local.pendingUpdate', async () => {
    const { store } = installChromeStorageLocal({});
    setRuntimeVersion('0.1.13.0');
    await savePendingUpdate('0.1.14.0');
    expect(store.pendingUpdate).toEqual({ version: '0.1.14.0' });
  });

  it('clearPendingUpdate → 删 pendingUpdate', async () => {
    const { store } = installChromeStorageLocal({
      initial: { pendingUpdate: { version: '0.1.14.0' } },
    });
    setRuntimeVersion('0.1.13.0');
    await clearPendingUpdate();
    expect(store.pendingUpdate).toBeUndefined();
  });

  it('readPendingUpdate：pending 超前本地 → 返回版本', async () => {
    installChromeStorageLocal({
      initial: { pendingUpdate: { version: '0.1.14.0' } },
    });
    setRuntimeVersion('0.1.13.0');
    expect(await readPendingUpdate()).toBe('0.1.14.0');
  });

  it('readPendingUpdate：无 pending → null', async () => {
    installChromeStorageLocal({});
    setRuntimeVersion('0.1.13.0');
    expect(await readPendingUpdate()).toBeNull();
  });

  it('readPendingUpdate：pending 不超前（残留）→ null 并清除', async () => {
    const { store, local } = installChromeStorageLocal({
      initial: { pendingUpdate: { version: '0.1.12.0' } },
    });
    setRuntimeVersion('0.1.13.0');
    expect(await readPendingUpdate()).toBeNull();
    expect(local.remove).toHaveBeenCalledWith(['pendingUpdate']);
    expect(store.pendingUpdate).toBeUndefined();
  });

  it('readPendingUpdate：容忍 v 前缀', async () => {
    installChromeStorageLocal({
      initial: { pendingUpdate: { version: 'v0.1.14.0' } },
    });
    setRuntimeVersion('0.1.13.0');
    expect(await readPendingUpdate()).toBe('v0.1.14.0');
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/services/__tests__/UpdateStore.test.ts`
Expected: FAIL（`Cannot find module '../UpdateStore'`）

- [ ] **Step 3: 写实现**

创建 `src/services/UpdateStore.ts`：

```ts
import { compareVersions } from '@/shared/distribution';

// 项目无 @types/chrome：声明全局 chrome，最小子集断言（参考 ShortcutsSection.tsx）。
declare const chrome: unknown;

interface ChromeLike {
  runtime: { getManifest(): { version: string } };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(data: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
  };
}

const PENDING_KEY = 'pendingUpdate';
interface PendingUpdate {
  version: string;
}

function chromeLocal(): ChromeLike['storage']['local'] {
  return (chrome as unknown as ChromeLike).storage.local;
}

/** onUpdateAvailable 触发：持久化 Chrome 推送的待装版本，供 home 读取显示。 */
export async function savePendingUpdate(version: string): Promise<void> {
  await chromeLocal().set({ [PENDING_KEY]: { version } });
}

/** onInstalled(update) 触发：更新已装，清除提示。 */
export async function clearPendingUpdate(): Promise<void> {
  await chromeLocal().remove([PENDING_KEY]);
}

/**
 * 读取待装版本；semver 兜底：若 pending.version <= 本地版本（更新已装但未清），
 * 视为无效（返回 null）并清除残留。返回 null = 无提示。
 */
export async function readPendingUpdate(): Promise<string | null> {
  const local = chromeLocal();
  const localVersion = (chrome as unknown as ChromeLike).runtime.getManifest().version;
  const res = await local.get([PENDING_KEY]);
  const pending = res[PENDING_KEY] as PendingUpdate | undefined;
  if (!pending?.version) return null;
  if (compareVersions(pending.version, localVersion) > 0) {
    return pending.version;
  }
  // 残留（版本不超前）→ 清理
  await local.remove([PENDING_KEY]).catch(() => undefined);
  return null;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run src/services/__tests__/UpdateStore.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/services/UpdateStore.ts src/services/__tests__/UpdateStore.test.ts
git commit -m "feat: pendingUpdate storage CRUD + semver 兜底(UpdateStore)"
```

---

## Task 3: background 接线 — onUpdateAvailable + onInstalled 清理

**Files:**
- Modify: `src/entrypoints/background.ts`

**Interfaces:**
- Consumes: `savePendingUpdate` / `clearPendingUpdate` from `@/services/UpdateStore`（Task 2）。
- 无单测（接线代码，逻辑在 Task 2 覆盖；依赖 WXT `browser.*` 顶层 listener 注册，真机验证）。

- [ ] **Step 1: 加 import**

`src/entrypoints/background.ts` 顶部 import 区加：

```ts
import { savePendingUpdate, clearPendingUpdate } from '@/services/UpdateStore';
```

- [ ] **Step 2: 加 onUpdateAvailable 顶层 listener**

在 `browser.runtime.onInstalled.addListener(...)` 之前（或之后，同为顶层注册），加：

```ts
// Chrome 检测到商店更新包时触发（商店用户被动感知）：持久化待装版本供 home 显示。
// 顶层注册（与 onInstalled 同策略，避 SW 唤醒时序丢事件）。不 reload（不强制重启）。
browser.runtime.onUpdateAvailable.addListener((details: { version: string }) => {
  savePendingUpdate(details.version).catch((e) =>
    console.error('[octane] onUpdateAvailable 保存 pendingUpdate 失败', e),
  );
});
```

- [ ] **Step 3: onInstalled 的 update 分支加清理**

将现有 `onInstalled` listener 的 update 分支：

```ts
} else if (reason === 'update') {
  ensureHomeTabInAllWindows().catch((e) =>
    console.error('[octane] onInstalled(update) 补齐 logo tab 失败', e),
  );
}
```

改为：

```ts
} else if (reason === 'update') {
  ensureHomeTabInAllWindows().catch((e) =>
    console.error('[octane] onInstalled(update) 补齐 logo tab 失败', e),
  );
  // 更新已装 → 清除 pendingUpdate 提示（避免残留）
  clearPendingUpdate().catch((e) =>
    console.error('[octane] onInstalled(update) 清理 pendingUpdate 失败', e),
  );
}
```

- [ ] **Step 4: typecheck**

Run: `pnpm run typecheck`
Expected: 无错（`browser.runtime.onUpdateAvailable` 由 WXT webextension 类型提供；`details.version` 有类型）

- [ ] **Step 5: 提交**

```bash
git add src/entrypoints/background.ts
git commit -m "feat: background 监听 onUpdateAvailable 写 pendingUpdate + 更新后清理"
```

- [ ] **Step 6: 手动验证（真机，推迟到 Task 8 统一）**

`onUpdateAvailable` 对 unpacked 扩展不触发，真机验证方式见 Task 8。

---

## Task 4: `usePendingUpdate` hook — 读 pendingUpdate + onChanged 监听

**Files:**
- Create: `src/entrypoints/home/hooks/usePendingUpdate.ts`
- Test: `src/entrypoints/home/hooks/__tests__/usePendingUpdate.test.tsx`

**Interfaces:**
- Consumes: `readPendingUpdate` from `@/services/UpdateStore`（Task 2）。
- Produces: `usePendingUpdate(): { version: string | null }`（null = 无提示）。

- [ ] **Step 1: 写失败测试**

创建 `src/entrypoints/home/hooks/__tests__/usePendingUpdate.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installChromeStorageLocal } from '@/test/storageMock';
import { usePendingUpdate } from '../usePendingUpdate';

// installChromeStorageLocal 设 chrome = { storage: { local } }，缺 onChanged / runtime。
// 此辅助一次性补齐：onChanged（no-op listener）+ runtime.getManifest 版本。
function setupChrome(opts: { initial?: Record<string, unknown>; version?: string }) {
  installChromeStorageLocal({ initial: opts.initial ?? {} });
  const chromeObj = (globalThis as { chrome?: Record<string, unknown> }).chrome!;
  chromeObj.runtime = { getManifest: () => ({ version: opts.version ?? '0.1.13.0' }) };
  (chromeObj.storage as Record<string, unknown>).onChanged = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
}

describe('usePendingUpdate', () => {
  it('pending 超前 → 返回版本', async () => {
    setupChrome({ initial: { pendingUpdate: { version: '0.1.14.0' } } });
    const { result } = renderHook(() => usePendingUpdate());
    await waitFor(() => expect(result.current.version).toBe('0.1.14.0'));
  });

  it('无 pending → null', async () => {
    setupChrome({});
    const { result } = renderHook(() => usePendingUpdate());
    await waitFor(() => expect(result.current.version).toBeNull());
  });

  it('pending 残留（不超前）→ null', async () => {
    setupChrome({ initial: { pendingUpdate: { version: '0.1.12.0' } }, version: '0.1.13.0' });
    const { result } = renderHook(() => usePendingUpdate());
    await waitFor(() => expect(result.current.version).toBeNull());
  });

  it('注册 storage.onChanged listener（卸载时移除）', () => {
    setupChrome({});
    const { unmount } = renderHook(() => usePendingUpdate());
    const onChanged = ((globalThis as { chrome?: { storage?: Record<string, unknown> } }).chrome!
      .storage! as Record<string, unknown>).onChanged as {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    expect(onChanged.addListener).toHaveBeenCalledOnce();
    unmount();
    expect(onChanged.removeListener).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/entrypoints/home/hooks/__tests__/usePendingUpdate.test.tsx`
Expected: FAIL（`Cannot find module '../usePendingUpdate'`）

- [ ] **Step 3: 写实现**

创建 `src/entrypoints/home/hooks/usePendingUpdate.ts`：

```ts
import { useState, useEffect } from 'react';
import { readPendingUpdate } from '@/services/UpdateStore';

// 项目无 @types/chrome：声明全局 chrome，最小子集断言（参考 ShortcutsSection.tsx）。
declare const chrome: unknown;

interface ChromeLike {
  storage: {
    onChanged: {
      addListener(cb: (changes: unknown, area: string) => void): void;
      removeListener(cb: (changes: unknown, area: string) => void): void;
    };
  };
}

/**
 * 读取待装更新版本；storage.onChanged 变化时重读（多窗口 / background 写入同步）。
 * 返回 version = 有新版本提示；null = 无提示。semver 兜底在 readPendingUpdate 内。
 */
export function usePendingUpdate(): { version: string | null } {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const read = async () => {
      const v = await readPendingUpdate();
      if (active) setVersion(v);
    };
    read();
    const listener = (_changes: unknown, area: string) => {
      if (area === 'local') void read();
    };
    const c = chrome as unknown as ChromeLike;
    c.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      c.storage.onChanged.removeListener(listener);
    };
  }, []);

  return { version };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run src/entrypoints/home/hooks/__tests__/usePendingUpdate.test.tsx`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/entrypoints/home/hooks/usePendingUpdate.ts src/entrypoints/home/hooks/__tests__/usePendingUpdate.test.tsx
git commit -m "feat: usePendingUpdate hook 读 pendingUpdate + storage.onChanged 监听"
```

---

## Task 5: `AboutSection` — 关于 Tab UI

**Files:**
- Create: `src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx`
- Test: `src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx`

**Interfaces:**
- Consumes: `detectChannel` / `UPDATE_URL` / `CHANNEL_LABEL` / `Channel` from `@/shared/distribution`（Task 1）；`usePendingUpdate` from `@/entrypoints/home/hooks/usePendingUpdate`（Task 4）。
- Produces: `AboutSection`（React 组件，无 props）。

- [ ] **Step 1: 写失败测试**

创建 `src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installChromeStorageLocal } from '@/test/storageMock';
import { AboutSection } from '../AboutSection';
import { CWS_EXTENSION_ID, UPDATE_URL } from '@/shared/distribution';

// 一次性设好 chrome：runtime.id（定渠道）+ getManifest.version + tabs.create（外链）+
// storage.local（installChromeStorageLocal）+ storage.onChanged（usePendingUpdate 需要）。
function setupChrome(opts: { id?: string; version?: string; pending?: { version: string } }) {
  const tabsCreate = vi.fn();
  installChromeStorageLocal({
    initial: opts.pending ? { pendingUpdate: opts.pending } : {},
  });
  const chromeObj = (globalThis as { chrome?: Record<string, unknown> }).chrome!;
  chromeObj.runtime = {
    id: opts.id ?? 'unknownid',
    getManifest: () => ({ version: opts.version ?? '0.1.13.0' }),
  };
  chromeObj.tabs = { create: tabsCreate };
  (chromeObj.storage as Record<string, unknown>).onChanged = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  return { tabsCreate };
}

describe('AboutSection', () => {
  it('显示版本号 + 作者 + 仓库', () => {
    setupChrome({ id: CWS_EXTENSION_ID });
    render(<AboutSection />);
    expect(screen.getByText(/v0\.1\.13\.0/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'VicoHu' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'VicoHu/Octane' })).toBeInTheDocument();
  });

  it('CWS 渠道显示「Chrome 商店版」+ 已是最新（无 pending）', () => {
    setupChrome({ id: CWS_EXTENSION_ID });
    render(<AboutSection />);
    expect(screen.getByText('Chrome 商店版')).toBeInTheDocument();
    expect(screen.getByText(/已是最新版本/)).toBeInTheDocument();
  });

  it('manual 渠道显示「手动安装」+ 前往 GitHub Releases', () => {
    const { tabsCreate } = setupChrome({ id: 'unknownid' });
    render(<AboutSection />);
    expect(screen.getByText('手动安装')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /前往 GitHub Releases/ })).toBeInTheDocument();
  });

  it('manual 渠道点「前往 GitHub Releases」→ tabs.create(Releases URL)', async () => {
    const user = userEvent.setup();
    const { tabsCreate } = setupChrome({ id: 'unknownid' });
    render(<AboutSection />);
    await user.click(screen.getByRole('button', { name: /前往 GitHub Releases/ }));
    expect(tabsCreate).toHaveBeenCalledWith({ url: UPDATE_URL.manual });
  });

  it('CWS 渠道有 pending → 显示新版本提示 + 前往商店按钮', async () => {
    const user = userEvent.setup();
    const { tabsCreate } = setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    render(<AboutSection />);
    expect(await screen.findByText(/新版本 v0\.1\.14\.0 可用/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '前往商店' }));
    expect(tabsCreate).toHaveBeenCalledWith({ url: UPDATE_URL.cws });
  });
});
```

> 注：作者/仓库用 `<Button variant="link">` 渲染，Testing Library 默认识别为 `link` role；若实际识别为 `button`，调整 matcher 的 role（实现时验证一次）。

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx`
Expected: FAIL（`Cannot find module '../AboutSection'`）

- [ ] **Step 3: 写实现**

创建 `src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx`：

```tsx
import { Button } from '@/components/ui/button';
import {
  detectChannel,
  UPDATE_URL,
  CHANNEL_LABEL,
  type Channel,
} from '@/shared/distribution';
import { usePendingUpdate } from '@/entrypoints/home/hooks/usePendingUpdate';

// 项目无 @types/chrome：声明全局 chrome，最小子集断言（参考 ShortcutsSection.tsx）。
declare const chrome: unknown;
interface ChromeLike {
  runtime: { id: string; getManifest(): { version: string } };
  tabs: { create(opts: { url: string }): unknown };
}

const AUTHOR_URL = 'https://github.com/VicoHu';
const REPO_URL = 'https://github.com/VicoHu/Octane';
const ISSUES_URL = 'https://github.com/VicoHu/Octane/issues';

/** 关于 Octane：版本/渠道 + 作者/仓库/反馈 + 新版本提示 + 按渠道前往更新页。 */
export function AboutSection() {
  const c = chrome as unknown as ChromeLike;
  const version = c.runtime.getManifest().version;
  const channel: Channel = detectChannel(c.runtime.id);
  const { version: pendingVersion } = usePendingUpdate();

  const open = (url: string) => c.tabs.create({ url });

  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">
          Octane <span className="font-normal text-muted-foreground">v{version}</span>
        </div>
        <div className="mt-1 text-sm text-muted-foreground">{CHANNEL_LABEL[channel]}</div>
      </div>

      <div className="space-y-1 text-sm">
        <Row label="作者" value="VicoHu" onClick={() => open(AUTHOR_URL)} />
        <Row label="开源仓库" value="VicoHu/Octane" onClick={() => open(REPO_URL)} />
        <Row label="反馈 / 报告问题" value="GitHub Issues" onClick={() => open(ISSUES_URL)} />
      </div>

      <UpdateStatus channel={channel} pendingVersion={pendingVersion} onOpen={open} />
    </div>
  );
}

function Row({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-muted-foreground">{label}</span>
      <Button variant="link" className="h-auto p-0 text-foreground" onClick={onClick}>
        {value}
      </Button>
    </div>
  );
}

function UpdateStatus({
  channel,
  pendingVersion,
  onOpen,
}: {
  channel: Channel;
  pendingVersion: string | null;
  onOpen: (url: string) => void;
}) {
  // 手动安装：无自动更新（onUpdateAvailable 不触发），引导 Releases（优先级最高）
  if (channel === 'manual') {
    return (
      <div className="rounded-md border border-border p-3 text-sm">
        <div className="text-muted-foreground">
          手动安装不会收到自动更新提示，请定期查看新版本。
        </div>
        <Button className="mt-2" size="sm" onClick={() => onOpen(UPDATE_URL.manual)}>
          前往 GitHub Releases
        </Button>
      </div>
    );
  }
  // 商店用户收到 Chrome 推送的待装版本
  if (pendingVersion) {
    return (
      <div className="rounded-md border border-border p-3 text-sm">
        <div>新版本 v{pendingVersion} 可用</div>
        <div className="mt-1 text-muted-foreground">
          新版本将通过商店自动更新（审核可能有延迟）。
        </div>
        <Button className="mt-2" size="sm" onClick={() => onOpen(UPDATE_URL[channel])}>
          前往商店
        </Button>
      </div>
    );
  }
  // 商店用户无待装版本：已是最新（商店自动更新）
  return <div className="text-sm text-muted-foreground">已是最新版本（商店自动更新）。</div>;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx
git commit -m "feat: 关于 Tab(AboutSection) 版本/渠道/仓库/更新提示"
```

---

## Task 6: SettingsModal — Tabs 受控 + initialTab + 挂载「关于」Tab

**Files:**
- Modify: `src/entrypoints/home/components/SettingsModal/index.tsx`

**Interfaces:**
- Consumes: `AboutSection` from `./sections/AboutSection`（Task 5）。
- Produces: `SettingsModal` 增加 `initialTab?: string` prop。

> 无单测（容器接线：Tabs 受控切换 + 挂载新 Tab；子组件 AboutSection 已测，整体手测在 Task 8）。

- [ ] **Step 1: 改 import（加 React hooks + AboutSection）**

`src/entrypoints/home/components/SettingsModal/index.tsx` 顶部：

```ts
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { BackupSyncTabs } from '@/components/backup/BackupSyncTabs';
import { PasswordSection } from './sections/PasswordSection';
import { EncryptionTtlSection } from './sections/EncryptionTtlSection';
import { FaviconCacheSection } from './sections/FaviconCacheSection';
import { AboutSection } from './sections/AboutSection';
import styles from './index.module.css';
```

- [ ] **Step 2: 加 initialTab prop + Tabs 受控**

把 `interface SettingsModalProps` 与函数签名、`<Tabs>` 改为：

```ts
interface SettingsModalProps {
  visible: boolean;
  onCancel: () => void;
  /** 打开时默认激活的 Tab（sidebar 版本标记点击时传 'about'）。 */
  initialTab?: string;
}

/**
 * 系统设置中心：左侧分类导航 + 右侧设置详情。
 * 五分区：快捷键 / 数据备份和同步 / 数据维护 / 主密码 / 关于。
 */
export function SettingsModal({ visible, onCancel, initialTab = 'shortcuts' }: SettingsModalProps) {
  const [tab, setTab] = useState(initialTab);

  // 每次打开按 initialTab 重置（支持 sidebar 标记点击直跳「关于」）
  useEffect(() => {
    if (visible) setTab(initialTab);
  }, [visible, initialTab]);

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className={styles.dialogContent}>
        <DialogHeader className={styles.dialogHeader}>
          <DialogTitle className={styles.dialogTitle}>系统设置</DialogTitle>
          <DialogDescription className={styles.dialogDescription}>
            管理快捷键、数据与安全选项
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab} orientation="vertical" className={styles.settingsTabs}>
          <TabsList variant="line" aria-label="设置分类" className={styles.settingsNav}>
            <TabsTrigger value="shortcuts">快捷键</TabsTrigger>
            <TabsTrigger value="backup">数据备份和同步</TabsTrigger>
            <TabsTrigger value="maintenance">数据维护</TabsTrigger>
            <TabsTrigger value="password">主密码</TabsTrigger>
            <TabsTrigger value="about">关于</TabsTrigger>
          </TabsList>
```

- [ ] **Step 3: 加「关于」TabsContent**

在 `password` TabsContent 之后、`</Tabs>` 之前，加：

```tsx
          <TabsContent value="about" className={styles.settingsContent}>
            <header className={styles.sectionHeader}>
              <h2>关于</h2>
              <p>版本信息、开源仓库与更新。</p>
            </header>
            <AboutSection />
          </TabsContent>
```

- [ ] **Step 4: typecheck**

Run: `pnpm run typecheck`
Expected: 无错

- [ ] **Step 5: 提交**

```bash
git add src/entrypoints/home/components/SettingsModal/index.tsx
git commit -m "feat: SettingsModal 加「关于」Tab + Tabs 受控 initialTab"
```

---

## Task 7: Sidebar — header 版本号 + pendingUpdate 小标记

**Files:**
- Modify: `src/entrypoints/home/components/Sidebar/index.tsx`
- Modify: `src/entrypoints/home/components/Sidebar/index.module.css`

**Interfaces:**
- Consumes: `usePendingUpdate` from `@/entrypoints/home/hooks/usePendingUpdate`（Task 4）；`SettingsModal` 的 `initialTab` prop（Task 6）。

> 无单测（UI 接线：读 usePendingUpdate + getManifest 渲染；逻辑在 Task 4 覆盖，整体手测在 Task 8）。

- [ ] **Step 1: 加 import + state**

`src/entrypoints/home/components/Sidebar/index.tsx`：
- import 区加：

```ts
import { usePendingUpdate } from '../../hooks/usePendingUpdate';
```

- Sidebar/index.tsx 顶部无 chrome 声明（已确认全文未直接用 chrome）。新增类型断言声明（参考 ShortcutsSection.tsx 模式）：

```ts
// 项目无 @types/chrome：声明全局 chrome，最小子集断言（参考 ShortcutsSection.tsx）。
declare const chrome: unknown;
interface ChromeLike {
  runtime: { getManifest(): { version: string } };
}
```

- 在组件函数体内（`const [showSettings, setShowSettings] = useState(false);` 附近）加：

```ts
  const { version: pendingVersion } = usePendingUpdate();
  const appVersion = (chrome as unknown as ChromeLike).runtime.getManifest().version;
  // sidebar 版本标记点击 → 打开设置「关于」Tab
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);
```

- [ ] **Step 2: header 加版本号 + 标记**

把现有 header（`{/* 品牌标题 */}` 块）：

```tsx
      <div className={styles.header}>
        <img className={styles.logo} src="/icons/icon-128.png" alt="Octane" />
        <div className={styles.title}>Octane</div>
      </div>
```

改为：

```tsx
      <div className={styles.header}>
        <img className={styles.logo} src="/icons/icon-128.png" alt="Octane" />
        <div className={styles.title}>Octane</div>
        <span className={styles.version}>v{appVersion}</span>
        {pendingVersion && (
          <button
            type="button"
            className={styles.updateBadge}
            aria-label={`新版本 v${pendingVersion} 可用，点击查看`}
            title={`新版本 v${pendingVersion} 可用，点击查看`}
            onClick={() => {
              setSettingsInitialTab('about');
              setShowSettings(true);
            }}
          >
            ↑
          </button>
        )}
      </div>
```

- [ ] **Step 3: SettingsModal 传 initialTab**

把现有：

```tsx
      <SettingsModal visible={showSettings} onCancel={() => setShowSettings(false)} />
```

改为：

```tsx
      <SettingsModal
        visible={showSettings}
        initialTab={settingsInitialTab}
        onCancel={() => setShowSettings(false)}
      />
```

- [ ] **Step 4: 加样式**

`src/entrypoints/home/components/Sidebar/index.module.css` 的 `.title { ... }` 块之后加：

```css
.version {
  font-size: 12px;
  font-weight: 400;
  color: var(--sidebar-text);
  opacity: 0.6;
  margin-left: 0.25rem;
}

/* badge 醒目色实现时对齐 DESIGN.md 当前品牌色 token（参考 sidebar 内其他 accent 用法） */
.updateBadge {
  margin-left: auto;
  border: none;
  background: var(--sidebar-accent, #00B894);
  color: white;
  width: 18px;
  height: 18px;
  border-radius: 9999px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
```

> `.version` 用 `.title` 同族 `--sidebar-text` + opacity 弱化（已知存在）。`.updateBadge` 背景实现时对齐 DESIGN.md 当前品牌色 token，fallback `#00B894`。

- [ ] **Step 5: typecheck**

Run: `pnpm run typecheck`
Expected: 无错

- [ ] **Step 6: 提交**

```bash
git add src/entrypoints/home/components/Sidebar/index.tsx src/entrypoints/home/components/Sidebar/index.module.css
git commit -m "feat: sidebar header 显示版本号 + pendingUpdate 新版本标记"
```

---

## Task 8: 全量验证 + 手动验证清单

**Files:** 无（验证任务）

- [ ] **Step 1: 全量 typecheck**

Run: `pnpm run typecheck`
Expected: 无错

- [ ] **Step 2: 全量测试**

Run: `pnpm run test`
Expected: 全绿（新增 distribution / UpdateStore / usePendingUpdate / AboutSection 用例 + 既有用例）

- [ ] **Step 3: lint**

Run: `pnpm run lint`
Expected: 无新增 error（既有 warning 与本次无关）

- [ ] **Step 4: 构建冒烟**

Run: `pnpm run build`
Expected: 构建成功（产物写入 `.output/chrome-mv3/`）

- [ ] **Step 5: 真机手动验证（装载 `.output/chrome-mv3`）**

1. **版本号 + 渠道**：home tab → sidebar 显示 `v0.1.13.0`；打开 设置 → 关于 → 显示版本 / 渠道（开发 unpacked = `手动安装`）/ 作者 / 仓库 / 反馈。
2. **外链**：关于 Tab 点作者 / 仓库 / 反馈 / 前往 GitHub Releases → 新 tab 打开正确 URL（`https://github.com/VicoHu`、`https://github.com/VicoHu/Octane`、`/issues`、`/releases`）。
3. **onUpdateAvailable 模拟**（dev 期 unpacked 不自动触发）：在 home 的 devtools console 执行
   `chrome.storage.local.set({ pendingUpdate: { version: '9.9.9.9' } })`
   → sidebar 标记出现（↑）+ 关于 Tab 显示更新提示；再 `chrome.storage.local.remove('pendingUpdate')` → 标记消失。
4. **商店渠道分支模拟**：console 临时改 `detectChannel` 返回（或在 console 设 `chrome.runtime.id` 不可改，则改 `CWS_EXTENSION_ID` 常量为当前开发 ID 重新 build）→ 验「Chrome 商店版」+「已是最新版本」/ 有 pending 时「前往商店」按钮跳 CWS 详情页。
5. **清理兜底**：`chrome.storage.local.set({ pendingUpdate: { version: '0.0.0.1' } })`（落后本地）→ 关于 Tab 不显示提示（readPendingUpdate semver 兜底清掉）+ `chrome.storage.local.get('pendingUpdate')` 返回空。
6. **onUpdateAvailable 真实链路**（需上架版，推迟）：上架后用户从 CWS 装载，等 Chrome 后台检查到更新 → 验 sidebar 标记 + 关于提示；更新实际安装后 → `onInstalled(update)` 清掉 pendingUpdate → 标记消失。

- [ ] **Step 6: 提交验证记录（可选）**

手动验证通过后，若需记录，在 commit message 或 PR 描述注明验证结果。无代码改动则无需 commit。

---

## 完成标准

- 三个需求全部实现：「关于」Tab（作者/仓库/版本/渠道）、sidebar 版本号、`onUpdateAvailable` 被动新版本提示 + 按渠道引导更新。
- `pnpm run typecheck` + `pnpm run test` + `pnpm run lint` 三绿。
- 真机验证 Step 1-5 通过（Step 6 上架后补）。
- 零权限增量、零 PRIVACY 增量（`wxt.config.ts` 不改）。
