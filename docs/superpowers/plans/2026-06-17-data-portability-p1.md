# P1 本地导入导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 octane 增加本地全量数据导入导出（覆盖式），让用户能备份与迁移全部书签/上下文（含加密数据密文迁移）。

**Architecture:** 数据层（`database.ts`）新增 `exportAllData` / `replaceAllDataRaw` / 广播函数；业务层（`BackupService.ts`）做校验、文件解析、导入编排（覆盖事务 + 冗余字段重算 + lock + 广播）；导入事务在 background service worker 执行（popup 瞬态），popup 经 WXT messaging 触发；UI 扩展现有占位 `SettingsView`，破坏性导入走强确认 Modal。

**Tech Stack:** WXT 0.20 + React 19 + @douyinfe/semi-ui + Zustand 5 + TypeScript + Vitest 4 + idb 8 + fake-indexeddb 6。

## Global Constraints

- 语言：所有代码注释、日志、测试描述、commit message 强制中文。
- 加密数据迁移：导出 contexts 必须用底层 `getAll('contexts')`（存储态，含密文），**禁止用会解密的 `getContexts`**。
- 导入执行宿主：覆盖事务必须在 background service worker 执行；popup 只负责选文件 + 确认。
- 导入后必须：(a) 对受影响 bookmark 调 `syncContextMeta` 重算冗余字段；(b) `lock()` 清 session 旧密钥；(c) 显式广播（newtab 不订阅 store 广播，需独立 `octane-import` channel）。
- 覆盖语义：4 张数据表 clear 后 put；`cryptoMetadata` 仅在备份包含时 put（不含则保留本机原值）。
- 备份格式：`schema='octane-backup'`、`version=1`（仅接受 1）、文件大小阈值 50MB。
- TDD：每个 task 先写失败测试，再实现，frequent commits。测试用 `fake-indexeddb/auto` + `resetDB()` 范式（见 `tests/db/database.test.ts`）。
- 外科手术：不重构无关代码，遵循现有风格。

---

## File Structure

**新建：**
- `src/services/BackupService.ts` — 校验 / 文件解析 / 导入编排（纯业务，可测）
- `src/store/useBackup.ts` — Zustand 状态机（popup 侧）
- `src/entrypoints/popup/views/backup/LocalBackupSection.tsx` — 本地备份区 UI（导出/导入/确认）
- `src/entrypoints/background.handlers.ts` — messaging 路由纯函数（从 background.ts 抽出便于测试）
- `src/services/__tests__/BackupService.test.ts` — 校验/解析单测
- `tests/services/backup-import.test.ts` — 导入编排集成测（fake-indexeddb）
- `tests/db/export-import.test.ts` — 数据层导出/覆盖事务测（fake-indexeddb）
- `src/entrypoints/background.handlers.test.ts` — messaging 路由测
- `src/store/__tests__/useBackup.test.ts` — 状态机测
- `src/entrypoints/popup/views/backup/__tests__/LocalBackupSection.test.tsx` — UI 测
- `tests/newtab/import-reload.test.ts` — newtab 订阅 reload 测

**修改：**
- `src/shared/types/index.ts` — 加 `BACKUP_SCHEMA` / `BACKUP_VERSION` / `BackupData` / `BackupFile`
- `src/shared/db/database.ts` — 加 `exportAllData` / `replaceAllDataRaw` / 导出 `broadcastChange` / 加 `broadcastImport` + `IMPORT_CHANNEL_NAME`
- `src/entrypoints/background.ts` — 注册 onMessage 调 `handleMessage`
- `src/entrypoints/newtab/App.tsx` — 订阅 `octane-import` channel 触发 reload
- `src/entrypoints/popup/views/SettingsView.tsx` — 替换占位，组合 `LocalBackupSection`
- `src/entrypoints/popup/popup.module.css` — 加少量备份区样式 class

---

## Task 1: 备份类型常量 + validateBackup 校验

**Files:**
- Modify: `src/shared/types/index.ts`（末尾追加）
- Create: `src/services/BackupService.ts`
- Test: `src/services/__tests__/BackupService.test.ts`

**Interfaces:**
- Produces: `BackupData`、`BackupFile` 类型；`validateBackup(parsed: unknown) => ValidationResult`，其中 `ValidationResult = { ok: true; data: BackupData } | { ok: false; error: string }`。

- [ ] **Step 1: 在 types/index.ts 末尾追加类型与常量**

```ts
/** 备份文件 schema 标识 */
export const BACKUP_SCHEMA = 'octane-backup';
/** 备份格式版本（schema 变更时递增；校验仅接受已知版本） */
export const BACKUP_VERSION = 1;

/** 备份数据载荷：5 表存储态（contexts 含密文，不解密） */
export interface BackupData {
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
  contexts: Context[];
  cryptoMetadata: CryptoMetadata | null;
}

/** 备份文件顶层结构 */
export interface BackupFile {
  schema: typeof BACKUP_SCHEMA;
  version: number;
  exportedAt: number;
  appVersion: string;
  data: BackupData;
}
```

