import { openDB, type IDBPDatabase, type IDBPObjectStore } from 'idb';
import { DB_NAME, DB_VERSION } from '@/shared/types';
import type {
  BackupData,
  Bookmark,
  Category,
  Context,
  CryptoMetadata,
  PinnedTab,
  Workspace,
} from '@/shared/types';

interface OctaneDB extends IDBPDatabase {
  workspaces: IDBPObjectStore<OctaneDB, ['workspaces']>;
  categories: IDBPObjectStore<OctaneDB, ['categories']>;
  bookmarks: IDBPObjectStore<OctaneDB, ['bookmarks']>;
  contexts: IDBPObjectStore<OctaneDB, ['contexts']>;
  cryptoMetadata: IDBPObjectStore<OctaneDB, ['cryptoMetadata']>;
  favicons: IDBPObjectStore<OctaneDB, ['favicons']>;
  pinnedTabs: IDBPObjectStore<OctaneDB, ['pinnedTabs']>;
}

type StoreName =
  | 'workspaces'
  | 'categories'
  | 'bookmarks'
  | 'contexts'
  | 'cryptoMetadata'
  | 'favicons'
  | 'pinnedTabs';

/**
 * 数据变更事件：数据库写入后广播，让其他上下文（side panel）重新读取刷新。
 * 同名 BroadcastChannel 实例互通信义，同实例 postMessage 不回环。
 */
export type DbChangeEvent = { store: StoreName; action: 'put' | 'delete' };

const dbChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DB_NAME) : null;

/** 广播数据变更。无原生 BroadcastChannel 时静默跳过。 */
function broadcast(store: StoreName, action: 'put' | 'delete'): void {
  dbChannel?.postMessage({ store, action } satisfies DbChangeEvent);
}

/** 公开包装：供导入等外部流程显式触发 store 变更广播（side panel 刷新）。 */
export function broadcastChange(store: StoreName, action: 'put' | 'delete'): void {
  broadcast(store, action);
}

/** 全量导入广播 channel 名（独立于 store 级广播，供 home 整体 reload）。 */
export const IMPORT_CHANNEL_NAME = 'octane-import';
const importChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(IMPORT_CHANNEL_NAME) : null;

/** 广播「全量导入完成」事件。home 订阅后整体 reload。 */
export function broadcastImport(): void {
  importChannel?.postMessage({ type: 'imported' });
}

let dbPromise: Promise<IDBPDatabase<OctaneDB>> | null = null;

/**
 * 数据库迁移纯函数（Issue 3A：从 openDB 抽离以便单测）。
 *
 * v1–v3 的建库逻辑保留幂等 `if (!contains)` 守卫（不按版本门控），以精确复刻历史行为、
 * 避免对老库的回归风险；v4 起新增 store 走显式 `oldVersion < N` 门控，让迁移边界清晰可测。
 */
export function runUpgrade(
  db: IDBPDatabase<OctaneDB>,
  oldVersion: number,
  _newVersion: number | null,
): void {
  // 工作区表
  if (!db.objectStoreNames.contains('workspaces')) {
    db.createObjectStore('workspaces', { keyPath: 'id' });
  }

  // 分类表，按 workspaceId 索引
  if (!db.objectStoreNames.contains('categories')) {
    const categoryStore = db.createObjectStore('categories', { keyPath: 'id' });
    categoryStore.createIndex('by-workspaceId', 'workspaceId');
  }

  // 书签表，按 workspaceId 和 categoryId 索引
  if (!db.objectStoreNames.contains('bookmarks')) {
    const bookmarkStore = db.createObjectStore('bookmarks', { keyPath: 'id' });
    bookmarkStore.createIndex('by-workspaceId', 'workspaceId');
    bookmarkStore.createIndex('by-categoryId', 'categoryId');
  }

  // 笔记表 → 上下文表（v1→v2 升级）
  if (db.objectStoreNames.contains('notes')) {
    console.warn('[Octane] 数据库升级 v1→v2：删除旧 notes store，历史笔记数据将丢失。');
    db.deleteObjectStore('notes');
  }
  if (!db.objectStoreNames.contains('contexts')) {
    const contextStore = db.createObjectStore('contexts', { keyPath: 'id' });
    contextStore.createIndex('by-bookmarkId', 'bookmarkId');
  }

  // 加密元数据（全局单例）
  if (!db.objectStoreNames.contains('cryptoMetadata')) {
    db.createObjectStore('cryptoMetadata', { keyPath: 'id' });
  }

  // favicon 缓存（v2→v3）：per-hostname 去重，不进备份
  if (!db.objectStoreNames.contains('favicons')) {
    db.createObjectStore('favicons', { keyPath: 'hostname' });
  }

  // pinnedTabs 常驻标签（v3→v4）：独立实体，per-workspace 跨分类
  if (oldVersion < 4) {
    const pinnedStore = db.createObjectStore('pinnedTabs', { keyPath: 'id' });
    pinnedStore.createIndex('by-workspaceId', 'workspaceId');
  }
}

/** 获取 IndexedDB 连接（单例） */
export function getDB(): Promise<IDBPDatabase<OctaneDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OctaneDB>(DB_NAME, DB_VERSION, {
      upgrade: (db, oldVersion, newVersion) => {
        runUpgrade(db, oldVersion, newVersion);
      },
    });
  }
  return dbPromise;
}

/** 重置数据库连接（仅用于测试） */
export function resetDB(): void {
  dbPromise = null;
}

// ========== Generic CRUD ==========

/** 根据主键获取记录 */
export async function getByKey<T>(storeName: StoreName, key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get(storeName, key);
}

