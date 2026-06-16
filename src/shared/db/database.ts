import { openDB, type IDBPDatabase, type IDBPObjectStore } from 'idb';
import { DB_NAME, DB_VERSION } from '@/shared/types';

interface OctaneDB extends IDBPDatabase {
  workspaces: IDBPObjectStore<OctaneDB, ['workspaces']>;
  categories: IDBPObjectStore<OctaneDB, ['categories']>;
  bookmarks: IDBPObjectStore<OctaneDB, ['bookmarks']>;
  contexts: IDBPObjectStore<OctaneDB, ['contexts']>;
  cryptoMetadata: IDBPObjectStore<OctaneDB, ['cryptoMetadata']>;
}

type StoreName = 'workspaces' | 'categories' | 'bookmarks' | 'contexts' | 'cryptoMetadata';

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

let dbPromise: Promise<IDBPDatabase<OctaneDB>> | null = null;

/** 获取 IndexedDB 连接（单例） */
export function getDB(): Promise<IDBPDatabase<OctaneDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OctaneDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
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

/** 级联删除工作区：Workspace → Categories + Bookmarks + Contexts */
export async function cascadeDeleteWorkspace(workspaceId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['workspaces', 'categories', 'bookmarks', 'contexts'],
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
  await tx.objectStore('workspaces').delete(workspaceId);

  await tx.done;
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
}

// 导出类型供其他模块使用
export type { OctaneDB, StoreName };