- [ ] **Step 2: 写失败测试 `src/services/__tests__/BackupService.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { validateBackup } from '@/services/BackupService';
import { BACKUP_SCHEMA, BACKUP_VERSION } from '@/shared/types';
import type { BackupFile, BackupData } from '@/shared/types';

function makeFile(dataOver: Partial<BackupData> = {}, fileOver: Partial<BackupFile> = {}): BackupFile {
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: 1000,
    appVersion: '0.1.3.4',
    data: { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null, ...dataOver },
    ...fileOver,
  };
}

describe('validateBackup', () => {
  it('合法空备份 → ok', () => {
    const r = validateBackup(makeFile());
    expect(r.ok).toBe(true);
  });

  it('非对象输入 → 拒绝', () => {
    expect(validateBackup('x').ok).toBe(false);
    expect(validateBackup(null).ok).toBe(false);
  });

  it('schema 不符 → 拒绝', () => {
    expect(validateBackup(makeFile({}, { schema: 'other' as never })).ok).toBe(false);
  });

  it('version=2（未知）→ 拒绝', () => {
    expect(validateBackup(makeFile({}, { version: 2 })).ok).toBe(false);
  });

  it('data 缺失 → 拒绝', () => {
    const bad = { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, exportedAt: 1, appVersion: 'x' };
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('bookmarks 非数组 → 拒绝', () => {
    expect(validateBackup(makeFile({ bookmarks: 'x' as never })).ok).toBe(false);
  });

  it('bookmark 缺 categoryId → 拒绝', () => {
    const bad = makeFile({ bookmarks: [{ id: 'b', workspaceId: 'w' } as never] });
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('context 缺 bookmarkId → 拒绝', () => {
    const bad = makeFile({ contexts: [{ id: 'c' } as never] });
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('含加密 context 但无 cryptoMetadata → 拒绝', () => {
    const bad = makeFile({
      contexts: [{ id: 'c', bookmarkId: 'b', isEncrypted: true, encryptedData: 'x', iv: 'y' } as never],
      cryptoMetadata: null,
    });
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('含加密 context 且有 cryptoMetadata → ok', () => {
    const ok = makeFile({
      contexts: [{ id: 'c', bookmarkId: 'b', isEncrypted: true, encryptedData: 'x', iv: 'y' } as never],
      cryptoMetadata: { id: 'singleton', salt: 's', iterations: 1, algorithm: 'AES-GCM-256', createdAt: 1 },
    });
    expect(validateBackup(ok).ok).toBe(true);
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run src/services/__tests__/BackupService.test.ts`
Expected: FAIL（`validateBackup` 未定义 / 模块不存在）

- [ ] **Step 4: 实现 `src/services/BackupService.ts`**

```ts
import {
  BACKUP_SCHEMA,
  BACKUP_VERSION,
} from '@/shared/types';
import type { BackupData, Bookmark, Category, Context, CryptoMetadata, Workspace } from '@/shared/types';

export type ValidationResult =
  | { ok: true; data: BackupData }
  | { ok: false; error: string };

const DATA_TABLES = ['workspaces', 'categories', 'bookmarks', 'contexts'] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function hasString(v: unknown, ...keys: string[]): boolean {
  return isObj(v) && keys.every((k) => typeof v[k] === 'string');
}

/**
 * 校验已解析的备份对象（不读文件、不碰 DB）。
 * 返回 ok 时 data 为规范化后的 BackupData。
 */
export function validateBackup(parsed: unknown): ValidationResult {
  if (!isObj(parsed)) return { ok: false, error: '备份文件格式无效' };
  if (parsed.schema !== BACKUP_SCHEMA) return { ok: false, error: '不是 octane 备份文件' };
  if (parsed.version !== BACKUP_VERSION) return { ok: false, error: '备份版本不受支持，请升级 octane' };

  const data = parsed.data;
  if (!isObj(data)) return { ok: false, error: '备份数据缺失' };
  for (const t of DATA_TABLES) {
    if (!Array.isArray(data[t])) return { ok: false, error: `备份数据表 ${t} 缺失或非数组` };
  }

  for (const b of data.bookmarks as unknown[]) {
    if (!hasString(b, 'id', 'workspaceId', 'categoryId')) {
      return { ok: false, error: '书签数据缺少必需字段（id/workspaceId/categoryId）' };
    }
  }
  for (const c of data.contexts as unknown[]) {
    if (!hasString(c, 'id', 'bookmarkId')) {
      return { ok: false, error: '上下文数据缺少必需字段（id/bookmarkId）' };
    }
  }

  const contexts = data.contexts as Array<{ isEncrypted?: boolean }>;
  const hasEncrypted = contexts.some((c) => c.isEncrypted === true);
  const meta = data.cryptoMetadata;
  if (hasEncrypted && meta == null) {
    return { ok: false, error: '备份含加密数据但缺少加密元数据，无法恢复' };
  }

  const backupData: BackupData = {
    workspaces: data.workspaces as Workspace[],
    categories: data.categories as Category[],
    bookmarks: data.bookmarks as Bookmark[],
    contexts: data.contexts as Context[],
    cryptoMetadata: (meta ?? null) as CryptoMetadata | null,
  };
  return { ok: true, data: backupData };
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run src/services/__tests__/BackupService.test.ts`
Expected: PASS（10 passed）

- [ ] **Step 6: 提交**

```bash
git add src/shared/types/index.ts src/services/BackupService.ts src/services/__tests__/BackupService.test.ts
git commit -m "feat(backup): validateBackup 备份校验 + 类型常量"
```

---

## Task 2: parseBackupFile 文件读取与大小校验

**Files:**
- Modify: `src/services/BackupService.ts`（加 `parseBackupFile` + `MAX_BACKUP_BYTES`）
- Test: `src/services/__tests__/BackupService.test.ts`（追加）

**Interfaces:**
- Consumes: `validateBackup`（Task 1）
- Produces: `parseBackupFile(file: File) => Promise<ValidationResult>`；`MAX_BACKUP_BYTES`（50MB）

- [ ] **Step 1: 追加失败测试**

在 `BackupService.test.ts` 末尾追加：

```ts
import { parseBackupFile, MAX_BACKUP_BYTES } from '@/services/BackupService';

describe('parseBackupFile', () => {
  it('合法文件 → ok 且 data 正确', async () => {
    const payload = JSON.stringify(makeFile({ workspaces: [{ id: 'w', name: 'n', icon: 'i', createdAt: 1, order: 0 }] }));
    const file = new File([payload], 'b.json', { type: 'application/json' });
    const r = await parseBackupFile(file);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.workspaces).toHaveLength(1);
  });

  it('超 50MB → 拒绝（不解析）', async () => {
    const huge = new File([new Uint8Array(MAX_BACKUP_BYTES + 1)], 'huge.json');
    const r = await parseBackupFile(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/过大|50/);
  });

  it('非 JSON → 拒绝', async () => {
    const file = new File(['{不是json'], 'bad.json', { type: 'application/json' });
    const r = await parseBackupFile(file);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/services/__tests__/BackupService.test.ts`
Expected: FAIL（`parseBackupFile` 未导出）

- [ ] **Step 3: 在 BackupService.ts 追加实现**

