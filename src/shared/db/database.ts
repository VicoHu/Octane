import { openDB, type IDBPDatabase, type IDBPObjectStore } from 'idb';
import { DB_NAME, DB_VERSION } from '@/shared/types';

interface OctaneDB extends IDBPDatabase {
  workspaces: IDBPObjectStore<OctaneDB, ['workspaces']>;
  categories: IDBPObjectStore<OctaneDB, ['categories']>;
  bookmarks: IDBPObjectStore<OctaneDB, ['bookmarks']>;
  notes: IDBPObjectStore<OctaneDB, ['notes']>;
  cryptoMetadata: IDBPObjectStore<OctaneDB, ['cryptoMetadata']>;
}

type StoreName = 'workspaces' | 'categories' | 'bookmarks' | 'notes' | 'cryptoMetadata';

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

        // 笔记表，bookmarkId 为主键
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'bookmarkId' });
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
  return db.put(storeName, value);
}

/** 删除记录 */
export async function deleteRecord(storeName: StoreName, key: string): Promise<void> {
  const db = await getDB();
  return db.delete(storeName, key);
}

// ========== 级联删除 ==========

/** 级联删除工作区：Workspace → Categories + Bookmarks + Notes */
export async function cascadeDeleteWorkspace(workspaceId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['workspaces', 'categories', 'bookmarks', 'notes'],
    'readwrite',
  );

  const categories = await tx.objectStore('categories').index('by-workspaceId').getAll(workspaceId);
  const categoryIds = new Set(categories.map((c) => c.id));

  const bookmarks = await tx.objectStore('bookmarks').index('by-workspaceId').getAll(workspaceId);
  const bookmarkIds = bookmarks.map((b) => b.id);

  for (const bookmarkId of bookmarkIds) {
    await tx.objectStore('notes').delete(bookmarkId);
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

/** 级联删除分类：Category → Bookmarks + Notes */
export async function cascadeDeleteCategory(categoryId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['categories', 'bookmarks', 'notes'], 'readwrite');

  const bookmarks = await tx.objectStore('bookmarks').index('by-categoryId').getAll(categoryId);
  const bookmarkIds = bookmarks.map((b) => b.id);

  for (const bookmarkId of bookmarkIds) {
    await tx.objectStore('notes').delete(bookmarkId);
  }
  for (const bookmarkId of bookmarkIds) {
    await tx.objectStore('bookmarks').delete(bookmarkId);
  }
  await tx.objectStore('categories').delete(categoryId);

  await tx.done;
}

/** 删除书签及其关联笔记 */
export async function deleteBookmarkCascade(bookmarkId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['bookmarks', 'notes'], 'readwrite');

  await tx.objectStore('notes').delete(bookmarkId);
  await tx.objectStore('bookmarks').delete(bookmarkId);

  await tx.done;
}

// 导出类型供其他模块使用
export type { OctaneDB, StoreName };
