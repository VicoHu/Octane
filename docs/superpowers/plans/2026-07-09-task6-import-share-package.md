# Task6 导入分享包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接收方选分享包文件 → 预览数量 + 安全提示 + 勾选 → background 单事务合并导入(不覆盖现有)→ 成功;salt 冲突过滤死密文并提示。

**Architecture:** 复用 Task5 的 `buildShareData`(接收方过滤)+ `SelectionTree`(双向勾选)+ `shareStats`(数量)。`applyShareImport` 编排(deisgn doc 步骤5-10):buildShareData→remapShareIds→recomputeRedundancy→resolveNameConflicts→filterEncryptedBySalt→mergeImportRaw→syncContextMeta→broadcast(不 lock)。background 消息 `octane:apply-share-import` 路由。kind UI 双向拒绝(复用 `parseBackupFile` 返回的 kind)。

**Tech Stack:** WXT + React + Semi Design + TypeScript + Vitest 4 + fake-indexeddb + @testing-library/react。

## Global Constraints

- 语言:代码注释/日志/测试 describe·it 标题**强制中文**。
- DESIGN.md token:主按钮炭灰字 `#2D3436`(绿底禁白字,Task8 design-review 兜底,本 Task 用 solid)、focus ring `rgba(0,184,148,.35)`。
- 测试规范(`docs/standards/testing.md`):不 mock Semi(真实渲染);只 mock 副作用边界(fake-indexeddb/`parseBackupFile`/`sendMessage`/`broadcast`);query `getByRole`/`getByText`;`userEvent`;jest-dom;**不再 `vi.mock('lottie-web')`**(全局 alias)。
- 不调 `lock()`(合并不改接收方加密设置,与覆盖导入不同)。
- `applyShareImport` 是事务编排,必须在 background service worker 调用(经 `octane:apply-share-import` 消息),不被 popup 中断。
- pnpm;单测 `pnpm vitest run <file>`,全量 `pnpm run test`,类型 `pnpm run typecheck`。
- 分步提交:每个子任务完成独立 commit。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/services/BackupService.ts` | `applyShareImport(data, selection)` 编排 + `ShareImportResult` 类型 | Modify |
| `src/services/BackupMessaging.ts` | `octane:apply-share-import` 路由 + `ShareImportMessage` + `HandlerResult` 扩展 result | Modify |
| `src/store/useBackup.ts` | `pickFile` 加 kind 防护(拒绝 share 包走覆盖入口) | Modify |
| `src/components/backup/ShareImportModal.tsx` | 接收方预览 + 双向勾选 + 导入 + salt 提示 | Create |
| `src/components/backup/ShareSection.tsx` | 加「导入分享包」按钮 + ShareImportModal | Modify |
| `src/services/__tests__/applyShareImport.test.ts` | 编排单测(fake-indexeddb) | Create |
| `src/services/__tests__/BackupMessaging.test.ts` | 消息路由单测(扩展) | Create/扩展 |
| `src/components/backup/__tests__/ShareImportModal.test.tsx` | Modal UI 集成测试 | Create |

---

## Task 6-1: applyShareImport 编排(service 层 TDD)

**Files:**
- Modify: `src/services/BackupService.ts`
- Test: `src/services/__tests__/applyShareImport.test.ts`

**Interfaces:**
- Consumes: `buildShareData`(BackupService,Task5)、`remapShareIds`/`resolveNameConflicts`/`filterEncryptedBySalt`/`recomputeRedundancy`(shareImport.ts)、`mergeImportRaw`/`getAll`/`getByKey`/`broadcastChange`/`broadcastImport`(database.ts)、`syncContextMeta`(ContextService)
- Produces: `ShareImportResult` 类型 + `applyShareImport(data, selection): Promise<ShareImportResult>`

- [ ] **Step 1: 写失败测试**

Create `src/services/__tests__/applyShareImport.test.ts`:

```typescript
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// broadcast 是跨上下文副作用,测试 mock;syncContextMeta/mergeImportRaw 用真实 fake-indexeddb。
vi.mock('@/shared/db/database', async (importActual) => {
  const actual = await importActual<typeof import('@/shared/db/database')>();
  return { ...actual, broadcastChange: vi.fn(), broadcastImport: vi.fn() };
});

import { getDB, resetDB, putRecord, getAll, getByKey } from '@/shared/db/database';
import { applyShareImport } from '@/services/BackupService';
import * as CryptoService from '@/services/CryptoService';
import type { BackupData, Bookmark, Category, Context, CryptoMetadata, PinnedTab, Workspace } from '@/shared/types';
import { ContextType } from '@/shared/types';