```ts
/** 备份文件大小上限：50MB（防止 JSON.parse 卡死/内存溢出） */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/**
 * 读取文件 + 大小校验 + JSON 解析 + 结构校验。
 * 单一返回类型，与 validateBackup 一致。
 */
export async function parseBackupFile(file: File): Promise<ValidationResult> {
  if (file.size > MAX_BACKUP_BYTES) {
    return { ok: false, error: `备份文件过大（超过 50MB），已拒绝` };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: '备份文件读取失败' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '备份文件不是合法 JSON' };
  }
  return validateBackup(parsed);
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run src/services/__tests__/BackupService.test.ts`
Expected: PASS（13 passed）

- [ ] **Step 5: 提交**

```bash
git add src/services/BackupService.ts src/services/__tests__/BackupService.test.ts
git commit -m "feat(backup): parseBackupFile 文件读取与大小校验"
```

---

## Task 3: 数据层 exportAllData / replaceAllDataRaw / 广播

**Files:**
- Modify: `src/shared/db/database.ts`
- Test: `tests/db/export-import.test.ts`

**Interfaces:**
- Consumes: `BackupData`（Task 1 类型）、`getAll`/`getByKey`/`getDB`（已有）
- Produces: `exportAllData(): Promise<BackupData>`；`replaceAllDataRaw(data: BackupData): Promise<void>`（单事务覆盖，4 表 clear+put，cryptoMetadata 条件 put；**不重算/不 lock/不广播**，留给业务层）；`broadcastChange(store, action)`（导出已有私有 broadcast）；`broadcastImport()`；`IMPORT_CHANNEL_NAME` 常量。

- [ ] **Step 1: 修改 database.ts — 导出 broadcast、加 IMPORT channel、加 export/replace**

在 `database.ts` 现有 `broadcast` 函数下方改为导出，并新增 import channel 与两个数据函数。找到现有私有函数：

```ts
/** 广播数据变更。无原生 BroadcastChannel 时静默跳过。 */
function broadcast(store: StoreName, action: 'put' | 'delete'): void {
  dbChannel?.postMessage({ store, action } satisfies DbChangeEvent);
}
```

替换为：

```ts
/** 广播数据变更。无原生 BroadcastChannel 时静默跳过。 */
function broadcast(store: StoreName, action: 'put' | 'delete'): void {
  dbChannel?.postMessage({ store, action } satisfies DbChangeEvent);
}

/** 公开包装：供导入等外部流程显式触发 store 变更广播（side panel 刷新）。 */
export function broadcastChange(store: StoreName, action: 'put' | 'delete'): void {
  broadcast(store, action);
}

/** 全量导入广播 channel 名（独立于 store 级广播，供 newtab 整体 reload）。 */
export const IMPORT_CHANNEL_NAME = 'octane-import';
const importChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(IMPORT_CHANNEL_NAME) : null;

/** 广播「全量导入完成」事件。newtab 订阅后整体 reload。 */
export function broadcastImport(): void {
  importChannel?.postMessage({ type: 'imported' });
}
```

在文件末尾（`export type { OctaneDB, StoreName };` 之前）追加数据函数：

```ts
// ========== 全量导出 / 覆盖导入 ==========

const DATA_STORES = ['workspaces', 'categories', 'bookmarks', 'contexts'] as const;
const ALL_STORES = [...DATA_STORES, 'cryptoMetadata'] as const;

/**
 * 导出全部数据（5 表存储态）。
 * contexts 取底层 getAll（含密文，不解密）——禁止用会解密的 ContextService.getContexts。
 */
export async function exportAllData(): Promise<BackupData> {
  return {
    workspaces: await getAll<Workspace>('workspaces'),
    categories: await getAll<Category>('categories'),
    bookmarks: await getAll<Bookmark>('bookmarks'),
    contexts: await getAll<Context>('contexts'),
    cryptoMetadata: (await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton')) ?? null,
  };
}

/**
 * 覆盖式写入：单 readwrite 事务，4 数据表 clear 后 put，cryptoMetadata 仅在 data 含时 put。
 * 仅做数据搬运 —— 不重算冗余字段、不 lock、不广播（由业务层 BackupService.applyImport 编排）。
 * 任一步失败事务整体回滚。
 */
export async function replaceAllDataRaw(data: BackupData): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([...ALL_STORES], 'readwrite');
  for (const s of DATA_STORES) {
    await tx.objectStore(s).clear();
  }
  for (const ws of data.workspaces) await tx.objectStore('workspaces').put(ws);
  for (const c of data.categories) await tx.objectStore('categories').put(c);
  for (const b of data.bookmarks) await tx.objectStore('bookmarks').put(b);
  for (const ctx of data.contexts) await tx.objectStore('contexts').put(ctx);
  if (data.cryptoMetadata) {
    await tx.objectStore('cryptoMetadata').put(data.cryptoMetadata);
  }
  await tx.done;
}
```

在 database.ts 顶部 import 区追加类型（若尚未 import）：

```ts
import type {
  BackupData,
  Bookmark,
  Category,
  Context,
  CryptoMetadata,
  Workspace,
} from '@/shared/types';
```

- [ ] **Step 2: 写失败测试 `tests/db/export-import.test.ts`**

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getDB,
  resetDB,
  putRecord,
  getAll,
  getByKey,
  exportAllData,
  replaceAllDataRaw,
  IMPORT_CHANNEL_NAME,
  broadcastImport,
} from '@/shared/db/database';
import type { BackupData, Bookmark, Context, Workspace, Category, CryptoMetadata } from '@/shared/types';
import { ContextType, DB_NAME } from '@/shared/types';

async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const names = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) await tx.objectStore(n).clear();
  await tx.done;
}

beforeEach(async () => {
  resetDB();
  await getDB();
  await clearAllStores();
});
afterAll(() => resetDB());

const ws: Workspace = { id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 };
const cat: Category = { id: 'cat-1', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 };
const bm: Bookmark = {
  id: 'bm-1', workspaceId: 'ws-1', categoryId: 'cat-1', name: 'n', url: 'https://x.com',
  description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: false, createdAt: 1, updatedAt: 1,
};
// 加密 context：存储态 content='' + 密文（不解密）
const encCtx: Context = {
  id: 'ctx-1', bookmarkId: 'bm-1', type: ContextType.NOTE, title: 't', content: '',
  isEncrypted: true, encryptedData: 'BASE64_CIPHER', iv: 'BASE64_IV', order: 0, createdAt: 1, updatedAt: 1,
};
const meta: CryptoMetadata = { id: 'singleton', salt: 'S', iterations: 600000, algorithm: 'AES-GCM-256', createdAt: 1 };

