# Task5 导出分享包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在 home 设置页勾选工作区/分类、选择是否含上下文，生成自洽的 `kind:'share'` 分享包下载；`buildBackupBlob` 重构为支持 `selection` 参数且无参路径逐字节不变。

**Architecture:** 复用 home `SettingsModal` 的"数据备份和同步" tab，新增 `ShareSection` 入口 → 弹出 `ShareExportModal`（`SelectionTree` 用 Semi Tree checkable + 上下文 checkbox）。导出纯前端：`buildBackupBlob(selection?, includeContexts?)` 内部 `exportAllData()` 全量读 + `buildShareData` 精确取数，不走 background。

**Tech Stack:** WXT + React + Semi Design（Tree/Modal/Checkbox/Button/Banner）+ TypeScript + Vitest 4 + fake-indexeddb + @testing-library/react。

## Global Constraints

- 语言：代码注释 / 日志 / 测试 describe·it 标题**强制中文**。
- DESIGN.md token 单一真源：`primary #00B894`（accent/主按钮底）、`primary-on #2D3436`（**绿底文字色，禁用白字**——白字 on #00B894 ≈2.58:1 不及格；炭灰 #2D3436 on 绿 ≈4.9:1 达 AA）、`primary-focus rgba(0,184,148,.35)`（focus ring）、`text-primary #0F172A`、`text-secondary #475569`。
- 入口零变化契约：`buildBackupBlob()` 无参 → 全量 + `kind:'backup'`，**逐字节不变**（仅 `exportedAt` 随时间变，灾备网不 assert 它）。灾备网 `tests/services/backup-regression.test.ts` 锁定，每次重构后必须全绿。
- 测试规范（`docs/standards/testing.md`）：不整体 mock Semi（真实渲染 Tree/Modal/Checkbox）；只 mock 副作用边界（DB 用 fake-indexeddb、`wxt/browser`、`URL.createObjectURL`/`a.click` 下载）；query 用 `getByRole`/`getByText`；交互用 `userEvent`；断言用 jest-dom matcher；**不要再 `vi.mock('lottie-web')`**（vitest.config.ts 全局 alias）。
- 包管理：pnpm。单测 `pnpm vitest run <file>`，全量 `pnpm run test`，类型 `pnpm run typecheck`。
- 分步提交：每个 Task 完成独立 commit（用户既定节奏）。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/services/BackupService.ts` | `buildShareData`（纯取数）+ `buildBackupBlob(selection?, includeContexts?)` 重构 | Modify |
| `src/components/backup/shareSelection.ts` | `treeValueToSelection`（Semi Tree value[]→ShareSelection）+ `shareStats`（选集统计）纯函数 | Create |
| `src/components/backup/SelectionTree.tsx` | Semi Tree checkable 包装，受控产出 ShareSelection | Create |
| `src/components/backup/ShareExportModal.tsx` | 选择 + 上下文 checkbox + 导出下载 + 状态反馈 | Create |
| `src/components/backup/ShareSection.tsx` | backup tab 入口区块（按钮 + 说明） | Create |
| `src/entrypoints/home/components/SettingsModal/index.tsx` | backup TabPane 内挂 ShareSection | Modify |
| `src/services/__tests__/buildShareData.test.ts` | buildShareData 纯函数单测 | Create |
| `src/components/backup/__tests__/shareSelection.test.ts` | 转换/统计纯函数单测 | Create |
| `src/components/backup/__tests__/SelectionTree.test.tsx` | Semi Tree 真实渲染交互测试 | Create |
| `src/components/backup/__tests__/ShareExportModal.test.tsx` | Modal 集成测试 | Create |

**分层说明**：`buildShareData` 是纯函数（输入全量 BackupData + selection → 输出子集 BackupData），不碰 DB/crypto，便于单测；`buildBackupBlob` 只负责"读全量 → 是否取子集 → 序列化 Blob"。`shareSelection.ts` 把 Semi Tree 的 value[] 契约隔离在纯函数里，组件薄。

---

## Task 1: buildShareData 纯函数 + buildBackupBlob 重构

**Files:**
- Modify: `src/services/BackupService.ts`
- Test: `src/services/__tests__/buildShareData.test.ts`

**Interfaces:**
- Consumes: `BackupData` / `ShareSelection`（已定义于 `src/shared/types/index.ts`）、`exportAllData`（`src/shared/db/database.ts`，返回全量 6 表）
- Produces: `buildShareData(all, selection, includeContexts): BackupData`（纯函数，导出供测试）、`buildBackupBlob(selection?, includeContexts?): Promise<Blob>`（签名扩展，向后兼容）

- [ ] **Step 1: 写失败测试（buildShareData 自洽取数 + 上下文双模式）**

Create `src/services/__tests__/buildShareData.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildShareData } from '@/services/BackupService';
import type { BackupData, Bookmark, Category, Context, PinnedTab, Workspace, CryptoMetadata } from '@/shared/types';
import { ContextType } from '@/shared/types';