// 发送方分享包样本(全拷贝:含 cryptoMetadata + 加密 context)
const ws: Workspace = { id: 'ws-s', name: '工作', icon: '📁', createdAt: 1, order: 0 };
const cat: Category = { id: 'cat-s', workspaceId: 'ws-s', name: '工具', icon: '📂', order: 0, createdAt: 1 };
const bm: Bookmark = { id: 'bm-s', workspaceId: 'ws-s', categoryId: 'cat-s', name: 'A', url: 'https://a.com', description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: true, createdAt: 1, updatedAt: 1 };
const encCtx: Context = { id: 'ctx-s', bookmarkId: 'bm-s', type: ContextType.NOTE, title: '密钥', content: '', isEncrypted: true, encryptedData: 'CIPHER', iv: 'IV', order: 0, createdAt: 1, updatedAt: 1 };
const senderMeta: CryptoMetadata = { id: 'singleton', salt: 'S1', iterations: 600000, algorithm: 'AES-GCM-256', createdAt: 1 };

const fullPackage: BackupData = {
  workspaces: [ws], categories: [cat], bookmarks: [bm], contexts: [encCtx], pinnedTabs: [], cryptoMetadata: senderMeta,
};

beforeEach(async () => {
  resetDB();
  await getDB();
  vi.clearAllMocks();
});
afterAll(() => { vi.restoreAllMocks(); resetDB(); });