async function seed(): Promise<void> {
  await putRecord('workspaces', ws);
  await putRecord('categories', cat);
  await putRecord('bookmarks', bm);
  await putRecord('contexts', encCtx);
  await putRecord('cryptoMetadata', meta);
}

describe('exportAllData', () => {
  it('导出 5 表，contexts 为存储态密文（content 为空，非解密明文）', async () => {
    await seed();
    const data = await exportAllData();
    expect(data.workspaces).toHaveLength(1);
    expect(data.contexts).toHaveLength(1);
    expect(data.contexts[0]!.content).toBe('');           // 存储态，未解密
    expect(data.contexts[0]!.encryptedData).toBe('BASE64_CIPHER');
    expect(data.cryptoMetadata?.salt).toBe('S');
  });

  it('无 cryptoMetadata 时导出 null', async () => {
    await putRecord('workspaces', ws);
    const data = await exportAllData();
    expect(data.cryptoMetadata).toBeNull();
  });
});

describe('replaceAllDataRaw', () => {
  it('覆盖：先有旧数据，replace 后只剩新数据', async () => {
    await putRecord('workspaces', { ...ws, id: 'old', name: '旧' });
    const data: BackupData = {
      workspaces: [ws], categories: [cat], bookmarks: [bm], contexts: [encCtx], cryptoMetadata: meta,
    };
    await replaceAllDataRaw(data);
    expect(await getByKey('workspaces', 'old')).toBeUndefined();   // 旧数据被清
    expect(await getAll('workspaces')).toHaveLength(1);
    expect((await getAll<Context>('contexts'))[0]!.encryptedData).toBe('BASE64_CIPHER');
  });

  it('cryptoMetadata 缺失时保留本机原值（C1 边界）', async () => {
    await putRecord('cryptoMetadata', meta);
    const data: BackupData = {
      workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null,
    };
    await replaceAllDataRaw(data);
    const kept = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
    expect(kept?.salt).toBe('S');   // 本机原值未被清空
  });

  it('cryptoMetadata 存在时覆盖', async () => {
    await putRecord('cryptoMetadata', { ...meta, salt: 'OLD' });
    const data: BackupData = {
      workspaces: [], categories: [], bookmarks: [], contexts: [],
      cryptoMetadata: { ...meta, salt: 'NEW' },
    };
    await replaceAllDataRaw(data);
    expect((await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton'))?.salt).toBe('NEW');
  });
});

describe('broadcastImport', () => {
  it('在 octane-import channel 发 { type: "imported" }', async () => {
    const ch = new BroadcastChannel(IMPORT_CHANNEL_NAME);
    let received: unknown = null;
    ch.onmessage = (e: MessageEvent) => { received = e.data; };
    broadcastImport();
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual({ type: 'imported' });
    ch.close();
  });
});
```

- [ ] **Step 3: 运行，确认通过（数据函数已实现，但验证无回归）**

Run: `npx vitest run tests/db/export-import.test.ts`
Expected: PASS（6 passed）

- [ ] **Step 4: 跑全部 DB 测试确认无回归**

Run: `npx vitest run tests/db/`
Expected: PASS（含既有 database.test.ts）

- [ ] **Step 5: 提交**

```bash
git add src/shared/db/database.ts tests/db/export-import.test.ts
git commit -m "feat(db): exportAllData/replaceAllDataRaw 覆盖事务 + 导入广播"
```

---

## Task 4: applyImport 业务编排（replace + 重算 + lock + 广播）

**Files:**
- Modify: `src/services/BackupService.ts`（加 `applyImport`）
- Test: `tests/services/backup-import.test.ts`

**Interfaces:**
- Consumes: `replaceAllDataRaw`/`broadcastImport`/`broadcastChange`（Task 3）、`syncContextMeta`（`ContextService.ts`）、`lock`（`CryptoService.ts`）、`BackupData`
- Produces: `applyImport(data: BackupData): Promise<void>` —— 编排：覆盖事务 → 逐 bookmark 重算冗余字段 → lock → 广播（bookmarks put + import）。

- [ ] **Step 1: 写失败测试 `tests/services/backup-import.test.ts`**

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getDB, resetDB, putRecord, getByKey, getAll } from '@/shared/db/database';
import { applyImport } from '@/services/BackupService';
import { IMPORT_CHANNEL_NAME } from '@/shared/db/database';
import * as CryptoService from '@/services/CryptoService';
import type { BackupData, Bookmark, Context } from '@/shared/types';
import { ContextType } from '@/shared/types';

beforeEach(async () => {
  resetDB();
  await getDB();
  // 清空
  const db = await getDB();
  const names = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) await tx.objectStore(n).clear();
  await tx.done;
});
afterAll(() => resetDB());

// 构造：备份里 bookmark 的冗余字段被「篡改」为错误值，验证 applyImport 重算
const tamperedBm: Bookmark = {
  id: 'bm-1', workspaceId: 'ws-1', categoryId: 'cat-1', name: 'n', url: 'https://x.com',
  description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, // 故意写错：实际有 1 条 context
  createdAt: 1, updatedAt: 1,
};
const realCtx: Context = {
  id: 'ctx-1', bookmarkId: 'bm-1', type: ContextType.NOTE, title: 't', content: '明文',
  isEncrypted: false, order: 0, createdAt: 1, updatedAt: 1,
};
const payload: BackupData = {
  workspaces: [{ id: 'ws-1', name: 'w', icon: 'i', createdAt: 1, order: 0 }],
  categories: [{ id: 'cat-1', workspaceId: 'ws-1', name: 'c', icon: 'i', order: 0, createdAt: 1 }],
  bookmarks: [tamperedBm],
  contexts: [realCtx],
  cryptoMetadata: null,
};

describe('applyImport', () => {
  it('覆盖写入 5 表', async () => {
    await applyImport(payload);
    expect(await getAll('bookmarks')).toHaveLength(1);
    expect(await getAll('contexts')).toHaveLength(1);
  });

  it('重算冗余字段：篡改的 contextCount=0 → 重算为 1', async () => {
    await applyImport(payload);
    const bm = await getByKey<Bookmark>('bookmarks', 'bm-1');
    expect(bm?.contextCount).toBe(1);
    expect(bm?.hasEncryptedContext).toBe(false);
  });

  it('调用 lock() 清 session 旧密钥', async () => {
    const spy = vi.spyOn(CryptoService, 'lock').mockResolvedValue(undefined);
    await applyImport(payload);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('广播 octane-import 事件（newtab reload 用）', async () => {
    const ch = new BroadcastChannel(IMPORT_CHANNEL_NAME);
    let got = false;
    ch.onmessage = () => { got = true; };
    await applyImport(payload);
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toBe(true);
    ch.close();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/services/backup-import.test.ts`
Expected: FAIL（`applyImport` 未导出）

- [ ] **Step 3: 在 BackupService.ts 追加 applyImport**

```ts
import { replaceAllDataRaw, broadcastChange, broadcastImport } from '@/shared/db/database';
import { syncContextMeta } from '@/services/ContextService';
import { lock } from '@/services/CryptoService';
import type { BackupData } from '@/shared/types';

/**
 * 应用导入：覆盖事务 → 重算冗余字段 → lock session → 广播。
 * 必须在 background service worker 调用（事务不可被 popup 中断）。
 */
export async function applyImport(data: BackupData): Promise<void> {
  await replaceAllDataRaw(data);
  // 重算冗余字段：防备份被篡改导致解锁 gate 错乱
  for (const b of data.bookmarks) {
    await syncContextMeta(b.id);
  }
  // 清 session 旧密钥：salt 已变，旧密钥与新数据不匹配
  await lock();
  // 广播：side panel（store 级）+ newtab（全量 import 事件）
  broadcastChange('bookmarks', 'put');
  broadcastImport();
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/services/backup-import.test.ts`
Expected: PASS（4 passed）

- [ ] **Step 5: 提交**

```bash
git add src/services/BackupService.ts tests/services/backup-import.test.ts
git commit -m "feat(backup): applyImport 覆盖+重算+lock+广播编排"
```

---

## Task 5: background messaging handler

**Files:**
- Create: `src/entrypoints/background.handlers.ts` + 测试
- Modify: `src/entrypoints/background.ts`
- Test: `src/entrypoints/background.handlers.test.ts`

**Interfaces:**
- Consumes: `applyImport`（Task 4）、`BackupData`
- Produces: `handleMessage(msg: unknown): Promise<{ ok: true } | { ok: false; error: string } | undefined>`（`undefined` 表示消息与本模块无关，交其他 listener）；消息类型 `{ type: 'octane:apply-import'; data: BackupData }`。

- [ ] **Step 1: 写失败测试 `src/entrypoints/background.handlers.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMessage } from '@/entrypoints/background.handlers';
import * as BackupService from '@/services/BackupService';
import type { BackupData } from '@/shared/types';

const emptyData: BackupData = {
  workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null,
};

describe('handleMessage', () => {
  it('octane:apply-import → 调 applyImport 并返回 ok', async () => {
    const spy = vi.spyOn(BackupService, 'applyImport').mockResolvedValue(undefined);
    const r = await handleMessage({ type: 'octane:apply-import', data: emptyData });
    expect(spy).toHaveBeenCalledWith(emptyData);
    expect(r).toEqual({ ok: true });
    spy.mockRestore();
  });

  it('applyImport 抛错 → 返回 ok:false + error', async () => {
    vi.spyOn(BackupService, 'applyImport').mockRejectedValue(new Error('写入失败'));
    const r = await handleMessage({ type: 'octane:apply-import', data: emptyData });
    expect(r).toEqual({ ok: false, error: '写入失败' });
  });

  it('无关消息 → undefined（不处理）', async () => {
    expect(await handleMessage({ type: 'something-else' })).toBeUndefined();
    expect(await handleMessage(null)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/entrypoints/background.handlers.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/entrypoints/background.handlers.ts`**

```ts
import { applyImport } from '@/services/BackupService';
import type { BackupData } from '@/shared/types';

export type ImportMessage = { type: 'octane:apply-import'; data: BackupData };
export type HandlerResult = { ok: true } | { ok: false; error: string };

/**
 * background 消息路由。返回 undefined 表示消息与本模块无关（交给其他 listener）。
 * 从 background.ts 抽出为纯函数，便于单测（messaging 管道本身是薄包装）。
 */
export async function handleMessage(
  msg: unknown,
): Promise<HandlerResult | undefined> {
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
  return undefined;
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run src/entrypoints/background.handlers.test.ts`
Expected: PASS（3 passed）

- [ ] **Step 5: 在 background.ts 注册 listener**

替换 `src/entrypoints/background.ts` 的 `main()`，在 setPanelBehavior 之后追加 onMessage 注册：

```ts
import { handleMessage } from '@/entrypoints/background.handlers';

export default defineBackground({
  main() {
    // （保留原有 setPanelBehavior 逻辑不动）
    (chrome as unknown as {
      sidePanel: { setPanelBehavior: (b: { openPanelOnActionClick: boolean }) => Promise<void> };
    }).sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => {
        console.error('[octane] setPanelBehavior 失败', err);
      });

    // 导入覆盖事务在 background 执行（popup 瞬态，长事务不可中断）
    browser.runtime.onMessage.addListener((msg) => handleMessage(msg));
  },
});
```

> 说明：`browser` 是 WXT 提供的全局（webextension-polyfill）；`WxtVitest()` 插件在测试环境注入 mock。listener 返回 Promise 时 polyfill 会把 resolve 值回传给 sendMessage 调用方。

- [ ] **Step 6: 跑 build 确认 background 类型通过（手动）**

Run: `npx wxt build`
Expected: 构建成功（验证 `browser`/`defineBackground` 全局可用）

- [ ] **Step 7: 提交**

```bash
git add src/entrypoints/background.handlers.ts src/entrypoints/background.handlers.test.ts src/entrypoints/background.ts
git commit -m "feat(background): 导入覆盖事务 messaging 路由"
```

---

## Task 6: useBackup 状态机（popup 侧）

**Files:**
- Create: `src/store/useBackup.ts`
- Test: `src/store/__tests__/useBackup.test.ts`

**Interfaces:**
- Consumes: `parseBackupFile`（Task 2）、`exportAllData`（Task 3，导出用）、`BackupData`
- Produces: `useBackup` Zustand store。State：`status: 'idle'|'validating'|'confirming'|'running'|'success'|'error'`、`errorMessage: string | null`、`pendingData: BackupData | null`。Actions：`pickFile(file)`（解析→confirming 或 error）、`confirmImport()`（发消息给 background→running→success/error）、`cancelImport()`、`exportData()`（running→success/error）、`reset()`。

- [ ] **Step 1: 写失败测试 `src/store/__tests__/useBackup.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBackup } from '@/store/useBackup';
import * as BackupService from '@/services/BackupService';
import * as DB from '@/shared/db/database';
import type { BackupData } from '@/shared/types';

const okData: BackupData = { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null };

beforeEach(() => {
  useBackup.getState().reset();
});

describe('useBackup', () => {
  it('pickFile 合法文件 → confirming + pendingData', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: okData });
    await useBackup.getState().pickFile(new File(['x'], 'b.json'));
    expect(useBackup.getState().status).toBe('confirming');
    expect(useBackup.getState().pendingData).toEqual(okData);
  });

  it('pickFile 非法文件 → error', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: false, error: '坏文件' });
    await useBackup.getState().pickFile(new File(['x'], 'b.json'));
    expect(useBackup.getState().status).toBe('error');
    expect(useBackup.getState().errorMessage).toBe('坏文件');
  });

  it('confirmImport → 发消息给 background → success', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: okData });
    await useBackup.getState().pickFile(new File(['x'], 'b.json'));
    const sendSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('browser', { runtime: { sendMessage: sendSpy } });
    await useBackup.getState().confirmImport();
    expect(sendSpy).toHaveBeenCalledWith({ type: 'octane:apply-import', data: okData });
    expect(useBackup.getState().status).toBe('success');
    vi.unstubAllGlobals();
  });

  it('confirmImport background 失败 → error', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: okData });
    await useBackup.getState().pickFile(new File(['x'], 'b.json'));
    vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: '写入失败' }) } });
    await useBackup.getState().confirmImport();
    expect(useBackup.getState().status).toBe('error');
    expect(useBackup.getState().errorMessage).toBe('写入失败');
    vi.unstubAllGlobals();
  });

  it('exportData → 导出 + 下载 → success', async () => {
    vi.spyOn(DB, 'exportAllData').mockResolvedValue(okData);
    const createSpy = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createSpy.mockReturnValue('blob:x'), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await useBackup.getState().exportData();
    expect(useBackup.getState().status).toBe('success');
    expect(createSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
```

> 注：`confirmImport background 失败` 用例里多出的 `vi.unstubAll_globals?.()` 是笔误占位，实现时删除该行，仅保留 `vi.unstubAllGlobals()`。（实现者照 `success` 用例的清理方式即可。）

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run src/store/__tests__/useBackup.test.ts`
Expected: FAIL（store 不存在）

- [ ] **Step 3: 实现 `src/store/useBackup.ts`**

```ts
import { create } from 'zustand';
import { parseBackupFile } from '@/services/BackupService';
import { exportAllData } from '@/shared/db/database';
import { BACKUP_SCHEMA, BACKUP_VERSION } from '@/shared/types';
import type { BackupData } from '@/shared/types';

export type BackupStatus = 'idle' | 'validating' | 'confirming' | 'running' | 'success' | 'error';

interface BackupState {
  status: BackupStatus;
  errorMessage: string | null;
  pendingData: BackupData | null;
  pickFile: (file: File) => Promise<void>;
  confirmImport: () => Promise<void>;
  cancelImport: () => void;
  exportData: () => Promise<void>;
  reset: () => void;
}

const INITIAL = { status: 'idle' as BackupStatus, errorMessage: null as string | null, pendingData: null as BackupData | null };

export const useBackup = create<BackupState>((set, get) => ({
  ...INITIAL,

  pickFile: async (file) => {
    set({ status: 'validating', errorMessage: null });
    const r = await parseBackupFile(file);
    if (r.ok) {
      set({ status: 'confirming', pendingData: r.data, errorMessage: null });
    } else {
      set({ status: 'error', errorMessage: r.error, pendingData: null });
    }
  },

  confirmImport: async () => {
    const data = get().pendingData;
    if (!data) return;
    set({ status: 'running', errorMessage: null });
    try {
      const res = await browser.runtime.sendMessage({ type: 'octane:apply-import', data });
      if (res && res.ok) {
        set({ status: 'success', pendingData: null });
      } else {
        set({ status: 'error', errorMessage: (res?.error as string) || '导入失败' });
      }
    } catch (e) {
      set({ status: 'error', errorMessage: (e as Error).message || '导入失败' });
    }
  },

  cancelImport: () => set({ status: 'idle', pendingData: null, errorMessage: null }),

  exportData: async () => {
    set({ status: 'running', errorMessage: null });
    try {
      const data = await exportAllData();
      const file = {
        schema: BACKUP_SCHEMA,
        version: BACKUP_VERSION,
        exportedAt: Date.now(),
        appVersion: browser.runtime.getManifest().version,
        data,
      };
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `octane-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      set({ status: 'success' });
    } catch (e) {
      set({ status: 'error', errorMessage: (e as Error).message || '导出失败' });
    }
  },

  reset: () => set(INITIAL),
}));
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run src/store/__tests__/useBackup.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: 提交**

```bash
git add src/store/useBackup.ts src/store/__tests__/useBackup.test.ts
git commit -m "feat(backup): useBackup 状态机（解析/确认/导入/导出）"
```

---

## Task 7: LocalBackupSection UI + SettingsView 组合

**Files:**
- Create: `src/entrypoints/popup/views/backup/LocalBackupSection.tsx`
- Modify: `src/entrypoints/popup/views/SettingsView.tsx`、`src/entrypoints/popup/popup.module.css`
- Test: `src/entrypoints/popup/views/backup/__tests__/LocalBackupSection.test.tsx`

**Interfaces:**
- Consumes: `useBackup`（Task 6）；Semi UI（Card/Button/Modal/Banner/Toast/Checkbox/Typography）。
- UI 行为：导出按钮 → `exportData`；导入按钮 → 触发隐藏 `<input type=file>` → `pickFile` → 若 confirming 显示警告 Modal（Checkbox 二次确认 + danger 按钮）→ `confirmImport`；全程 Toast/aria-live 反馈；导出区 Banner(info) 说明密文。

- [ ] **Step 1: 在 popup.module.css 追加备份区样式**

```css
.backupSection { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.backupActions { display: flex; gap: 8px; }
.backupConfirmBody { display: flex; flex-direction: column; gap: 12px; }
.backupError { color: var(--semi-color-danger); }
```

- [ ] **Step 2: 写失败测试 `src/entrypoints/popup/views/backup/__tests__/LocalBackupSection.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LocalBackupSection } from '../LocalBackupSection';
import { useBackup } from '@/store/useBackup';
import * as BackupService from '@/services/BackupService';

beforeEach(() => useBackup.getState().reset());

describe('LocalBackupSection', () => {
  it('渲染导出/导入按钮 + 密文说明 Banner', () => {
    render(<LocalBackupSection />);
    expect(screen.getByText('导出数据')).toBeInTheDocument();
    expect(screen.getByText('导入数据')).toBeInTheDocument();
    expect(screen.getByText(/密文/)).toBeInTheDocument();
  });

  it('选合法文件 → 弹出覆盖确认 Modal', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({
      ok: true, data: { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null },
    });
    render(<LocalBackupSection />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'b.json')] } });
    await waitFor(() => expect(screen.getByText(/确认覆盖全部数据/)).toBeInTheDocument());
  });

  it('未勾选确认 Checkbox 时，确认按钮禁用', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({
      ok: true, data: { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null },
    });
    render(<LocalBackupSection />);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'b.json')] },
    });
    await waitFor(() => expect(screen.getByText(/确认覆盖/)).toBeInTheDocument());
    const confirmBtn = screen.getByRole('button', { name: /确认覆盖/ });
    expect(confirmBtn).toBeDisabled();
  });
});
```

- [ ] **Step 3: 运行，确认失败**

Run: `npx vitest run src/entrypoints/popup/views/backup/__tests__/LocalBackupSection.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 4: 实现 `src/entrypoints/popup/views/backup/LocalBackupSection.tsx`**

