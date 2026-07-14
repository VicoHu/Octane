import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME, BACKUP_SCHEMA } from '@/shared/types';
import { getDB, resetDB, putRecord, exportAllData, replaceAllDataRaw } from '@/shared/db/database';
import * as BookmarkService from '@/services/BookmarkService';
import { validateBackup } from '@/services/BackupService';

async function putBookmark(opts: {
  id: string;
  categoryId?: string;
  order?: number;
  createdAt?: number;
}): Promise<void> {
  await putRecord('bookmarks', {
    id: opts.id,
    workspaceId: 'w',
    categoryId: opts.categoryId ?? 'c',
    name: opts.id,
    url: 'https://x.com',
    description: '',
    faviconUrl: '',
    contextCount: 0,
    hasEncryptedContext: false,
    createdAt: opts.createdAt ?? 0,
    updatedAt: opts.createdAt ?? 0,
    ...(opts.order === undefined ? {} : { order: opts.order }),
  });
}

afterEach(async () => {
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

describe('导出 + 全量恢复 — bookmark order 往返保留', () => {
  it('exportAllData → replaceAllDataRaw 往返:order 原样保留,不被重排', async () => {
    await putRecord('workspaces', { id: 'w', name: 'w', icon: '📁', createdAt: 0, order: 0 });
    await putRecord('categories', { id: 'c', workspaceId: 'w', name: 'c', icon: '📁', order: 0, createdAt: 0 });
    await putBookmark({ id: 'b1', order: 2 });
    await putBookmark({ id: 'b2', order: 0 });
    await putBookmark({ id: 'b3', order: 1 });
    const data = await exportAllData();
    await replaceAllDataRaw(data);
    const list = await BookmarkService.listBookmarks('c');
    expect(list.map((b) => b.id)).toEqual(['b2', 'b3', 'b1']); // order 0,1,2 保留
    expect(list.map((b) => b.order)).toEqual([0, 1, 2]);
  });
});

describe('validateBackup — 旧版本(v1/v2/v3)bookmark 无 order 回填', () => {
  it('v3 备份 bookmark 无 order → 按 categoryId 分组(createdAt ASC, id ASC)回填,与 DB 迁移一致', () => {
    const parsed = {
      schema: BACKUP_SCHEMA,
      version: 3,
      kind: 'backup',
      exportedAt: 1,
      appVersion: 'x',
      data: {
        workspaces: [{ id: 'w', name: 'w', icon: '📁', createdAt: 1, order: 0 }],
        categories: [
          { id: 'cat-A', workspaceId: 'w', name: 'A', icon: '📁', order: 0, createdAt: 1 },
          { id: 'cat-B', workspaceId: 'w', name: 'B', icon: '📁', order: 1, createdAt: 1 },
        ],
        bookmarks: [
          { id: 'bm-A2', workspaceId: 'w', categoryId: 'cat-A', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 5, updatedAt: 5 },
          { id: 'bm-A1', workspaceId: 'w', categoryId: 'cat-A', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 10, updatedAt: 10 },
          { id: 'bm-A3', workspaceId: 'w', categoryId: 'cat-A', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 10, updatedAt: 10 },
          { id: 'bm-B1', workspaceId: 'w', categoryId: 'cat-B', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 },
        ],
        contexts: [],
        pinnedTabs: [],
        cryptoMetadata: null,
      },
    };
    const result = validateBackup(parsed);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('should be ok');
    const byId = new Map(result.data.bookmarks.map((b) => [b.id, b]));
    // cat-A:createdAt ASC(5 < 10),同 10 按 id ASC(bm-A1 < bm-A3);cat-B 独立从 0
    expect(byId.get('bm-A2')?.order).toBe(0);
    expect(byId.get('bm-A1')?.order).toBe(1);
    expect(byId.get('bm-A3')?.order).toBe(2);
    expect(byId.get('bm-B1')?.order).toBe(0);
  });

  it('v4 备份 bookmark 已有 order → 原样保留,不重排', () => {
    const parsed = {
      schema: BACKUP_SCHEMA,
      version: 4,
      kind: 'backup',
      exportedAt: 1,
      appVersion: 'x',
      data: {
        workspaces: [{ id: 'w', name: 'w', icon: '📁', createdAt: 1, order: 0 }],
        categories: [{ id: 'c', workspaceId: 'w', name: 'c', icon: '📁', order: 0, createdAt: 1 }],
        bookmarks: [
          { id: 'b1', workspaceId: 'w', categoryId: 'c', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1, order: 5 },
        ],
        contexts: [],
        pinnedTabs: [],
        cryptoMetadata: null,
      },
    };
    const result = validateBackup(parsed);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('should be ok');
    expect(result.data.bookmarks[0]?.order).toBe(5); // 原样保留,不重排为 0
  });
});