describe('applyShareImport — 分享包合并导入编排', () => {
  it('整选工作区 → 合并落盘,ID 全重映射无残留发送方 ID', async () => {
    const result = await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(result.workspaces).toBe(1);
    // 接收方库有 1 workspace,但其 id ≠ 'ws-s'(重映射)
    const gotWs = await getAll<Workspace>('workspaces');
    expect(gotWs).toHaveLength(1);
    expect(gotWs[0]!.id).not.toBe('ws-s');
    // category/bookmark 的 FK 也重映射,无残留发送方 ID
    const gotCat = await getAll<Category>('categories');
    expect(gotCat[0]!.workspaceId).toBe(gotWs[0]!.id);
    const gotBm = await getAll<Bookmark>('bookmarks');
    expect(gotBm[0]!.categoryId).toBe(gotCat[0]!.id);
    expect(gotBm[0]!.workspaceId).toBe(gotWs[0]!.id);
  });

  it('salt 相同 → 加密 context 入库 + 写入发送方 cryptoMetadata', async () => {
    // 接收方预置相同 salt 的 meta
    await putRecord('cryptoMetadata', { ...senderMeta });
    await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    const gotCtx = await getAll<Context>('contexts');
    expect(gotCtx).toHaveLength(1);
    expect(gotCtx[0]!.isEncrypted).toBe(true); // 加密 context 保留
    expect(gotCtx[0]!.encryptedData).toBe('CIPHER');
  });

  it('salt 不同 → 加密 context 不入库(仅明文) + 不覆盖接收方 cryptoMetadata + skippedEncrypted 计数', async () => {
    // 接收方预置不同 salt
    await putRecord('cryptoMetadata', { ...senderMeta, salt: 'DIFFERENT' });
    const result = await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(result.skippedEncrypted).toBe(1);
    // 加密 context 未入库
    expect(await getAll('contexts')).toHaveLength(0);
    // 接收方 cryptoMetadata 保留(salt 仍 DIFFERENT)
    expect((await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton'))?.salt).toBe('DIFFERENT');
  });

  it('仅结构包(cryptoMetadata null)→ contexts 空,不写 cryptoMetadata', async () => {
    const structurePackage: BackupData = { ...fullPackage, contexts: [], cryptoMetadata: null };
    await applyShareImport(structurePackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(await getAll('contexts')).toHaveLength(0);
    expect(await getByKey('cryptoMetadata', 'singleton')).toBeUndefined();
  });

  it('不调 lock(合并不改接收方加密设置)', async () => {
    const lockSpy = vi.spyOn(CryptoService, 'lock').mockResolvedValue(undefined);
    await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(lockSpy).not.toHaveBeenCalled();
  });

  it('广播 5 表 + broadcastImport', async () => {
    const { broadcastChange, broadcastImport } = await import('@/shared/db/database');
    await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(broadcastChange).toHaveBeenCalledWith('workspaces', 'put');
    expect(broadcastChange).toHaveBeenCalledWith('pinnedTabs', 'put');
    expect(broadcastImport).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/services/__tests__/applyShareImport.test.ts`
Expected: FAIL — `applyShareImport` 未导出。

- [ ] **Step 3: 实现 applyShareImport**

在 `src/services/BackupService.ts` 加(`buildShareData` 之后):

```typescript
/** 分享包导入结果(返回给 UI 显示数量 + salt 冲突提示) */
export interface ShareImportResult {
  workspaces: number;
  categories: number;
  bookmarks: number;
  /** 因接收方 salt 不同被过滤的加密 context 数 */
  skippedEncrypted: number;
}

/**
 * 合并导入分享包(接收方)。单事务 put 不 clear,不覆盖接收方现有数据。
 * 编排(design doc 导入步骤5-10):
 *   buildShareData 过滤(复用,决策 B 对称)→ remapShareIds → recomputeRedundancy →
 *   resolveNameConflicts(读接收方同名)→ filterEncryptedBySalt(读接收方 cryptoMetadata)→
 *   mergeImportRaw 单事务 → syncContextMeta 兜底 → broadcast。
 * 不调 lock()(合并不改接收方加密设置)。
 */
export async function applyShareImport(
  data: BackupData,
  selection: ShareSelection,
): Promise<ShareImportResult> {
  // 1. 识别模式:全拷贝(cryptoMetadata 非空)vs 仅结构
  const senderSalt = data.cryptoMetadata?.salt ?? null;
  const includeContexts = data.cryptoMetadata !== null;
  // 2. 接收方过滤(复用 buildShareData,决策 B 对称)
  const selected = buildShareData(data, selection, includeContexts);
  // 3. ID 重映射(5 Map + 双 FK + pinnedTab 主键)
  const remapped = remapShareIds(selected);
  // 4. 冗余字段预修正(按包内实际 context 数)
  const recomputed: BackupData = {
    ...remapped,
    bookmarks: recomputeRedundancy(remapped.bookmarks, remapped.contexts),
  };
  // 5. 读接收方现有同名(workspace/category)
  const [existingWs, existingCat] = await Promise.all([
    getAll<Workspace>('workspaces'),
    getAll<Category>('categories'),
  ]);
  const existing: ExistingNames = {
    workspaces: new Set(existingWs.map((w) => w.name)),
    categories: new Set(existingCat.map((c) => c.name)),
  };
  // 6. 同名后缀
  const resolved = resolveNameConflicts(recomputed, existing);
  // 7. 读接收方 cryptoMetadata
  const receiverMeta = (await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton')) ?? null;
  // 8. 死密文过滤(salt 冲突)
  const { contexts: filteredContexts, skippedEncrypted } = filterEncryptedBySalt(
    resolved.contexts,
    senderSalt,
    receiverMeta,
  );
  // 9. cryptoMetadata 写入决策:接收方无 / salt 相同 → 写发送方;salt 不同 → 不写(保留接收方)
  const writeMeta =
    !receiverMeta || senderSalt === null || senderSalt === receiverMeta.salt
      ? resolved.cryptoMetadata
      : undefined;
  // 10. 单事务合并(cryptoMetaToWrite 为 null/undefined 时不写)
  await mergeImportRaw({ ...resolved, contexts: filteredContexts }, writeMeta ?? undefined);
  // 11. syncContextMeta 兜底(非致命)
  try {
    for (const b of resolved.bookmarks) {
      await syncContextMeta(b.id);
    }
  } catch (e) {
    console.warn('[octane] 分享导入重算冗余字段部分失败', e);
  }
  // 12. 广播(不 lock)
  broadcastChange('workspaces', 'put');
  broadcastChange('categories', 'put');
  broadcastChange('bookmarks', 'put');
  broadcastChange('contexts', 'put');
  broadcastChange('pinnedTabs', 'put');
  broadcastImport();
  // 13. 返回数量 + 冲突计数
  return {
    workspaces: resolved.workspaces.length,
    categories: resolved.categories.length,
    bookmarks: resolved.bookmarks.length,
    skippedEncrypted,
  };
}
```

import 顶部补:`buildShareData` 已在同文件;加 `remapShareIds, resolveNameConflicts, filterEncryptedBySalt, recomputeRedundancy, type ExistingNames` from `@/services/shareImport`;`mergeImportRaw, getAll, getByKey, broadcastChange, broadcastImport` from `@/shared/db/database`(`getAll/getByKey` 若未 import 则补);`syncContextMeta` 已 import;`ShareSelection, CryptoMetadata, Workspace, Category` 已 import 或补。

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run src/services/__tests__/applyShareImport.test.ts`
Expected: PASS(6 用例)。

- [ ] **Step 5: typecheck + commit**

Run: `pnpm run typecheck` → 无错。

```bash
git add src/services/BackupService.ts src/services/__tests__/applyShareImport.test.ts
git commit -m "feat(share): applyShareImport 合并导入编排(0.1.11.3 第6步-1)"
```

---

## Task 6-2: background 消息 octane:apply-share-import

**Files:**
- Modify: `src/services/BackupMessaging.ts`
- Test: `src/services/__tests__/BackupMessaging.test.ts`(若不存在则 Create)

**Interfaces:**
- Consumes: `applyShareImport`(Task6-1)、`BackupData`/`ShareSelection`
- Produces: `ShareImportMessage` 类型 + `HandlerResult` 扩展 `result?: ShareImportResult`

- [ ] **Step 1: 写失败测试**

Create/扩展 `src/services/__tests__/BackupMessaging.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const applyShareImport = vi.fn(async () => ({ workspaces: 1, categories: 1, bookmarks: 1, skippedEncrypted: 0 }));
const applyImport = vi.fn(async () => undefined);
vi.mock('@/services/BackupService', () => ({ applyImport, applyShareImport }));

import { handleMessage } from '@/services/BackupMessaging';
import type { BackupData, ShareSelection } from '@/shared/types';

const shareData: BackupData = {
  workspaces: [], categories: [], bookmarks: [], contexts: [], pinnedTabs: [], cryptoMetadata: null,
};
const sel: ShareSelection = { workspaceIds: ['ws-1'], categoryIds: [] };

beforeEach(() => { vi.clearAllMocks(); });

describe('BackupMessaging — 分享导入消息路由', () => {
  it('octane:apply-share-import → 调 applyShareImport(data, selection) + 返回 result', async () => {
    const res = await handleMessage({ type: 'octane:apply-share-import', data: shareData, selection: sel });
    expect(applyShareImport).toHaveBeenCalledWith(shareData, sel);
    expect(res).toEqual({ ok: true, result: { workspaces: 1, categories: 1, bookmarks: 1, skippedEncrypted: 0 } });
  });

  it('octane:apply-share-import 异常 → {ok:false, error}', async () => {
    applyShareImport.mockRejectedValueOnce(new Error('事务失败'));
    const res = await handleMessage({ type: 'octane:apply-share-import', data: shareData, selection: sel });
    expect(res).toEqual({ ok: false, error: '事务失败' });
  });

  it('无关 type → undefined', async () => {
    expect(await handleMessage({ type: 'other' })).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/services/__tests__/BackupMessaging.test.ts`
Expected: FAIL — `octane:apply-share-import` 未路由(返回 undefined)。

- [ ] **Step 3: 实现 BackupMessaging 改动**

替换 `src/services/BackupMessaging.ts` 全文:

```typescript
import { applyImport, applyShareImport, type ShareImportResult } from '@/services/BackupService';
import type { BackupData, ShareSelection } from '@/shared/types';

export type ImportMessage = { type: 'octane:apply-import'; data: BackupData };
export type ShareImportMessage = {
  type: 'octane:apply-share-import';
  data: BackupData;
  selection: ShareSelection;
};
export type HandlerResult =
  | { ok: true; result?: ShareImportResult }
  | { ok: false; error: string };

/**
 * background 消息路由。返回 undefined 表示消息与本模块无关(交给其他 listener)。
 * 纯函数(不直接依赖 browser 全局),便于单测;messaging 管道在 background.ts 注册。
 * 两条独立通道:octane:apply-import(覆盖)与 octane:apply-share-import(合并)互不可越界
 * (kind 误入口防护 C2 消息层)。
 */
export async function handleMessage(msg: unknown): Promise<HandlerResult | undefined> {
  if (typeof msg !== 'object' || msg === null) return undefined;
  const m = msg as { type?: unknown };
  if (m.type === 'octane:apply-import') {
    try {
      await applyImport((m as ImportMessage).data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message || '导入失败' };
    }
  }
  if (m.type === 'octane:apply-share-import') {
    try {
      const result = await applyShareImport((m as ShareImportMessage).data, (m as ShareImportMessage).selection);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: (e as Error).message || '导入失败' };
    }
  }
  return undefined;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run src/services/__tests__/BackupMessaging.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + commit**

Run: `pnpm run typecheck` → 无错。

```bash
git add src/services/BackupMessaging.ts src/services/__tests__/BackupMessaging.test.ts
git commit -m "feat(share): octane:apply-share-import background 消息路由(0.1.11.3 第6步-2)"
```

---

## Task 6-3: useBackup.pickFile kind 防护(备份入口拒绝 share 包)

**Files:**
- Modify: `src/store/useBackup.ts:31-39`(pickFile)
- Test: `src/store/__tests__/useBackup.test.ts`(若不存在则 Create,或扩展现有)

**Interfaces:**
- Consumes: `parseBackupFile` 返回 `kind`(Task2)
- Produces: pickFile 拒绝 kind='share'

- [ ] **Step 1: 写失败测试**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseBackupFile = vi.fn();
vi.mock('@/services/BackupService', () => ({ parseBackupFile, buildBackupBlob: vi.fn() }));

import { useBackup } from '@/store/useBackup';

beforeEach(() => { useBackup.getState().reset(); vi.clearAllMocks(); });

describe('useBackup.pickFile — kind 防护', () => {
  it('kind=share → error「请使用分享导入入口」,不进 confirming', async () => {
    parseBackupFile.mockResolvedValue({ ok: true, data: {}, kind: 'share' });
    await useBackup.getState().pickFile(new File(['{}'], 's.json'));
    const s = useBackup.getState();
    expect(s.status).toBe('error');
    expect(s.errorMessage).toMatch(/分享包|分享导入/);
    expect(s.pendingData).toBeNull();
  });

  it('kind=backup → 正常进 confirming', async () => {
    parseBackupFile.mockResolvedValue({ ok: true, data: { workspaces: [] }, kind: 'backup' });
    await useBackup.getState().pickFile(new File(['{}'], 'b.json'));
    expect(useBackup.getState().status).toBe('confirming');
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/store/__tests__/useBackup.test.ts`
Expected: FAIL — pickFile 未检查 kind。

- [ ] **Step 3: 实现 pickFile kind 检查**

改 `src/store/useBackup.ts` 的 `pickFile`(约 :31):

```typescript
  pickFile: async (file) => {
    set({ status: 'validating', errorMessage: null });
    const r = await parseBackupFile(file);
    if (r.ok) {
      // kind 防护(C2):备份入口只接受 backup/share 缺失(覆盖恢复);分享包走分享导入入口
      if (r.kind === 'share') {
        set({ status: 'error', errorMessage: '此为分享包,请使用分享导入入口', pendingData: null });
        return;
      }
      set({ status: 'confirming', pendingData: r.data, errorMessage: null });
    } else {
      set({ status: 'error', errorMessage: r.error, pendingData: null });
    }
  },
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run src/store/__tests__/useBackup.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + commit**

Run: `pnpm run typecheck` → 无错。

```bash
git add src/store/useBackup.ts src/store/__tests__/useBackup.test.ts
git commit -m "feat(share): pickFile kind 防护—备份入口拒绝 share 包(0.1.11.3 第6步-3)"
```

---

## Task 6-4: ShareImportModal(接收方预览 + 勾选 + 导入)

**Files:**
- Create: `src/components/backup/ShareImportModal.tsx`
- Test: `src/components/backup/__tests__/ShareImportModal.test.tsx`

**Interfaces:**
- Consumes: `SelectionTree`(Task5)、`shareStats`(Task5)、`parseBackupFile`(返回 kind)、`browser.runtime.sendMessage`(octane:apply-share-import)、Semi `Modal`/`Button`/`Banner`/`Spin`/`Typography`
- Produces: `ShareImportModal({ visible, onClose })`

- [ ] **Step 1: 写失败测试**

Create `src/components/backup/__tests__/ShareImportModal.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const shareData = {
  workspaces: [{ id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 }],
  categories: [{ id: 'cat-1', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 }],
  bookmarks: [{ id: 'bm-1', workspaceId: 'ws-1', categoryId: 'cat-1', name: 'A', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 }],
  contexts: [], pinnedTabs: [], cryptoMetadata: null,
};
const parseBackupFile = vi.fn();
const sendMessage = vi.fn();
vi.mock('@/services/BackupService', () => ({ parseBackupFile }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));

beforeEach(() => { vi.clearAllMocks(); });

import { ShareImportModal } from '@/components/backup/ShareImportModal';

describe('ShareImportModal — 接收方导入预览', () => {
  it('选 share 文件 → 预览数量徽章 + 安全提示「不覆盖」', async () => {
    parseBackupFile.mockResolvedValue({ ok: true, data: shareData, kind: 'share' });
    const user = userEvent.setup();
    render(<ShareImportModal visible={true} onClose={() => {}} />);
    // 选文件(input type=file)
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({})], 'share.json'));
    await waitFor(() => expect(screen.getByText(/不覆盖/)).toBeInTheDocument());
    expect(screen.getByText(/工作/)).toBeInTheDocument();
  });

  it('选 backup 文件 → 拒绝提示「请使用备份恢复」', async () => {
    parseBackupFile.mockResolvedValue({ ok: true, data: shareData, kind: 'backup' });
    const user = userEvent.setup();
    render(<ShareImportModal visible={true} onClose={() => {}} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({})], 'b.json'));
    expect(await screen.findByText(/备份恢复|会覆盖/)).toBeInTheDocument();
  });

  it('勾选 + 导入 → sendMessage(octane:apply-share-import) + success 含数量', async () => {
    parseBackupFile.mockResolvedValue({ ok: true, data: shareData, kind: 'share' });
    sendMessage.mockResolvedValue({ ok: true, result: { workspaces: 1, categories: 1, bookmarks: 1, skippedEncrypted: 0 } });
    const user = userEvent.setup();
    render(<ShareImportModal visible={true} onClose={() => {}} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({})], 'share.json'));
    await waitFor(() => expect(screen.getByText(/工作/)).toBeInTheDocument());
    // 勾工作区
    await user.click(screen.getAllByRole('checkbox')[0]!);
    // 点合并导入
    await user.click(screen.getByRole('button', { name: /合并导入/ }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'octane:apply-share-import' }));
    expect(await screen.findByText(/已导入/)).toBeInTheDocument();
  });

  it('salt 冲突(skippedEncrypted>0)→ 提示「X 条加密笔记未导入」', async () => {
    parseBackupFile.mockResolvedValue({ ok: true, data: shareData, kind: 'share' });
    sendMessage.mockResolvedValue({ ok: true, result: { workspaces: 1, categories: 1, bookmarks: 1, skippedEncrypted: 2 } });
    const user = userEvent.setup();
    render(<ShareImportModal visible={true} onClose={() => {}} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({})], 'share.json'));
    await waitFor(() => expect(screen.getByText(/工作/)).toBeInTheDocument());
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getByRole('button', { name: /合并导入/ }));
    expect(await screen.findByText(/2 条加密笔记/)).toBeInTheDocument();
  });
});
```

> 注:`userEvent.upload` 触发 input onChange。若 query `input[type=file]` 用 `querySelector` 是合法的(Testing Library 无 file upload 专用 query,且这是真实 DOM input 非 mock 桩);若 ESLint `no-node-access` 报警,加注释说明或用 `screen.getByLabelText`+`aria-label`。

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/components/backup/__tests__/ShareImportModal.test.tsx`
Expected: FAIL — 组件不存在。