```tsx
import { useRef, useState } from 'react';
import { Button, Modal, Banner, Toast, Typography, Checkbox } from '@douyinfe/semi-ui';
import { useBackup } from '@/store/useBackup';
import styles from '../../popup.module.css';

/** 本地备份区：导出 + 导入（覆盖式，破坏性强确认）。 */
export function LocalBackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const { status, errorMessage, pendingData, pickFile, confirmImport, cancelImport, exportData, reset } = useBackup();

  const handleExport = async () => {
    await exportData();
    if (useBackup.getState().status === 'success') Toast.success('已导出备份文件');
    else if (useBackup.getState().status === 'error') Toast.error(useBackup.getState().errorMessage || '导出失败');
  };

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setConfirmed(false);
    await pickFile(f);
    if (useBackup.getState().status === 'error') Toast.error(useBackup.getState().errorMessage || '文件无效');
    e.target.value = ''; // 允许重复选同文件
  };

  const handleConfirm = async () => {
    await confirmImport();
    const s = useBackup.getState().status;
    if (s === 'success') Toast.success('导入完成，如含加密数据请用原密码解锁');
    else if (s === 'error') Toast.error(useBackup.getState().errorMessage || '导入失败');
  };

  const modalOpen = status === 'confirming' && pendingData !== null;

  return (
    <div className={styles.backupSection}>
      <Banner type="info" description="导出文件含加密笔记的密文（非明文）。在另一台设备恢复时，需使用相同的主密码解锁。" />
      <div className={styles.backupActions}>
        <Button theme="solid" loading={status === 'running' && !modalOpen} onClick={handleExport}>导出数据</Button>
        <Button onClick={() => fileRef.current?.click()}>导入数据</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handlePick} />
      </div>
      {status === 'error' && errorMessage && (
        <Typography.Text type="danger" role="alert" className={styles.backupError}>{errorMessage}</Typography.Text>
      )}

      <Modal
        title="确认覆盖全部数据"
        visible={modalOpen}
        onCancel={cancelImport}
        footer={null}
        maskClosable={false}
      >
        <div className={styles.backupConfirmBody}>
          <Typography.Text>
            此操作将清除当前全部工作区、书签与上下文，并替换为备份内容，不可撤销。
            {pendingData?.cryptoMetadata ? ' 备份含加密数据，恢复后请用导出端主密码解锁。' : ''}
          </Typography.Text>
          <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}>
            我了解此操作不可撤销
          </Checkbox>
          <Button
            theme="solid"
            type="danger"
            disabled={!confirmed}
            loading={status === 'running'}
            onClick={handleConfirm}
          >
            确认覆盖
          </Button>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 5: 替换 SettingsView 占位 `src/entrypoints/popup/views/SettingsView.tsx`**

```tsx
import SubPageHeader from './SubPageHeader';
import { LocalBackupSection } from './backup/LocalBackupSection';
import styles from '../popup.module.css';

