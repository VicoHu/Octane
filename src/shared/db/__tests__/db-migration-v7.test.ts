import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME } from '@/shared/types';
import { getDB, resetDB } from '@/shared/db/database';

const LEGACY_STORES = [
  'workspaces',
  'categories',
  'bookmarks',
  'contexts',
  'cryptoMetadata',
  'favicons',
  'pinnedTabs',
] as const;

const TODO_STORES = [
  'taskLists',
  'tasks',
  'checklistItems',
  'taskTags',
  'taskTagAssignments',
] as const;

async function seedV6Database(): Promise<void> {
  const v6 = await openDB(DB_NAME, 6, {
    upgrade(db) {
      db.createObjectStore('workspaces', { keyPath: 'id' });
      const categories = db.createObjectStore('categories', { keyPath: 'id' });
      categories.createIndex('by-workspaceId', 'workspaceId');
      const bookmarks = db.createObjectStore('bookmarks', { keyPath: 'id' });
      bookmarks.createIndex('by-workspaceId', 'workspaceId');
      bookmarks.createIndex('by-categoryId', 'categoryId');
      const contexts = db.createObjectStore('contexts', { keyPath: 'id' });
      contexts.createIndex('by-bookmarkId', 'bookmarkId');
      db.createObjectStore('cryptoMetadata', { keyPath: 'id' });
      db.createObjectStore('favicons', { keyPath: 'hostname' });
      const pinnedTabs = db.createObjectStore('pinnedTabs', { keyPath: 'id' });
      pinnedTabs.createIndex('by-workspaceId', 'workspaceId');
    },
  });

  await v6.put('workspaces', { id: 'workspace-1', name: '工作区', icon: 'W', createdAt: 1, order: 0 });
  await v6.put('categories', { id: 'category-1', workspaceId: 'workspace-1', name: '分类', icon: 'C', createdAt: 1, order: 0 });
  await v6.put('bookmarks', {
    id: 'bookmark-1', workspaceId: 'workspace-1', categoryId: 'category-1', name: '书签',
    url: 'https://example.com', description: '', faviconUrl: '', contextCount: 0,
    hasEncryptedContext: false, createdAt: 1, updatedAt: 1, order: 0, tags: ['Tag'],
  });
  await v6.put('contexts', {
    id: 'context-1', bookmarkId: 'bookmark-1', type: 'note', title: '上下文', content: '',
    isEncrypted: false, order: 0, createdAt: 1, updatedAt: 1,
  });
  await v6.put('cryptoMetadata', { id: 'singleton', salt: 'salt', iterations: 1, algorithm: 'AES-GCM', createdAt: 1 });
  await v6.put('favicons', { hostname: 'example.com', fetchedAt: 1 });
  await v6.put('pinnedTabs', { id: 'pinned-1', workspaceId: 'workspace-1', name: '常驻', url: 'https://example.com', order: 0, createdAt: 1 });
  v6.close();
}

async function deleteDatabase(): Promise<void> {
  try {
    const db = await getDB();
    db.close();
  } catch {
    // 数据库尚未打开时无需关闭。
  }
  resetDB();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

afterEach(deleteDatabase);

describe('数据库迁移 v6→v7（待办数据表结构）', () => {
  it('升级保留全部既有表数据，新增待办表为空', async () => {
    await seedV6Database();

    const db = await getDB();

    for (const store of LEGACY_STORES) {
      expect(await db.count(store)).toBe(1);
    }
    expect((await db.get('bookmarks', 'bookmark-1'))?.tags).toEqual(['Tag']);
    for (const store of TODO_STORES) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
      expect(await db.count(store)).toBe(0);
    }
  });

  it('升级过程不打开第二个数据库事务', async () => {
    await seedV6Database();
    const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction');

    await getDB();

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(transactionSpy).toHaveBeenCalledWith(expect.any(Array), 'versionchange');
    transactionSpy.mockRestore();
  });

  it('新表的主键、索引与唯一约束符合数据表结构', async () => {
    const db = await getDB();
    const transaction = db.transaction([...TODO_STORES], 'readonly');

    const taskLists = transaction.objectStore('taskLists');
    expect(taskLists.keyPath).toBe('id');
    expect(Array.from(taskLists.indexNames)).toEqual(['by-workspaceId', 'by-workspaceId-normalizedName']);
    expect(taskLists.index('by-workspaceId').unique).toBe(false);
    expect(taskLists.index('by-workspaceId-normalizedName').keyPath).toEqual(['workspaceId', 'normalizedName']);
    expect(taskLists.index('by-workspaceId-normalizedName').unique).toBe(true);

    const tasks = transaction.objectStore('tasks');
    expect(tasks.keyPath).toBe('id');
    expect(Array.from(tasks.indexNames).sort()).toEqual(['by-workspaceId', 'by-containerKey', 'by-listId', 'by-dueDate', 'by-deletedAt'].sort());
    for (const indexName of tasks.indexNames) expect(tasks.index(indexName).unique).toBe(false);

    const checklistItems = transaction.objectStore('checklistItems');
    expect(checklistItems.keyPath).toBe('id');
    expect(Array.from(checklistItems.indexNames)).toEqual(['by-taskId']);
    expect(checklistItems.index('by-taskId').unique).toBe(false);

    const taskTags = transaction.objectStore('taskTags');
    expect(taskTags.keyPath).toBe('id');
    expect(Array.from(taskTags.indexNames)).toEqual(['by-workspaceId', 'by-workspaceId-normalizedName']);
    expect(taskTags.index('by-workspaceId').unique).toBe(false);
    expect(taskTags.index('by-workspaceId-normalizedName').keyPath).toEqual(['workspaceId', 'normalizedName']);
    expect(taskTags.index('by-workspaceId-normalizedName').unique).toBe(true);

    const assignments = transaction.objectStore('taskTagAssignments');
    expect(assignments.keyPath).toEqual(['taskId', 'tagId']);
    expect(Array.from(assignments.indexNames).sort()).toEqual(['by-taskId', 'by-tagId'].sort());
    expect(assignments.index('by-taskId').unique).toBe(false);
    expect(assignments.index('by-tagId').unique).toBe(false);
    await transaction.done;
  });

  it('全新安装直接创建完整 v7 数据表结构', async () => {
    const db = await getDB();

    expect(Array.from(db.objectStoreNames).sort()).toEqual([...LEGACY_STORES, ...TODO_STORES].sort());
  });
});