- [ ] **Step 3: 实现 ShareImportModal**

Create `src/components/backup/ShareImportModal.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Modal, Button, Banner, Spin, Typography } from '@douyinfe/semi-ui';
import { parseBackupFile, type ShareImportResult } from '@/services/BackupService';
import { SelectionTree } from './SelectionTree';
import { shareStats } from './shareSelection';
import type { BackupData, ShareSelection } from '@/shared/types';

interface ShareImportModalProps {
  visible: boolean;
  onClose: () => void;
}

type Status = 'idle' | 'parsing' | 'previewing' | 'importing' | 'success' | 'error';

/**
 * 接收方导入分享包 Modal:选文件 → 预览(数量+安全提示)→ 勾选 → background 合并导入。
 * 复用 SelectionTree(双向勾选)+ shareStats(数量)。local state(Task7 接 useShare)。
 */
export function ShareImportModal({ visible, onClose }: ShareImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<BackupData | null>(null);
  const [selection, setSelection] = useState<ShareSelection>({ workspaceIds: [], categoryIds: [] });
  const [result, setResult] = useState<ShareImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = () => {
    setStatus('idle'); setData(null); setSelection({ workspaceIds: [], categoryIds: [] });
    setResult(null); setErrorMessage(null);
  };

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    reset();
    setStatus('parsing');
    const r = await parseBackupFile(f);
    if (!r.ok) { setStatus('error'); setErrorMessage(r.error); return; }
    // kind 防护:分享入口只接受 share
    if (r.kind !== 'share') {
      setStatus('error');
      setErrorMessage('此为全量备份,会覆盖现有数据,请使用备份恢复入口');
      return;
    }
    setData(r.data);
    setStatus('previewing');
    e.target.value = '';
  };

  const handleImport = async () => {
    if (!data) return;
    setStatus('importing');
    try {
      const res = await browser.runtime.sendMessage({
        type: 'octane:apply-share-import',
        data,
        selection,
      });
      if (res && res.ok) {
        setResult(res.result ?? null);
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage((res?.error as string) || '导入失败');
      }
    } catch (e) {
      setStatus('error');
      setErrorMessage((e as Error).message || '导入失败');
    }
  };

  const stats = data ? shareStats(data.workspaces, data.categories, data.bookmarks, selection) : { ws: 0, cat: 0, bm: 0 };

  return (
    <Modal
      title="导入分享包"
      visible={visible}
      onCancel={() => { reset(); onClose(); }}
      maskClosable={false}
      width={560}
      footer={
        status === 'success' ? (
          <Button onClick={() => { reset(); onClose(); }}>关闭</Button>
        ) : status === 'previewing' ? (
          <>
            <Button onClick={() => { reset(); onClose(); }}>取消</Button>
            <Button
              theme="solid"
              loading={false}
              disabled={stats.ws === 0 && stats.cat === 0}
              onClick={handleImport}
            >
              合并导入{stats.ws > 0 ? ` ${stats.ws} 个工作区` : ''}
            </Button>
          </>
        ) : (
          <Button onClick={() => { reset(); onClose(); }}>关闭</Button>
        )
      }
    >
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handlePick} />

      {status === 'idle' && (
        <Button onClick={() => fileRef.current?.click()}>选择分享包文件</Button>
      )}
      {status === 'parsing' && <Spin />}
      {status === 'error' && errorMessage && (
        <Typography.Text type="danger" role="alert">{errorMessage}</Typography.Text>
      )}
      {status === 'previewing' && data && (
        <>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            来自分享 · 合并到你的库,<strong>不覆盖</strong>现有数据。
          </Typography.Text>
          {data.cryptoMetadata && (
            <Banner type="warning" description="此分享包含加密笔记,需与发送方相同主密码才能查看。" style={{ marginBottom: 8 }} />
          )}
          {data.workspaces.length === 0 ? (
            <Typography.Text type="tertiary">这个分享包是空的</Typography.Text>
          ) : (
            <SelectionTree
              workspaces={data.workspaces}
              categories={data.categories}
              bookmarks={data.bookmarks}
              value={selection}
              onChange={setSelection}
            />
          )}
        </>
      )}
      {status === 'success' && result && (
        <>
          <Typography.Text>
            ✓ 已导入 {result.workspaces} 个工作区 · {result.categories} 个分类 · {result.bookmarks} 个书签
          </Typography.Text>
          {result.skippedEncrypted > 0 && (
            <Banner type="warning" style={{ marginTop: 8 }}
              description={`${result.skippedEncrypted} 条加密笔记因本机加密设置不同未导入`} />
          )}
        </>
      )}
    </Modal>
  );
}
```