interface SettingsViewProps {
  onBack: () => void;
}

/** 设置子页面：本地数据备份（导入/导出）。 */
export default function SettingsView({ onBack }: SettingsViewProps) {
  return (
    <div className={styles.settingsView}>
      <SubPageHeader title="设置" onBack={onBack} />
      <LocalBackupSection />
    </div>
  );
}
```

- [ ] **Step 6: 运行 UI 测试，确认通过**

Run: `npx vitest run src/entrypoints/popup/views/backup/__tests__/LocalBackupSection.test.tsx`
Expected: PASS（3 passed）

- [ ] **Step 7: 跑 popup 全部测试确认 SettingsView 改动无回归**

Run: `npx vitest run src/entrypoints/popup/`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add src/entrypoints/popup/views/backup/ src/entrypoints/popup/views/SettingsView.tsx src/entrypoints/popup/popup.module.css
git commit -m "feat(backup): LocalBackupSection 本地导入导出 UI + 强确认"
```

---

## Task 8: newtab 订阅 import 事件 reload

**Files:**
- Modify: `src/entrypoints/newtab/App.tsx`
- Test: `tests/newtab/import-reload.test.ts`

**Interfaces:**
- Consumes: `IMPORT_CHANNEL_NAME`、`broadcastImport`（Task 3）；`useWorkspace.loadWorkspaces`、`useBookmarks.loadBookmarks`（已有）。