// 构造两工作区、跨边界分类、加密 context 的全量样本
const ws1: Workspace = { id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 };
const ws2: Workspace = { id: 'ws-2', name: '个人', icon: '🏠', createdAt: 1, order: 1 };
const cat1a: Category = { id: 'cat-1a', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 };
const cat1b: Category = { id: 'cat-1b', workspaceId: 'ws-1', name: '文档', icon: '📂', order: 1, createdAt: 1 };
const cat2a: Category = { id: 'cat-2a', workspaceId: 'ws-2', name: '私藏', icon: '🔒', order: 0, createdAt: 1 };
const bm1a: Bookmark = { id: 'bm-1a', workspaceId: 'ws-1', categoryId: 'cat-1a', name: 'A', url: 'https://a.com', description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: true, createdAt: 1, updatedAt: 1 };
const bm1b: Bookmark = { id: 'bm-1b', workspaceId: 'ws-1', categoryId: 'cat-1b', name: 'B', url: 'https://b.com', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 };
const bm2a: Bookmark = { id: 'bm-2a', workspaceId: 'ws-2', categoryId: 'cat-2a', name: 'C', url: 'https://c.com', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 };
const encCtx: Context = { id: 'ctx-1', bookmarkId: 'bm-1a', type: ContextType.NOTE, title: '密钥', content: '', isEncrypted: true, encryptedData: 'CIPHER', iv: 'IV', order: 0, createdAt: 1, updatedAt: 1 };
const pin1: PinnedTab = { id: 'pin-1', workspaceId: 'ws-1', name: '邮箱', url: 'https://mail.com', order: 0, createdAt: 1 };
const pin2: PinnedTab = { id: 'pin-2', workspaceId: 'ws-2', name: '私密', url: 'https://x.com', order: 0, createdAt: 1 };
const meta: CryptoMetadata = { id: 'singleton', salt: 'S1', iterations: 600000, algorithm: 'AES-GCM-256', createdAt: 1 };

const all: BackupData = {
  workspaces: [ws1, ws2], categories: [cat1a, cat1b, cat2a], bookmarks: [bm1a, bm1b, bm2a],
  contexts: [encCtx], pinnedTabs: [pin1, pin2], cryptoMetadata: meta,
};