> import 顶部:`ShareImportResult` 从 BackupService 导出(Task6-1 已加)。`browser` 全局由 WXT auto-inject(wxt/browser);测试 mock `wxt/browser`。注意 footer 按 status 切换(取消+合并导入 / 关闭)——与 ShareExportModal 修复后的 footer 模式一致。

- [ ] **Step 4: 跑测试验证通过(必要时按 Semi Tree 实测微调交互)**

Run: `pnpm vitest run src/components/backup/__tests__/ShareImportModal.test.tsx`
Expected: PASS。若 `userEvent.upload` 或 `querySelector('input[type=file]')` 在 jsdom 不符,按 Task5 经验调整(aria-label + getByLabelText,或注释说明 querySelector 合法性)。Semi Tree 勾选落点用 `getAllByRole('checkbox')[0]`(Task5 实测有效)。

- [ ] **Step 5: typecheck + commit**

Run: `pnpm run typecheck` → 无错。

```bash
git add src/components/backup/ShareImportModal.tsx src/components/backup/__tests__/ShareImportModal.test.tsx
git commit -m "feat(share): ShareImportModal 接收方预览+勾选+合并导入(0.1.11.3 第6步-4)"
```

---

## Task 6-5: ShareSection 加导入入口

**Files:**
- Modify: `src/components/backup/ShareSection.tsx`