- [ ] **Step 1: 写失败测试 `tests/newtab/import-reload.test.ts`**

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { IMPORT_CHANNEL_NAME } from '@/shared/db/database';
import * as useWorkspaceMod from '@/store/useWorkspace';
import * as useBookmarksMod from '@/store/useBookmarks';

// 最小化验证：导入事件 → loadWorkspaces 被再次调用
describe('newtab import reload', () => {
  it('收到 octane-import 事件 → 触发 loadWorkspaces reload', async () => {
    const loadSpy = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(useWorkspaceMod.useWorkspace, 'getState').mockReturnValue({
      loadWorkspaces: loadSpy,
      loadCategories: vi.fn(),
    } as never);
    vi.spyOn(useBookmarksMod.useBookmarks, 'getState').mockReturnValue({ loadBookmarks: vi.fn() } as never);

    const { default: App } = await import('@/newtab/App');
    render(<App />);

    // 初始挂载已调一次 loadWorkspaces；清空后发 import 事件
    loadSpy.mockClear();
    const ch = new BroadcastChannel(IMPORT_CHANNEL_NAME);
    ch.postMessage({ type: 'imported' });
    ch.close();
    await waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/newtab/import-reload.test.ts`
Expected: FAIL（newtab 尚未订阅 import channel）

- [ ] **Step 3: 修改 `src/entrypoints/newtab/App.tsx` 加 import 订阅**

在现有 `App` 组件内追加第二个 useEffect（订阅 import channel）。完整修改后组件：

```tsx
import React, { useEffect } from 'react';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useCrypto } from '@/store/useCrypto';
import { Sidebar } from '@/newtab/components/Sidebar';
import { Content } from '@/newtab/components/Content';
import { UnlockModal } from '@/newtab/components/UnlockModal';
import { IMPORT_CHANNEL_NAME } from '@/shared/db/database';
import '@/styles/global.css';
import '@/newtab/App.css';

const App: React.FC = () => {
  const loadWorkspaces = useWorkspace((s) => s.loadWorkspaces);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const loadBookmarks = useBookmarks((s) => s.loadBookmarks);
  const checkStatus = useCrypto((s) => s.checkStatus);

  useEffect(() => {
    checkStatus();
    loadWorkspaces();
  }, []);

  useEffect(() => {
    if (currentCategoryId) {
      loadBookmarks(currentCategoryId);
    }
  }, [currentCategoryId]);

  // 订阅全量导入事件：导入覆盖后（background 广播）整体 reload
  useEffect(() => {
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(IMPORT_CHANNEL_NAME) : null;
    const onMessage = () => {
      checkStatus();   // salt 可能变更，重置解锁态
      loadWorkspaces();
    };
    channel?.addEventListener('message', onMessage);
    return () => {
      channel?.close();
    };
  }, [checkStatus, loadWorkspaces]);

  return (
    <>
      <UnlockModal />
      <div className="app-layout">
        <aside className="app-sidebar semi-always-dark" id="sidebar-container">
          <Sidebar />
        </aside>
        <main className="app-content">
          <Content />
        </main>
      </div>
    </>
  );
};

export default App;
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/newtab/import-reload.test.ts`
Expected: PASS（1 passed）

- [ ] **Step 5: 全量测试**

Run: `npx vitest run`
Expected: 全部 PASS（含本次新增 + 既有用例无回归）

- [ ] **Step 6: 构建验证**

Run: `npx wxt build`
Expected: 构建成功

- [ ] **Step 7: 提交**

```bash
git add src/entrypoints/newtab/App.tsx tests/newtab/import-reload.test.ts
git commit -m "feat(newtab): 订阅导入事件整体 reload"
```

---

## 手动验收（全部 task 完成后）

- [ ] `npx wxt dev` 加载扩展 → NewTab 建工作区/书签/上下文（含一条加密上下文，设主密码解锁）
- [ ] Popup → 齿轮 → 设置 → 导出数据 → 下载 JSON，打开确认含 `cryptoMetadata` + 加密 context 的 `encryptedData`/`iv`，且 `content` 为空
- [ ] 清空扩展数据（或换 profile）→ 设置 → 导入数据 → 选刚才 JSON → 确认 Modal → Checkbox → 确认覆盖
- [ ] NewTab 自动 reload 显示导入数据；加密上下文用原密码解锁可读
- [ ] 用错误密码解锁 → 解密失败但不崩（沿用现有 error 态）
- [ ] 导入期间关闭 Popup → 数据仍正确写入（事务在 background）

---

## Self-Review

**1. Spec coverage**（对照设计文档 P1 范围）：
- BackupService exportLocal/importLocal/validateBackup → Task 1/2/4/6 ✓
- 覆盖事务（4 表 clear+put，cryptoMetadata 条件）→ Task 3 ✓
- contexts 用底层 getAll 不解密 → Task 3 测试显式断言 content='' ✓
- background 执行 → Task 4/5 ✓
- syncContextMeta 重算 → Task 4 测试断言 ✓
- lock() 清 session → Task 4 测试断言 ✓
- 显式广播 + newtab import 事件 → Task 3/4/8 ✓
- useBackup 状态机 → Task 6 ✓
- SettingsView 扩展 + 强确认 Modal + Banner + Toast + aria-live → Task 7 ✓
- validateBackup 各分支测试 → Task 1 ✓
- 文件大小 50MB 阈值 → Task 2 ✓
- version=1 策略 → Task 1 ✓

**2. Placeholder scan**：无 TBD/TODO；`appVersion` 使用 WXT 提供的 `browser.runtime.getManifest().version`。

**3. Type consistency**：`BackupData`/`ValidationResult`/`applyImport`/`handleMessage`/`useBackup` 签名跨 task 一致；`IMPORT_CHANNEL_NAME` 在 database.ts 定义、Task 4/8 消费，命名统一。

**执行期注意点（非缺陷，提醒执行者）**：
- Task 5 Step 6 / Task 8 Step 6 的 `wxt build` 是类型与打包验证，非单测。
- Semi UI 的 `Banner`/`Modal`/`Checkbox` 在 jsdom 下渲染需确认 @testing-library 能查到文案；若 Modal 用 portal 导致 `screen.getByText` 查不到，改用 `document.body` 查询（执行时按实际调整）。
