import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/shared/types';
import type { Category, Workspace } from '@/shared/types';
import { getDB, resetDB } from '@/shared/db/database';

/**
 * T1: DB v4→v5 migration(Bookmark order 回填)。
 *
 * 拖拽排序 0.1.12 给 Bookmark 加 order。v5 迁移需在 versionchange 事务内 cursor 遍历
 * bookmarks,按 categoryId 分组、组内 (createdAt ASC, id ASC) 回填 order=0,1,2...
 * 禁用 putRecord(开新事务与 versionchange 并行→中断升级),必须用 upgrade 回调注入的 tx。
 */

/** v4 schema(含 pinnedTabs)+ 无 order 的旧 bookmark,模拟 0.1.11.x 用户库升级到 v5 */
async function seedV4Database(): Promise<void> {
  const v4 = await openDB(DB_NAME, 4, {
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

  await v4.put('workspaces', { id: 'ws-A', name: 'A', icon: '📁', createdAt: 1, order: 0 } satisfies Workspace);
  await v4.put('workspaces', { id: 'ws-B', name: 'B', icon: '📁', createdAt: 1, order: 1 } satisfies Workspace);
  await v4.put('categories', { id: 'cat-A', workspaceId: 'ws-A', name: '工具', icon: '📂', order: 0, createdAt: 1 } satisfies Category);
  await v4.put('categories', { id: 'cat-B', workspaceId: 'ws-B', name: '私藏', icon: '📂', order: 0, createdAt: 1 } satisfies Category);

  // v4 旧书签:故意不写 order(模拟 v4 库)。createdAt / id 均打乱,验证 (createdAt ASC, id ASC)。
  const raw = (id: string, categoryId: string, workspaceId: string, createdAt: number) => ({
    id, workspaceId, categoryId, name: id, url: `https://${id}.com`,
    description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false,
    createdAt, updatedAt: createdAt,
  });
  await v4.put('bookmarks', raw('bm-A2', 'cat-A', 'ws-A', 5));
  await v4.put('bookmarks', raw('bm-A1', 'cat-A', 'ws-A', 10));
  await v4.put('bookmarks', raw('bm-A3', 'cat-A', 'ws-A', 10));
  await v4.put('bookmarks', raw('bm-B1', 'cat-B', 'ws-B', 1));

  v4.close();
}

afterEach(async () => {
  // resetDB 只清缓存 promise;先 close 底层连接再删库,否则 deleteDatabase 永远 blocked。
  try {
    const db = await getDB();
    db.close();
  } catch {
    // 缓存为空时 getDB 新建连接,忽略本次异常
  }
  resetDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('DB migration v4→v5(Bookmark order 回填)', () => {
  it('旧书签(无 order)按 categoryId 分组、组内 (createdAt ASC, id ASC) 回填 order,组内无重复', async () => {
    await seedV4Database();
    const db = await getDB(); // 触发 v4→v5 升级

    const bmA2 = await db.get('bookmarks', 'bm-A2');
    const bmA1 = await db.get('bookmarks', 'bm-A1');
    const bmA3 = await db.get('bookmarks', 'bm-A3');
    const bmB1 = await db.get('bookmarks', 'bm-B1');

    // cat-A:createdAt ASC(5 < 10);同 createdAt=10 按 id ASC('bm-A1' < 'bm-A3')
    expect(bmA2?.order).toBe(0);
    expect(bmA1?.order).toBe(1);
    expect(bmA3?.order).toBe(2);
    // cat-B 独立分组,从 0 起(跨分类不连号)
    expect(bmB1?.order).toBe(0);

    // 组内无重复:cat-A 的 order 集合 === {0,1,2}
    const ordersA = [bmA2?.order, bmA1?.order, bmA3?.order];
    expect(new Set(ordersA).size).toBe(3);
  });
});