**Interfaces:**
- Consumes: `ShareImportModal`(Task6-4)
- Produces: ShareSection 加「导入分享包」按钮

> 薄封装改动,靠 ShareImportModal 测试 + 全量回归覆盖,不写独立单测。

- [ ] **Step 1: 改 ShareSection**

替换 `src/components/backup/ShareSection.tsx`:

```tsx
import { useState } from 'react';
import { Button, Banner } from '@douyinfe/semi-ui';
import { ShareExportModal } from './ShareExportModal';
import { ShareImportModal } from './ShareImportModal';

/**
 * 分享导出/导入入口区块:backup tab 内与 LocalBackupSection 并列。
 * 「导出分享包」→ ShareExportModal;「导入分享包」→ ShareImportModal。
 */
export function ShareSection() {
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  return (
    <div style={{ marginTop: 24 }}>
      <Banner
        type="info"
        description="把部分工作区或分类打包成分享包发给同事,对方导入即合并到他的库,不影响现有数据。"
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button theme="solid" onClick={() => setExportOpen(true)}>导出分享包</Button>
        <Button onClick={() => setImportOpen(true)}>导入分享包</Button>
      </div>
      <ShareExportModal visible={exportOpen} onClose={() => setExportOpen(false)} />
      <ShareImportModal visible={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 2: 全量 typecheck + test 双绿**

Run: `pnpm run typecheck` → 无错。
Run: `pnpm run test` → 全绿。

- [ ] **Step 3: commit**

```bash
git add src/components/backup/ShareSection.tsx
git commit -m "feat(share): ShareSection 加导入分享包入口(0.1.11.3 第6步-5)"
```

---

## Task 6-6: 全量双绿 + 真机验证

- [ ] **Step 1: 全量回归确认**

Run: `pnpm run typecheck && pnpm run test`
Expected: 全绿(含 Task6-1~6-5 新测试 + 灾备网 + Task5 全部)。

- [ ] **Step 2: 真机 e2e(手动,design doc Task6 收尾)**

`pnpm dev` → home 设置 → 数据备份和同步 → 点「导入分享包」→ 选 Task5 导出的 `octane-share-*.json`:
- 预览数量徽章 + 「不覆盖」提示。
- 勾工作区 → 合并导入 → ✓ 成功 → 接收方库新增(不覆盖现有)。
- 不勾上下文导出的包 → 接收方无加密笔记;勾上下文 + 相同密码 → 加密笔记可解密;不同密码 → 提示「X 条未导入」。
- kind 防护:备份包走分享入口 → 拒绝提示;分享包走备份入口(LocalBackupSection)→ 拒绝。

- [ ] **Step 3: 视觉 QA 记下,留 Task8 /design-review**

主按钮炭灰字、focus ring、Modal footer 布局、Banner 排版。

---

## Self-Review

**1. Spec coverage**(对照 Task6 spec SC1-SC8):
- SC1(预览数量+安全提示)→ Task6-4 ✓
- SC2(勾选+自洽补全)→ buildShareData 复用(决策 B)→ Task6-1/6-4 ✓
- SC3(ID 重映射无残留)→ Task6-1 测试断言 FK 重映射 ✓
- SC4(salt 冲突过滤+不覆盖 meta+提示)→ Task6-1 测试 + Task6-4 提示 ✓
- SC5(kind 双向拒绝)→ Task6-3(pickFile)+ Task6-4(Modal kind 检查)✓
- SC6(单事务不 lock)→ Task6-1 不调 lock 测试 ✓
- SC7(loading+success 不用 Toast)→ Task6-4 footer + success 文案 ✓
- SC8(双绿)→ Task6-6 ✓

**2. Placeholder**:无 TBD;每步含完整代码与命令。Semi Tree/input upload 实测微调是显式检查点。

**3. Type consistency**:
- `applyShareImport(data, selection): Promise<ShareImportResult>` — Task6-1 定义,Task6-2 BackupMessaging 调用、Task6-4 sendMessage result 一致 ✓
- `ShareImportResult {workspaces,categories,bookmarks,skippedEncrypted}` — 全链路一致 ✓
- `ShareImportMessage {type,data,selection}` — Task6-2 定义,Task6-4 sendMessage 一致 ✓
- `HandlerResult` 扩展 `result?: ShareImportResult` — 不破坏 apply-import(返回 {ok:true} 无 result)✓

**已知风险点(实现时注意)**:
- `applyShareImport` 测试 mock `@/shared/db/database` 的 broadcastChange/broadcastImport,但保留 mergeImportRaw/getAll/getByKey 真实(用 `importActual` spread)。若 mock 方式导致 mergeImportRaw 也被 mock,测试落盘验证失效——确认 spread 正确。
- `pickFile` kind 检查:`r.kind` 在 ValidationResult ok 分支存在(Task2 已返回 kind)。确认 type narrowed。
- ShareImportModal 的 `browser.runtime.sendMessage` — WXT auto-inject `browser`;测试 mock `wxt/browser`。确认 `browser` 全局在组件可用(import `browser` from 'wxt/browser' 或全局)。
- buildShareData 复用接收方过滤:includeContexts = (data.cryptoMetadata !== null)。仅结构包 contexts 本就 [],buildShareData includeContexts=false 仍 [];全拷贝包 includeContexts=true 按 selection 过滤 contexts。一致。