/** 获取所有记录 */
export async function getAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await getDB();
  return db.getAll(storeName);
}

/** 根据索引查询 */
export async function getByIndex<T>(
  storeName: StoreName,
  indexName: string,
  value: IDBValidKey,
): Promise<T[]> {
  const db = await getDB();
  return db.getAllFromIndex(storeName, indexName, value);
}

/** 写入（put）记录 */
export async function putRecord(storeName: StoreName, value: unknown): Promise<IDBValidKey> {
  const db = await getDB();
  const key = await db.put(storeName, value);
  broadcast(storeName, 'put');
  return key;
}

/** 删除记录 */
export async function deleteRecord(storeName: StoreName, key: string): Promise<void> {
  const db = await getDB();
  await db.delete(storeName, key);
  broadcast(storeName, 'delete');
}

// ========== 级联删除 ==========

/** 级联删除工作区：Workspace → Categories + Bookmarks + Contexts + PinnedTabs */
export async function cascadeDeleteWorkspace(workspaceId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['workspaces', 'categories', 'bookmarks', 'contexts', 'pinnedTabs'],
    'readwrite',
  );

  const categories = await tx.objectStore('categories').index('by-workspaceId').getAll(workspaceId);
  const categoryIds = new Set(categories.map((c) => c.id));

  const bookmarks = await tx.objectStore('bookmarks').index('by-workspaceId').getAll(workspaceId);
  const bookmarkIds = bookmarks.map((b) => b.id);

  for (const bookmarkId of bookmarkIds) {
    const contexts = await tx.objectStore('contexts').index('by-bookmarkId').getAll(bookmarkId);
    for (const ctx of contexts) {
      await tx.objectStore('contexts').delete(ctx.id);
    }
  }
  for (const bookmarkId of bookmarkIds) {
    await tx.objectStore('bookmarks').delete(bookmarkId);
  }
  for (const categoryId of categoryIds) {
    await tx.objectStore('categories').delete(categoryId);
  }
  // 删除该工作区的常驻标签（per-workspace，与书签解耦但同属工作区）
  const pins = await tx.objectStore('pinnedTabs').index('by-workspaceId').getAll(workspaceId);
  for (const pin of pins) {
    await tx.objectStore('pinnedTabs').delete(pin.id);
  }
  await tx.objectStore('workspaces').delete(workspaceId);

  await tx.done;
  broadcast('bookmarks', 'delete');
  broadcast('pinnedTabs', 'delete');
}

/** 级联删除分类：Category → Bookmarks + Contexts */
export async function cascadeDeleteCategory(categoryId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['categories', 'bookmarks', 'contexts'], 'readwrite');

  const bookmarks = await tx.objectStore('bookmarks').index('by-categoryId').getAll(categoryId);
  const bookmarkIds = bookmarks.map((b) => b.id);

  for (const bookmarkId of bookmarkIds) {
    const contexts = await tx.objectStore('contexts').index('by-bookmarkId').getAll(bookmarkId);
    for (const ctx of contexts) {
      await tx.objectStore('contexts').delete(ctx.id);
    }
  }
  for (const bookmarkId of bookmarkIds) {
    await tx.objectStore('bookmarks').delete(bookmarkId);
  }
  await tx.objectStore('categories').delete(categoryId);

  await tx.done;
  broadcast('bookmarks', 'delete');
}

/** 删除书签及其关联上下文 */
export async function deleteBookmarkCascade(bookmarkId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['bookmarks', 'contexts'], 'readwrite');

  const contexts = await tx.objectStore('contexts').index('by-bookmarkId').getAll(bookmarkId);
  for (const ctx of contexts) {
    await tx.objectStore('contexts').delete(ctx.id);
  }
  await tx.objectStore('bookmarks').delete(bookmarkId);

  await tx.done;
  broadcast('bookmarks', 'delete');
}

// ========== 全量导出 / 覆盖导入 ==========

const DATA_STORES = ['workspaces', 'categories', 'bookmarks', 'contexts'] as const;
const ALL_STORES = [...DATA_STORES, 'cryptoMetadata', 'pinnedTabs'] as const;

/**
 * 导出全部数据（6 表存储态）。
 * contexts 取底层 getAll（含密文，不解密）——禁止用会解密的 ContextService.getContexts。
 */
export async function exportAllData(): Promise<BackupData> {
  return {
    workspaces: await getAll<Workspace>('workspaces'),
    categories: await getAll<Category>('categories'),
    bookmarks: await getAll<Bookmark>('bookmarks'),
    contexts: await getAll<Context>('contexts'),
    pinnedTabs: await getAll<PinnedTab>('pinnedTabs'),
    cryptoMetadata: (await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton')) ?? null,
  };
}

/**
 * 覆盖式写入：单 readwrite 事务，4 必填数据表 clear 后 put；pinnedTabs 与 cryptoMetadata
 * 为可选字段，仅当 data 显式提供时才覆盖，字段缺失（v1 旧备份）保留现有数据——
 * 避免导入不含 pinnedTabs 的备份时静默清空用户已有常驻标签。
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
  // 可选字段：仅当显式提供时 clear+put；缺失则不动该 store
  if (data.pinnedTabs) {
    await tx.objectStore('pinnedTabs').clear();
    for (const p of data.pinnedTabs) await tx.objectStore('pinnedTabs').put(p);
  }
  if (data.cryptoMetadata) {
    await tx.objectStore('cryptoMetadata').put(data.cryptoMetadata);
  }
  await tx.done;
}

// 导出类型供其他模块使用
export type { OctaneDB, StoreName };
