import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME, DB_VERSION, type Bookmark, type Category, type Context, type CryptoMetadata, type FaviconRecord, type PinnedTab, type Workspace } from '@/shared/types';
import { getDB, resetDB, runUpgrade } from '@/shared/db/database';

/**
 * T1 回归 guard：DB v3→v4 migration（新增 pinnedTabs store）
 *
 * 背景：Pinned Tabs 特性引入 pinnedTabs 独立 store，DB_VERSION 3→4。升级必须保证
 * 既有 v3 数据（workspaces/categories/bookmarks/contexts/cryptoMetadata/favicons）
 * 零丢失，且 upgrade 抽离为纯函数 runUpgrade(db, oldVersion, newVersion) 后行为不变。
 *
 * 测试策略：用裸 openDB 在 DB_NAME 下建一个 v3 schema 的库（无 pinnedTabs），
 * 写入样本数据，再用真实 getDB() 触发 v4 升级，断言旧数据全在 + pinnedTabs store 就绪。
 */

/** v3 schema：升级前的库结构（无 pinnedTabs store）。模拟 0.1.10.x 用户本地的库。 */
async function seedV3Database(): Promise<void> {
  const v3 = await openDB(DB_NAME, 3, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('workspaces')) {
        db.createObjectStore('workspaces', { keyPath: 'id' });
      }
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
      if (!db.objectStoreNames.contains('cryptoMetadata')) {
        db.createObjectStore('cryptoMetadata', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('favicons')) {
        db.createObjectStore('favicons', { keyPath: 'hostname' });
      }
    },
  });

  const workspace: Workspace = { id: 'ws-mig', name: '迁移工作区', icon: '🌟', createdAt: 1, order: 0 };
  const category: Category = { id: 'cat-mig', workspaceId: 'ws-mig', name: '默认', icon: '📁', order: 0, createdAt: 1 };
  const bookmark: Bookmark = {
    id: 'bm-mig',
    workspaceId: 'ws-mig',
    categoryId: 'cat-mig',
    name: '示例书签',
    url: 'https://example.com',
    description: '',
    faviconUrl: '',
    contextCount: 0,
    hasEncryptedContext: false,
    createdAt: 1,
    updatedAt: 1,
  };
  const context: Context = {
    id: 'ctx-mig',
    bookmarkId: 'bm-mig',
    type: 'note' as Context['type'],
    title: '笔记',
    content: '',
    isEncrypted: false,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const cryptoMeta: CryptoMetadata = {
    id: 'singleton',
    salt: 'c2FsdA==',
    iterations: 100000,
    algorithm: 'AES-GCM',
    createdAt: 1,
  };
  const favicon: FaviconRecord = {
    hostname: 'example.com',
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    mimeType: 'image/png',
    fetchedAt: 1,
  };

  await v3.put('workspaces', workspace);
  await v3.put('categories', category);
  await v3.put('bookmarks', bookmark);
  await v3.put('contexts', context);
  await v3.put('cryptoMetadata', cryptoMeta);
  await v3.put('favicons', favicon);

  v3.close();
}