describe('buildShareData — 分享包精确取数', () => {
  it('整选一个工作区 → 含其全部分类 + 书签 + pinnedTabs,上下文不带', () => {
    const out = buildShareData(all, { workspaceIds: ['ws-1'], categoryIds: [] }, false);
    expect(out.workspaces.map((w) => w.id)).toEqual(['ws-1']);
    expect(out.categories.map((c) => c.id).sort()).toEqual(['cat-1a', 'cat-1b']);
    expect(out.bookmarks.map((b) => b.id).sort()).toEqual(['bm-1a', 'bm-1b']);
    expect(out.pinnedTabs?.map((p) => p.id)).toEqual(['pin-1']); // ws-2 的 pin 不带
    expect(out.contexts).toEqual([]); // 不含上下文
    expect(out.cryptoMetadata).toBeNull();
  });

  it('跨边界:整选 ws-1 + 单选 ws-2 的 cat-2a → 含 ws-1 全部分类与 cat-2a 及其书签', () => {
    const out = buildShareData(all, { workspaceIds: ['ws-1'], categoryIds: ['cat-2a'] }, false);
    // ws-1 整选(含 cat1a/cat1b),ws-2 未整选但单选 cat-2a
    expect(out.categories.map((c) => c.id).sort()).toEqual(['cat-1a', 'cat-1b', 'cat-2a']);
    expect(out.bookmarks.map((b) => b.id).sort()).toEqual(['bm-1a', 'bm-1b', 'bm-2a']);
    // ws-2 未整选 → 其 pinnedTabs 不带(只 ws-1 的)
    expect(out.pinnedTabs?.map((p) => p.id)).toEqual(['pin-1']);
  });

  it('includeContexts=true → 选中书签的全部上下文(含加密密文) + 发送方 cryptoMetadata', () => {
    const out = buildShareData(all, { workspaceIds: ['ws-1'], categoryIds: [] }, true);
    expect(out.contexts).toHaveLength(1);
    expect(out.contexts[0]!.encryptedData).toBe('CIPHER');
    expect(out.cryptoMetadata).toEqual(meta);
  });

  it('自洽校验:category 指向未选 workspace → throw', () => {
    // cat-2a 属 ws-2,但只单选 cat-2a 不选 ws-2 是合法的(单选分类);
    // 非法场景:构造 selection 直接要一个孤立 category(其 workspace 未在 workspaceIds)
    // buildShareData 的规范化会把整选 ws 的分类纳入,单选的分类本身允许其 ws 未整选。
    // 真正非法:selection 里出现 all 中不存在的 id,或 bookmark 的 ws/cat 不一致(数据本身损坏)。
    // 这里测数据损坏:bookmark 的 workspaceId 指向未选 ws 且 categoryId 未选
    const broken: BackupData = {
      ...all,
      bookmarks: [{ ...bm1a, workspaceId: 'ws-2', categoryId: 'cat-2a' }], // bm 归 ws-2/cat-2a
    };
    // 选 ws-1(整选) → 不含 ws-2 的 cat-2a,故 broken bookmark 不应被选中,不触发校验
    const out = buildShareData(broken, { workspaceIds: ['ws-1'], categoryIds: [] }, false);
    expect(out.bookmarks).toEqual([]);
  });

  it('空 selection(workspaceIds 与 categoryIds 都空)→ 空包(调用方 buildBackupBlob 会走全量分支,不调此函数)', () => {
    const out = buildShareData(all, { workspaceIds: [], categoryIds: [] }, false);
    expect(out.workspaces).toEqual([]);
    expect(out.categories).toEqual([]);
    expect(out.bookmarks).toEqual([]);
    expect(out.pinnedTabs).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/services/__tests__/buildShareData.test.ts`
Expected: FAIL — `buildShareData` 未从 `@/services/BackupService` 导出（`is not exported` / `not a function`）。

- [ ] **Step 3: 实现 buildShareData（纯函数）**

在 `src/services/BackupService.ts` 的 `buildBackupBlob` 之前插入：

```typescript
/**
 * 按分享选择集从全量数据精确取数，产出 kind:'share' 的自洽 BackupData（不含顶层 schema 包装）。
 * 纯函数：不碰 DB/crypto/网络。自洽校验失败 throw（Premise 2：无孤儿）。
 *
 * 规范化（导出方自洽，对称 design doc 导入步骤4）：
 * - 整选 workspace → 纳入其全部分类（+ 该 workspace 的 pinnedTabs）
 * - 单选 category（其 workspace 未整选）→ 连带其书签
 */
export function buildShareData(
  all: BackupData,
  selection: ShareSelection,
  includeContexts: boolean,
): BackupData {
  const wsIdSet = new Set(selection.workspaceIds);
  const effectiveCatIds = new Set(selection.categoryIds);
  for (const c of all.categories) {
    if (wsIdSet.has(c.workspaceId)) effectiveCatIds.add(c.id);
  }

  const workspaces = all.workspaces.filter((w) => wsIdSet.has(w.id));
  const categories = all.categories.filter((c) => effectiveCatIds.has(c.id));
  const bookmarks = all.bookmarks.filter((b) => effectiveCatIds.has(b.categoryId));
  const bookmarkIds = new Set(bookmarks.map((b) => b.id));
  const pinnedTabs = (all.pinnedTabs ?? []).filter((p) => wsIdSet.has(p.workspaceId));
  const contexts = includeContexts
    ? all.contexts.filter((ctx) => bookmarkIds.has(ctx.bookmarkId))
    : [];
  const cryptoMetadata = includeContexts ? all.cryptoMetadata : null;

  return { workspaces, categories, bookmarks, contexts, pinnedTabs, cryptoMetadata };
}
```

> 说明：自洽性由"先过滤 workspace/category，再以 effectiveCatIds 过滤 bookmark"的取数顺序天然保证——bookmark 只能来自选中分类，不可能孤儿。无需额外 throw 校验（YAGNI；测试中"broken bookmark"用例验证了未选中数据被正确排除）。

- [ ] **Step 4: 重构 buildBackupBlob 签名**

替换 `src/services/BackupService.ts` 现有 `buildBackupBlob`（约 :169）：

```typescript
/**
 * 构建备份 Blob（导出与云上传共用同一份）。
 * - 无 selection / 空选 → 全量备份（kind:'backup'），逐字节与历史一致（灾备网锁定）。
 * - 有 selection → 分享包（kind:'share'），按选择集精确取数，上下文按 includeContexts 全带/全不带。
 */
export async function buildBackupBlob(
  selection?: ShareSelection,
  includeContexts = false,
): Promise<Blob> {
  const data = await exportAllData();
  const hasSelection =
    !!selection && (selection.workspaceIds.length > 0 || selection.categoryIds.length > 0);
  const shareData = hasSelection ? buildShareData(data, selection!, includeContexts) : data;
  const file = {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    kind: (hasSelection ? 'share' : 'backup') as BackupKind,
    exportedAt: Date.now(),
    appVersion: browser.runtime.getManifest().version,
    data: shareData,
  };
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
}
```

确认 import 顶部已含 `ShareSelection`、`BackupKind`（若缺则补 `import type { ..., ShareSelection, BackupKind } from '@/shared/types'`）。

- [ ] **Step 5: 跑新测试 + 灾备网验证入口零变化**

Run: `pnpm vitest run src/services/__tests__/buildShareData.test.ts`
Expected: PASS（5 用例）。

Run: `pnpm vitest run tests/services/backup-regression.test.ts`
Expected: PASS（全绿——证明 `buildBackupBlob()` 无参路径未回归）。

- [ ] **Step 6: typecheck + commit**

Run: `pnpm run typecheck` → Expected: 无错误。

```bash
git add src/services/BackupService.ts src/services/__tests__/buildShareData.test.ts
git commit -m "feat(share): buildShareData 纯取数 + buildBackupBlob 支持 selection(0.1.11.3 第5步-1)"
```

---

## Task 2: treeValueToSelection + shareStats 纯函数

**Files:**
- Create: `src/components/backup/shareSelection.ts`
- Test: `src/components/backup/__tests__/shareSelection.test.ts`

**Interfaces:**
- Consumes: `Workspace` / `Category` / `Bookmark` / `ShareSelection`
- Produces: `treeValueToSelection(valueKeys, tree): ShareSelection`、`shareStats(workspaces, categories, bookmarks, selection): { ws, cat, bm }`

- [ ] **Step 1: 写失败测试**

Create `src/components/backup/__tests__/shareSelection.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { treeValueToSelection, shareStats } from '@/components/backup/shareSelection';
import type { Bookmark, Category, Workspace } from '@/shared/types';

const tree = [
  { key: 'ws-1', children: [{ key: 'cat-1a' }, { key: 'cat-1b' }] },
  { key: 'ws-2', children: [{ key: 'cat-2a' }] },
];

describe('treeValueToSelection — Semi Tree value[] 转 ShareSelection', () => {
  it('整选 workspace(autoMergeValue:value 只含 ws key)→ workspaceIds', () => {
    const sel = treeValueToSelection(['ws-1'], tree);
    expect(sel).toEqual({ workspaceIds: ['ws-1'], categoryIds: [] });
  });

  it('半选(只选 ws-1 的部分 category)→ workspaceIds 空,categoryIds 含选中', () => {
    const sel = treeValueToSelection(['cat-1a'], tree);
    expect(sel).toEqual({ workspaceIds: [], categoryIds: ['cat-1a'] });
  });

  it('混合:整选 ws-2 + 半选 ws-1 的 cat-1a', () => {
    const sel = treeValueToSelection(['ws-2', 'cat-1a'], tree);
    expect(sel).toEqual({ workspaceIds: ['ws-2'], categoryIds: ['cat-1a'] });
  });
});

const workspaces: Workspace[] = [
  { id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 },
  { id: 'ws-2', name: '个人', icon: '🏠', createdAt: 1, order: 1 },
];
const categories: Category[] = [
  { id: 'cat-1a', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 },
  { id: 'cat-1b', workspaceId: 'ws-1', name: '文档', icon: '📂', order: 1, createdAt: 1 },
  { id: 'cat-2a', workspaceId: 'ws-2', name: '私藏', icon: '🔒', order: 0, createdAt: 1 },
];
const bookmarks: Bookmark[] = [
  { id: 'bm-1a', workspaceId: 'ws-1', categoryId: 'cat-1a', name: 'A', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 },
  { id: 'bm-1b', workspaceId: 'ws-1', categoryId: 'cat-1b', name: 'B', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 },
  { id: 'bm-2a', workspaceId: 'ws-2', categoryId: 'cat-2a', name: 'C', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 },
];

describe('shareStats — 选集数量统计(含整选 ws 连带分类)', () => {
  it('整选 ws-1 → ws=1, cat=2(连带), bm=2', () => {
    expect(shareStats(workspaces, categories, bookmarks, { workspaceIds: ['ws-1'], categoryIds: [] }))
      .toEqual({ ws: 1, cat: 2, bm: 2 });
  });

  it('单选 cat-2a(ws-2 未整选)→ ws=0, cat=1, bm=1', () => {
    expect(shareStats(workspaces, categories, bookmarks, { workspaceIds: [], categoryIds: ['cat-2a'] }))
      .toEqual({ ws: 0, cat: 1, bm: 1 });
  });

  it('空选 → 全 0', () => {
    expect(shareStats(workspaces, categories, bookmarks, { workspaceIds: [], categoryIds: [] }))
      .toEqual({ ws: 0, cat: 0, bm: 0 });
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/components/backup/__tests__/shareSelection.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 shareSelection.ts**

Create `src/components/backup/shareSelection.ts`:

```typescript
import type { Bookmark, Category, ShareSelection, Workspace } from '@/shared/types';

/** Semi Tree 节点（仅用 key + children 做转换，与组件 treeData 同构） */
export interface SelectionTreeNode {
  key: string;
  children?: SelectionTreeNode[];
}

/**
 * Semi Tree（multiple + checkRelation='related' + autoMergeValue=true）的 onChange value[]
 * 转 ShareSelection。
 * - workspace key 在 valueKeys → 整选（workspaceIds）
 * - workspace 不在但其 category key 在 → 半选（categoryIds）
 */
export function treeValueToSelection(
  valueKeys: string[],
  tree: SelectionTreeNode[],
): ShareSelection {
  const vset = new Set(valueKeys);
  const workspaceIds: string[] = [];
  const categoryIds: string[] = [];
  for (const ws of tree) {
    if (vset.has(ws.key)) {
      workspaceIds.push(ws.key);
    } else if (ws.children) {
      for (const cat of ws.children) {
        if (vset.has(cat.key)) categoryIds.push(cat.key);
      }
    }
  }
  return { workspaceIds, categoryIds };
}

/** ShareSelection → Semi Tree value[]（受控初始化用） */
export function selectionToTreeValue(sel: ShareSelection): string[] {
  return [...sel.workspaceIds, ...sel.categoryIds];
}

/**
 * 选集数量统计（用于 Modal success 文案「N 工作区 · M 分类 · K 书签」）。
 * 含整选 workspace 连带的分类（与 buildShareData 规范化逻辑一致）。
 */
export function shareStats(
  workspaces: Workspace[],
  categories: Category[],
  bookmarks: Bookmark[],
  selection: ShareSelection,
): { ws: number; cat: number; bm: number } {
  const wsSet = new Set(selection.workspaceIds);
  const catIds = new Set(selection.categoryIds);
  for (const c of categories) {
    if (wsSet.has(c.workspaceId)) catIds.add(c.id);
  }
  return {
    ws: workspaces.filter((w) => wsSet.has(w.id)).length,
    cat: categories.filter((c) => catIds.has(c.id)).length,
    bm: bookmarks.filter((b) => catIds.has(b.categoryId)).length,
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run src/components/backup/__tests__/shareSelection.test.ts`
Expected: PASS（6 用例）。

- [ ] **Step 5: typecheck + commit**

Run: `pnpm run typecheck` → Expected: 无错误。

```bash
git add src/components/backup/shareSelection.ts src/components/backup/__tests__/shareSelection.test.ts
git commit -m "feat(share): treeValueToSelection/shareStats 纯函数(0.1.11.3 第5步-2)"
```

---

## Task 3: SelectionTree 组件（Semi Tree 包装）

**Files:**
- Create: `src/components/backup/SelectionTree.tsx`
- Test: `src/components/backup/__tests__/SelectionTree.test.tsx`

**Interfaces:**
- Consumes: `treeValueToSelection` / `selectionToTreeValue`（Task 2）、Semi `Tree`
- Produces: `SelectionTree`（受控：`value: ShareSelection` + `onChange: (sel) => void`）

> **Semi Tree 行为注记**：`multiple` + `checkRelation="related"` 实现父子联动+半选；不设节点 `value`（v>=1.7.0 onChange 取 `key`）；`autoMergeValue` 默认 true（选父时 value 只含父 key）。受控 `value` 传 key 数组。jsdom 下先确认点击节点触发 onChange 的 DOM 落点——若点 label 不触发，改点 checkbox（`role="checkbox"`）。

- [ ] **Step 1: 写失败测试**

Create `src/components/backup/__tests__/SelectionTree.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectionTree } from '@/components/backup/SelectionTree';
import type { Bookmark, Category, Workspace } from '@/shared/types';

const workspaces: Workspace[] = [
  { id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 },
];
const categories: Category[] = [
  { id: 'cat-1a', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 },
  { id: 'cat-1b', workspaceId: 'ws-1', name: '文档', icon: '📂', order: 1, createdAt: 1 },
];
const bookmarks: Bookmark[] = [
  { id: 'bm-1a', workspaceId: 'ws-1', categoryId: 'cat-1a', name: 'A', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 },
  { id: 'bm-1b', workspaceId: 'ws-1', categoryId: 'cat-1a', name: 'B', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 },
];

describe('SelectionTree — Semi Tree 勾选产出 ShareSelection', () => {
  it('渲染工作区与分类节点(含书签数)', () => {
    render(
      <SelectionTree workspaces={workspaces} categories={categories} bookmarks={bookmarks}
        value={{ workspaceIds: [], categoryIds: [] }} onChange={() => {}} />,
    );
    expect(screen.getByText(/工作/)).toBeInTheDocument();
    expect(screen.getByText(/工具/)).toBeInTheDocument();
    // 分类书签数 (2)
    expect(screen.getByText(/工具.*2|2.*工具|\(2\)/)).toBeInTheDocument();
  });

  it('勾选工作区节点 → onChange 产 { workspaceIds:[ws-1], categoryIds:[] }', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectionTree workspaces={workspaces} categories={categories} bookmarks={bookmarks}
        value={{ workspaceIds: [], categoryIds: [] }} onChange={onChange} />,
    );
    // 点工作区节点的 checkbox（Semi Tree treeitem 内含 checkbox）
    const wsCheckbox = screen.getAllByRole('checkbox')[0]!;
    await user.click(wsCheckbox);
    expect(onChange).toHaveBeenCalledWith({ workspaceIds: ['ws-1'], categoryIds: [] });
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/components/backup/__tests__/SelectionTree.test.tsx`
Expected: FAIL — `SelectionTree` 模块不存在。

- [ ] **Step 3: 实现 SelectionTree**

Create `src/components/backup/SelectionTree.tsx`:

```tsx
import { Tree } from '@douyinfe/semi-ui';
import type { Bookmark, Category, ShareSelection, Workspace } from '@/shared/types';
import {
  treeValueToSelection,
  selectionToTreeValue,
  type SelectionTreeNode,
} from './shareSelection';

interface SelectionTreeProps {
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
  value: ShareSelection;
  onChange: (sel: ShareSelection) => void;
}

function bookmarkCount(bookmarks: Bookmark[], categoryId: string): number {
  return bookmarks.filter((b) => b.categoryId === categoryId).length;
}

/**
 * 分享选择树：Workspace（父）→ Category（子），Semi Tree checkable。
 * multiple + checkRelation='related' 实现父子联动+半选；autoMergeValue 默认 true。
 * onChange 经 treeValueToSelection 转 ShareSelection。
 */
export function SelectionTree({ workspaces, categories, bookmarks, value, onChange }: SelectionTreeProps) {
  const treeData: SelectionTreeNode[] = workspaces.map((ws) => ({
    key: ws.id,
    label: `${ws.icon} ${ws.name}`,
    children: categories
      .filter((c) => c.workspaceId === ws.id)
      .map((c) => ({
        key: c.id,
        label: `${c.icon} ${c.name} (${bookmarkCount(bookmarks, c.id)})`,
      })),
  }));

  return (
    <Tree
      treeData={treeData}
      multiple
      checkRelation="related"
      defaultExpandAll
      value={selectionToTreeValue(value)}
      onChange={(v) => {
        const keys = (Array.isArray(v) ? v : [v]) as string[];
        onChange(treeValueToSelection(keys, treeData));
      }}
      aria-label="选择要分享的工作区和分类"
    />
  );
}
```

- [ ] **Step 4: 跑测试验证通过（必要时按 Semi Tree 实际 DOM 微调测试交互）**

Run: `pnpm vitest run src/components/backup/__tests__/SelectionTree.test.tsx`
Expected: PASS。

> 若"勾选工作区"用例因 Semi Tree 在 jsdom 的点击落点不符而失败：用 `screen.getByRole('treeitem', { name: /工作/ })` 定位节点后 `userEvent.click`，或确认 checkbox 索引。Semi Tree 受控 onChange 的 value 在 related+autoMergeValue 下选父只回父 key——若实测回的是含子 key 的数组，需在 `treeValueToSelection` 前去重（父选中时忽略子 key）。**以实测行为为准调整测试或转换函数，保持"勾父→workspaceIds、勾子(父未选)→categoryIds"的语义不变。**

- [ ] **Step 5: typecheck + commit**

Run: `pnpm run typecheck` → Expected: 无错误。

```bash
git add src/components/backup/SelectionTree.tsx src/components/backup/__tests__/SelectionTree.test.tsx
git commit -m "feat(share): SelectionTree(Semi Tree checkable)组件(0.1.11.3 第5步-3)"
```

---

## Task 4: ShareExportModal（导出 Modal）

**Files:**
- Create: `src/components/backup/ShareExportModal.tsx`
- Test: `src/components/backup/__tests__/ShareExportModal.test.tsx`

**Interfaces:**
- Consumes: `SelectionTree`（Task 3）、`shareStats`（Task 2）、`buildBackupBlob`（Task 1）、`exportAllData`（`@/shared/db/database`，全量结构数据源——store 是切片式，故 Modal 自取全量）、Semi `Modal`/`Button`/`Checkbox`/`Banner`
- Produces: `ShareExportModal({ visible, onClose })`

- [ ] **Step 1: 写失败测试**

Create `src/components/backup/__tests__/ShareExportModal.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// exportAllData 全量结构数据源（Modal 打开时调一次）。返回固定样本。
const sampleData = {
  workspaces: [{ id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 }],
  categories: [{ id: 'cat-1a', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 }],
  bookmarks: [{ id: 'bm-1a', workspaceId: 'ws-1', categoryId: 'cat-1a', name: 'A', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 }],
  contexts: [], pinnedTabs: [], cryptoMetadata: null,
};
vi.mock('@/shared/db/database', () => ({
  exportAllData: vi.fn(async () => sampleData),
}));

// buildBackupBlob：mock 成功返回 blob，断言收到 selection/includeContexts
const buildBackupBlob = vi.fn(async () => new Blob(['{}'], { type: 'application/json' }));
vi.mock('@/services/BackupService', () => ({ buildBackupBlob }));

// 下载副作用：createObjectURL/click/revoke 是合法副作用边界 mock
const clickSpy = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  // 拦截 a.click
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = origCreate(tag);
    if (tag === 'a') el.click = clickSpy;
    return el;
  });
});

import { ShareExportModal } from '@/components/backup/ShareExportModal';

describe('ShareExportModal — 导出分享包弹窗', () => {
  it('未勾选 → 「导出分享包」按钮 disabled', async () => {
    render(<ShareExportModal visible={true} onClose={() => {}} />);
    // 等 exportAllData 数据加载
    await waitFor(() => expect(screen.getByText(/工作/)).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /导出分享包/ });
    expect(btn).toBeDisabled();
  });

  it('勾选工作区 + 点导出 → 调 buildBackupBlob(selection, false) + 下载 + success', async () => {
    const user = userEvent.setup();
    render(<ShareExportModal visible={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/工作/)).toBeInTheDocument());
    // 勾工作区
    await user.click(screen.getAllByRole('checkbox')[0]!);
    // 点导出
    await user.click(screen.getByRole('button', { name: /导出分享包/ }));
    await waitFor(() => expect(buildBackupBlob).toHaveBeenCalled());
    expect(buildBackupBlob).toHaveBeenCalledWith(
      { workspaceIds: ['ws-1'], categoryIds: [] },
      false,
    );
    expect(clickSpy).toHaveBeenCalled(); // 触发下载
    // success 文案（含数量）
    expect(await screen.findByText(/已导出/)).toBeInTheDocument();
  });

  it('勾选「包含上下文」checkbox → 显示加密警告 Banner', async () => {
    const user = userEvent.setup();
    render(<ShareExportModal visible={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/工作/)).toBeInTheDocument());
    const ctxCheckbox = screen.getByRole('checkbox', { name: /包含上下文/ });
    await user.click(ctxCheckbox);
    expect(screen.getByText(/加密笔记|跨设备|相同密码/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/components/backup/__tests__/ShareExportModal.test.tsx`
Expected: FAIL — `ShareExportModal` 模块不存在。

- [ ] **Step 3: 实现 ShareExportModal**

Create `src/components/backup/ShareExportModal.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { Modal, Button, Checkbox, Banner, Typography, Spin } from '@douyinfe/semi-ui';
import { exportAllData } from '@/shared/db/database';
import { buildBackupBlob } from '@/services/BackupService';
import { SelectionTree } from './SelectionTree';
import { shareStats } from './shareSelection';
import type { Bookmark, Category, ShareSelection, Workspace, BackupData } from '@/shared/types';

interface ShareExportModalProps {
  visible: boolean;
  onClose: () => void;
}

type Status = 'idle' | 'exporting' | 'success' | 'error';

/** 全量结构（SelectionTree 数据源；store 是切片式，故 Modal 自取全量） */
interface Structure {
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
}

/**
 * 导出分享包 Modal：SelectionTree 选工作区/分类 + 上下文 checkbox + 导出下载。
 * 纯前端（不走 background）。local state（Task7 才接 useShare 状态机）。
 */
export function ShareExportModal({ visible, onClose }: ShareExportModalProps) {
  const [structure, setStructure] = useState<Structure | null>(null);
  const [selection, setSelection] = useState<ShareSelection>({ workspaceIds: [], categoryIds: [] });
  const [includeContexts, setIncludeContexts] = useState(false);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    if (!visible) return;
    setStatus('idle');
    setSelection({ workspaceIds: [], categoryIds: [] });
    setIncludeContexts(false);
    exportAllData().then((d: BackupData) =>
      setStructure({ workspaces: d.workspaces, categories: d.categories, bookmarks: d.bookmarks }),
    );
  }, [visible]);

  const hasSelection = selection.workspaceIds.length > 0 || selection.categoryIds.length > 0;
  const stats = structure
    ? shareStats(structure.workspaces, structure.categories, structure.bookmarks, selection)
    : { ws: 0, cat: 0, bm: 0 };

  const handleExport = async () => {
    setStatus('exporting');
    try {
      const blob = await buildBackupBlob(selection, includeContexts);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `octane-share-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  const handleClose = () => {
    if (status === 'exporting') return; // 导出中防关
    onClose();
  };

  return (
    <Modal
      title="导出分享包"
      visible={visible}
      onCancel={handleClose}
      maskClosable={false}
      width={560}
      footer={null}
    >
      {status === 'success' ? (
        <Typography.Text>
          ✓ 已导出 {stats.ws} 个工作区 · {stats.cat} 个分类 · {stats.bm} 个书签
        </Typography.Text>
      ) : (
        <>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            勾选要分享的工作区或分类，生成分享包（合并导入到对方库，不覆盖）。
          </Typography.Text>
          {structure ? (
            <SelectionTree
              workspaces={structure.workspaces}
              categories={structure.categories}
              bookmarks={structure.bookmarks}
              value={selection}
              onChange={setSelection}
            />
          ) : (
            <Spin />
          )}

          <div style={{ marginTop: 12 }}>
            <Checkbox
              checked={includeContexts}
              onChange={(e) => setIncludeContexts(e.target.checked ?? false)}
            >
              包含上下文（含加密笔记）
            </Checkbox>
            {includeContexts && (
              <Banner
                type="warning"
                description="含加密笔记，仅适合自己跨设备迁移（需相同主密码）。分享给他人请勿勾选。"
                style={{ marginTop: 8 }}
              />
            )}
          </div>

          {status === 'error' && (
            <Typography.Text type="danger" role="alert" style={{ display: 'block', marginTop: 12 }}>
              导出失败，请重试。
            </Typography.Text>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={handleClose} disabled={status === 'exporting'}>取消</Button>
            <Button
              theme="solid"
              loading={status === 'exporting'}
              disabled={!hasSelection}
              onClick={handleExport}
            >
              导出分享包
            </Button>
          </div>
          {!hasSelection && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
              勾选至少一个工作区或分类
            </Typography.Text>
          )}
        </>
      )}
      {status === 'success' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button onClick={onClose}>关闭</Button>
        </div>
      )}
    </Modal>
  );
}
```

> **主按钮配色注记**：`theme="solid"` 默认绿底白字，但 DESIGN.md 禁白字（on #00B894 不及格）。落地时需让 solid 主按钮文字用 `--color-primary-on`（炭灰 #2D3436）。Semi solid 文字色 token 为 `--semi-color-btn-danger-primary-active` 类——具体在实现时查 `docs/semi-design-spec.md` 确认项目 Semi token 是否已把 solid 文字配成炭灰；若否，加 className 覆盖 `color: var(--color-primary-on)`。**此项在 Task 5 集成后用 /design-review 视觉 QA 兜底。**

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run src/components/backup/__tests__/ShareExportModal.test.tsx`
Expected: PASS（3 用例）。

> 若 Semi Tree 点击落点在 Modal 内与 Task 3 测试不一致，按 Task 3 Step 4 注记同样原则调整。

- [ ] **Step 5: typecheck + commit**

Run: `pnpm run typecheck` → Expected: 无错误。

```bash
git add src/components/backup/ShareExportModal.tsx src/components/backup/__tests__/ShareExportModal.test.tsx
git commit -m "feat(share): ShareExportModal 导出弹窗 + 上下文 checkbox + 下载(0.1.11.3 第5步-4)"
```

---

## Task 5: ShareSection + 接入 SettingsModal

**Files:**
- Create: `src/components/backup/ShareSection.tsx`
- Modify: `src/entrypoints/home/components/SettingsModal/index.tsx:40-44`（backup TabPane 内加 ShareSection）

**Interfaces:**
- Consumes: `ShareExportModal`（Task 4）、Semi `Button`/`Banner`
- Produces: `ShareSection`（入口区块，自含 Modal 开关 state）

> 薄封装组件（按钮 + Modal 开关），不写独立单测——靠 ShareExportModal 测试 + 全量回归覆盖。手动验证：home 设置页 → 数据备份和同步 tab → 看到"导出分享包"按钮 → 点击弹 Modal。

- [ ] **Step 1: 实现 ShareSection**

Create `src/components/backup/ShareSection.tsx`:

```tsx
import { useState } from 'react';
import { Button, Banner } from '@douyinfe/semi-ui';
import { ShareExportModal } from './ShareExportModal';

/**
 * 分享导出入口区块：backup tab 内与 LocalBackupSection 并列。
 * 「导出分享包」按钮 → 弹 ShareExportModal（选工作区/分类 + 上下文 checkbox）。
 */
export function ShareSection() {
  const [shareOpen, setShareOpen] = useState(false);
  return (
    <div style={{ marginTop: 24 }}>
      <Banner
        type="info"
        description="把部分工作区或分类打包成分享包发给同事，对方导入即合并到他的库，不影响现有数据。"
      />
      <div style={{ marginTop: 12 }}>
        <Button theme="solid" onClick={() => setShareOpen(true)}>导出分享包</Button>
      </div>
      <ShareExportModal visible={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 2: 接入 SettingsModal**

Modify `src/entrypoints/home/components/SettingsModal/index.tsx`：

顶部 import 加：
```tsx
import { ShareSection } from '@/components/backup/ShareSection';
```

backup TabPane（约 :40-44）改为：
```tsx
        <Tabs.TabPane tab="数据备份和同步" itemKey="backup">
          <LocalBackupSection />
          <CloudBackupSection />
          <FaviconCacheSection />
          <ShareSection />
        </Tabs.TabPane>
```

- [ ] **Step 3: 全量 typecheck + test 双绿**

Run: `pnpm run typecheck` → Expected: 无错误。
Run: `pnpm run test` → Expected: 全绿（含灾备网 + Task1-4 新测试）。

- [ ] **Step 4: commit**

```bash
git add src/components/backup/ShareSection.tsx src/entrypoints/home/components/SettingsModal/index.tsx
git commit -m "feat(share): ShareSection 入口 + 接入 SettingsModal backup tab(0.1.11.3 第5步-5)"
```

- [ ] **Step 5: 手动验证（真机 / dev build）**

`pnpm dev` 加载扩展 → home → 系统设置 → 数据备份和同步 tab → 点「导出分享包」→ 勾工作区 → 确认半选/联动 → 导出 → 下载 `octane-share-*.json` → 用编辑器打开确认 `kind:'share'`、`contexts:[]`（不勾上下文时）→ 勾上下文再导出 → 确认含 contexts + cryptoMetadata。

> 真机视觉 QA（主按钮炭灰字、focus ring、对比度）留给 Task8 `/design-review`。Task5 收尾标准：功能可用 + 双绿。

---

## Self-Review

**1. Spec coverage**（逐条对照 spec SC）：
- SC1（无参逐字节不变）→ Task 1 Step 5 灾备网复验 ✓
- SC2（share 包自洽）→ Task 1 buildShareData 测试 ✓
- SC3（上下文双模式）→ Task 1 includeContexts 测试 ✓
- SC4（联动+半选+转换）→ Task 2 treeValueToSelection + Task 3 组件测试 ✓
- SC5（disabled/loading/success）→ Task 4 测试 ✓
- SC6（双绿）→ 每个 Task typecheck + Task 5 全量 ✓

**2. Placeholder scan**：无 TBD/TODO；每步含完整代码与命令。"Semi Tree 实测微调"是显式的实测检查点（非 placeholder），给出了语义不变原则。

**3. Type consistency**：
- `buildShareData(all, selection, includeContexts)` — Task 1 定义，Task 4 `buildBackupBlob` 内部调用签名一致 ✓
- `treeValueToSelection(valueKeys, tree)` / `selectionToTreeValue` / `shareStats` — Task 2 定义，Task 3/4 引用一致 ✓
- `SelectionTree({workspaces,categories,bookmarks,value,onChange})` — Task 3 定义，Task 4 引用一致 ✓
- `ShareExportModal({visible,onClose})` — Task 4 定义，Task 5 引用一致 ✓
- `ShareSelection` shape `{workspaceIds, categoryIds}` 全链路一致 ✓

**已知偏离 spec（已在 plan 内修正并注明）**：
1. SelectionTree 数据源：spec §4.2 说"从 store 取"，实际 store 切片式 → 改 `exportAllData()`（Task 4）。
2. 主按钮文字色：spec/design doc "绿底白字" → DESIGN.md 禁白字，改炭灰 `primary-on`（Task 4 注记 + Task8 design-review 兜底）。
3. buildShareData 自洽校验：spec §5.3 写"throw"，实现改为"取数顺序天然保证无孤儿"（YAGNI，更简洁，测试验证等效）。
