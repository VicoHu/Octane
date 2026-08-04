import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/shared/types';
import type { Category, Workspace } from '@/shared/types';
import { getDB, resetDB } from '@/shared/db/database';

/**
 * Issue #47: DB v5→v6 migration（Bookmark tags 回填）。
 *
 * Bookmark 新增 tags 字符串数组。v6 迁移需在 versionchange 事务内为全部历史
 * Bookmark 回填空 tags 数组，保留现有实体、字段、索引和排序数据。
 * 禁用 putRecord（开新事务与 versionchange 并行→中断升级），必须用 upgrade 回调注入的 tx。
 */

/** v5 schema + 无 tags 的旧 bookmark，模拟升级到 v6 的用户库 */
async function seedV5Database(): Promise<void> {
  const v5 = await openDB(DB_NAME, 5, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('workspaces')) db.createObjectStore('workspaces', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('categories')) {
        const s = db.createObjectStore('categories', { keyPath: 'id' });
        s.createIndex('by-workspaceId', 'workspaceId');
      }
      if (!db.objectStoreNames.contains('bookmarks')) {
        const s = db.createObjectStore('bookmarks', { keyPath: 'id' });
        s.createIndex('by-workspaceId', 'workspaceId');
        s.createIndex('by-categoryId', 'categoryId');
      }
      if (!db.objectStoreNames.contains('contexts')) {
        const s = db.createObjectStore('contexts', { keyPath: 'id' });
        s.createIndex('by-bookmarkId', 'bookmarkId');
      }
      if (!db.objectStoreNames.contains('cryptoMetadata')) db.createObjectStore('cryptoMetadata', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('favicons')) db.createObjectStore('favicons', { keyPath: 'hostname' });
      if (!db.objectStoreNames.contains('pinnedTabs')) {
        const s = db.createObjectStore('pinnedTabs', { keyPath: 'id' });
        s.createIndex('by-workspaceId', 'workspaceId');
      }
    },
  });

  await v5.put('workspaces', { id: 'ws-A', name: 'A', icon: '📁', createdAt: 1, order: 0 } satisfies Workspace);
  await v5.put('workspaces', { id: 'ws-B', name: 'B', icon: '📁', createdAt: 1, order: 1 } satisfies Workspace);
  await v5.put('categories', { id: 'cat-A', workspaceId: 'ws-A', name: '工具', icon: '📂', order: 0, createdAt: 1 } satisfies Category);
  await v5.put('categories', { id: 'cat-B', workspaceId: 'ws-B', name: '私藏', icon: '📂', order: 0, createdAt: 1 } satisfies Category);

  // v5 旧书签：故意不写 tags（模拟 v5 库），已有 order 字段（v5 已回填）
  const raw = (id: string, categoryId: string, workspaceId: string, createdAt: number, order: number) => ({
    id, workspaceId, categoryId, name: id, url: `https://${id}.com`,
    description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false,
    createdAt, updatedAt: createdAt, order,
  });
  await v5.put('bookmarks', raw('bm-A1', 'cat-A', 'ws-A', 5, 0));
  await v5.put('bookmarks', raw('bm-A2', 'cat-A', 'ws-A', 10, 1));
  await v5.put('bookmarks', raw('bm-B1', 'cat-B', 'ws-B', 1, 0));

  v5.close();
}

afterEach(async () => {
  // resetDB 只清缓存 promise；先 close 底层连接再删库，否则 deleteDatabase 永远 blocked。
  try {
    const db = await getDB();
    db.close();
  } catch {
    // 缓存为空时 getDB 新建连接，忽略本次异常
  }
  resetDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('DB migration v5→v6（Bookmark tags 回填）', () => {
  it('旧书签（无 tags）回填空 tags 数组，保留现有实体、字段、索引和排序数据', async () => {
    await seedV5Database();
    const db = await getDB(); // 触发 v5→v6 升级

    const bmA1 = await db.get('bookmarks', 'bm-A1');
    const bmA2 = await db.get('bookmarks', 'bm-A2');
    const bmB1 = await db.get('bookmarks', 'bm-B1');

    // 全部历史 Bookmark 回填空 tags 数组
    expect(bmA1?.tags).toEqual([]);
    expect(bmA2?.tags).toEqual([]);
    expect(bmB1?.tags).toEqual([]);

    // 现有实体、字段、索引和排序数据保留
    expect(bmA1?.order).toBe(0);
    expect(bmA2?.order).toBe(1);
    expect(bmB1?.order).toBe(0);
    expect(bmA1?.url).toBe('https://bm-A1.com');
    expect(bmA1?.workspaceId).toBe('ws-A');
    expect(bmA1?.categoryId).toBe('cat-A');

    // 索引保留（by-workspaceId / by-categoryId 仍可用）
    const byWsA = await db.getAllFromIndex('bookmarks', 'by-workspaceId', 'ws-A');
    expect(byWsA).toHaveLength(2);
    const byCatB = await db.getAllFromIndex('bookmarks', 'by-categoryId', 'cat-B');
    expect(byCatB).toHaveLength(1);
    expect(byCatB[0]?.id).toBe('bm-B1');
  });

  it('已有 tags 的书签升级后 tags 保留（不覆盖）', async () => {
    await seedV5Database();
    // 手动给 bm-A1 写入 tags（模拟部分已有 tags 的混合库）
    const v5WithTags = await openDB(DB_NAME, 5);
    const existing = await v5WithTags.get('bookmarks', 'bm-A1');
    await v5WithTags.put('bookmarks', { ...existing, tags: ['前端', 'React'] });
    v5WithTags.close();

    const db = await getDB(); // 触发 v5→v6 升级

    const bmA1 = await db.get('bookmarks', 'bm-A1');
    // 已有 tags 的书签不被覆盖
    expect(bmA1?.tags).toEqual(['前端', 'React']);
  });

  it('全新安装（v7）：12 个 store 齐备', async () => {
    const db = await getDB();
    for (const store of [
      'workspaces',
      'categories',
      'bookmarks',
      'contexts',
      'cryptoMetadata',
      'favicons',
      'pinnedTabs',
      'taskLists',
      'tasks',
      'checklistItems',
      'taskTags',
      'taskTagAssignments',
    ]) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
    }
  });

  it('无书签的空库升级不报错', async () => {
    await seedV5Database();
    // 清空 bookmarks store（模拟空库）
    const v5Empty = await openDB(DB_NAME, 5);
    await v5Empty.clear('bookmarks');
    v5Empty.close();

    const db = await getDB();
    const all = await db.getAll('bookmarks');
    expect(all).toHaveLength(0);
  });
});