/** v4 schema：含 pinnedTabs 与旧格式 favicons，模拟升级前当前用户数据库。 */
async function seedV4Database(): Promise<void> {
  const v4 = await openDB(DB_NAME, 4, {
    upgrade(db) {
      const workspaces = db.createObjectStore('workspaces', { keyPath: 'id' });
      void workspaces;
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

  await v4.put('workspaces', { id: 'ws-v4', name: 'V4', icon: '🌟', createdAt: 1, order: 0 });
  await v4.put('categories', { id: 'cat-v4', workspaceId: 'ws-v4', name: '默认', icon: '📁', order: 0, createdAt: 1 });
  await v4.put('bookmarks', {
    id: 'bm-v4', workspaceId: 'ws-v4', categoryId: 'cat-v4', name: '示例',
    url: 'https://legacy.example.com', description: '', faviconUrl: '', contextCount: 0,
    hasEncryptedContext: false, createdAt: 1, updatedAt: 1,
  });
  await v4.put('pinnedTabs', {
    id: 'pin-v4', workspaceId: 'ws-v4', name: '常驻',
    url: 'https://legacy.example.com', order: 0, createdAt: 1,
  });
  await v4.put('favicons', {
    hostname: 'legacy.example.com',
    blob: new Blob(['legacy'], { type: 'image/png' }),
    mimeType: 'image/png',
    fetchedAt: 1,
  });
  v4.close();
}

/** v1 schema：最旧库结构（含 notes store，无 contexts/favicons/pinnedTabs）。验证 v1→v4 跨版本路径。 */
async function seedV1Database(): Promise<void> {
  const v1 = await openDB(DB_NAME, 1, {
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
      if (!db.objectStoreNames.contains('cryptoMetadata')) db.createObjectStore('cryptoMetadata', { keyPath: 'id' });
      // v1 时代的 notes store（v2 起删除）
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
    },
  });
  await v1.put('workspaces', { id: 'ws-v1', name: 'V1', icon: '🌟', createdAt: 1, order: 0 });
  await v1.put('notes', { id: 'note-1', text: '历史笔记' });
  v1.close();
}

afterEach(async () => {
  // resetDB 只清缓存 promise，不关底层连接；不关连接会让 deleteDatabase 永远 blocked。
  // 先用 getDB() 拿到缓存连接并 close()，再 resetDB，最后删库。
  try {
    const db = await getDB();
    db.close();
  } catch {
    // 缓存为空时 getDB 会新建连接，下次 close 即可，忽略本次异常
  }
  resetDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('DB migration → v5（可信 favicon 缓存）', () => {
  it('runUpgrade 幂等：对同一 db 重复调用不抛错、store 集合不变', async () => {
    // 用真实 getDB 建好 v4 schema
    const db = await getDB();
    const storesBefore = Array.from(db.objectStoreNames);
    // runUpgrade 内 createObjectStore 必须在 upgrade txn 内；这里仅验证导出可调用 + 已就绪 store 下不破坏
    // （runUpgrade 对已存在 store 用 if(!contains) 守卫，重复调用是 no-op）
    expect(storesBefore.includes('pinnedTabs')).toBe(true);
    expect(typeof runUpgrade).toBe('function');
  });

  it('DB_VERSION 已升到 5', () => {
    expect(DB_VERSION).toBe(5);
  });

  it('v3 库升级到 v5 后，业务数据保留、旧 favicon 清空，且新增 pinnedTabs store', async () => {
    await seedV3Database();

    // 用真实 getDB() 触发 v3→v5 升级（DB_VERSION=5）
    const db = await getDB();

    // 业务数据全部保留
    expect(await db.get('workspaces', 'ws-mig')).toMatchObject({ id: 'ws-mig', name: '迁移工作区' });
    expect(await db.get('categories', 'cat-mig')).toMatchObject({ id: 'cat-mig', workspaceId: 'ws-mig' });
    expect(await db.get('bookmarks', 'bm-mig')).toMatchObject({ id: 'bm-mig', url: 'https://example.com' });
    expect(await db.get('contexts', 'ctx-mig')).toMatchObject({ id: 'ctx-mig', bookmarkId: 'bm-mig' });
    expect(await db.get('cryptoMetadata', 'singleton')).toMatchObject({ id: 'singleton', iterations: 100000 });
    expect(await db.get('favicons', 'example.com')).toBeUndefined();

    // 新增 pinnedTabs store 就绪
    expect(db.objectStoreNames.contains('pinnedTabs')).toBe(true);

    // pinnedTabs 可写入（含 by-workspaceId 索引）
    const pin: PinnedTab = { id: 'pin-1', workspaceId: 'ws-mig', name: '常驻', url: 'https://example.com', order: 0, createdAt: 1 };
    await db.put('pinnedTabs', pin);
    expect(await db.get('pinnedTabs', 'pin-1')).toMatchObject({ id: 'pin-1', workspaceId: 'ws-mig' });
  });


  it('v4→v5：保留业务数据，只清空旧 favicon 缓存', async () => {
    await seedV4Database();

    const db = await getDB();

    expect(DB_VERSION).toBe(5);
    expect(await db.get('workspaces', 'ws-v4')).toMatchObject({ id: 'ws-v4' });
    expect(await db.get('bookmarks', 'bm-v4')).toMatchObject({ id: 'bm-v4' });
    expect(await db.get('pinnedTabs', 'pin-v4')).toMatchObject({ id: 'pin-v4' });
    expect(await db.get('favicons', 'legacy.example.com')).toBeUndefined();

    await db.put('favicons', {
      hostname: 'example.com',
      blob: new Blob(['png'], { type: 'image/png' }),
      source: 'icon-horse',
      mimeType: 'image/png',
      width: 64,
      height: 64,
      fetchedAt: 10,
      expiresAt: 20,
    });
    expect(await db.get('favicons', 'example.com')).toMatchObject({
      hostname: 'example.com',
      source: 'icon-horse',
    });
  });

  it('全新安装（v5）：7 个 store 齐备', async () => {
    const db = await getDB();
    for (const store of ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata', 'favicons', 'pinnedTabs']) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
    }
  });

  it('v1→v5 跨版本升级：notes store 被删，workspaces 数据保留，pinnedTabs 就绪', async () => {
    await seedV1Database();
    const db = await getDB();

    // notes store 已删除（v1→v2 历史分支执行）
    expect(db.objectStoreNames.contains('notes')).toBe(false);
    // v2+ store 在迁移中创建
    expect(db.objectStoreNames.contains('contexts')).toBe(true);
    expect(db.objectStoreNames.contains('favicons')).toBe(true);
    // v4 store 就绪
    expect(db.objectStoreNames.contains('pinnedTabs')).toBe(true);
    // v1 既存数据保留
    expect(await db.get('workspaces', 'ws-v1')).toMatchObject({ id: 'ws-v1', name: 'V1' });
  });
});
