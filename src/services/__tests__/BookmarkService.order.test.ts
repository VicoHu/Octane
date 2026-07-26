import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/shared/types';
import type { Bookmark } from '@/shared/types';
import { getDB, resetDB, putRecord, getByKey } from '@/shared/db/database';
import * as BookmarkService from '@/services/BookmarkService';

/** 测试用书签写入:order 可省略(模拟 v5 库灌入无 order 的旧备份) */
async function putBookmark(opts: {
  id: string;
  workspaceId?: string;
  categoryId?: string;
  createdAt?: number;
  order?: number;
  url?: string;
}): Promise<void> {
  await putRecord('bookmarks', {
    id: opts.id,
    workspaceId: opts.workspaceId ?? 'w',
    categoryId: opts.categoryId ?? 'c',
    name: opts.id,
    url: opts.url ?? 'https://x.com',
    description: '',
    faviconUrl: '',
    contextCount: 0,
    hasEncryptedContext: false,
    createdAt: opts.createdAt ?? 0,
    updatedAt: opts.createdAt ?? 0,
    tags: [],
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

describe('listBookmarks — order 排序', () => {
  it('按 order 升序返回(非 createdAt、非插入顺序)', async () => {
    await putBookmark({ id: 'b1', order: 2, createdAt: 1 });
    await putBookmark({ id: 'b2', order: 0, createdAt: 2 });
    await putBookmark({ id: 'b3', order: 1, createdAt: 3 });

    const list = await BookmarkService.listBookmarks('c');
    expect(list.map((b) => b.id)).toEqual(['b2', 'b3', 'b1']); // order 0,1,2
  });

  it('order 缺失(v5 库灌入 v3 备份,replaceAllDataRaw 不触发迁移)→ 按 createdAt 升序 fallback', async () => {
    // putRecord 写无 order 对象(structured clone 丢弃 undefined → DB 记录无 order 字段)
    await putRecord('bookmarks', {
      id: 'b1', workspaceId: 'w', categoryId: 'c', name: 'b1', url: 'u',
      description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false,
      createdAt: 10, updatedAt: 10, tags: [],
    });
    await putRecord('bookmarks', {
      id: 'b2', workspaceId: 'w', categoryId: 'c', name: 'b2', url: 'u',
      description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false,
      createdAt: 5, updatedAt: 5, tags: [],
    });

    const list = await BookmarkService.listBookmarks('c');
    expect(list.map((b) => b.id)).toEqual(['b2', 'b1']); // createdAt 5 < 10
  });
});

describe('createBookmark — 新建 order = maxOrder+1(单事务防并发)', () => {
  it('追加到末尾:连续 order [0,1] → 新建 order=2', async () => {
    await putBookmark({ id: 'b1', categoryId: 'c', order: 0 });
    await putBookmark({ id: 'b2', categoryId: 'c', order: 1 });
    const created = await BookmarkService.createBookmark('w', 'c', { name: 'nb', url: 'https://n.com' });
    expect(created.order).toBe(2);
  });

  it('新建书签 tags 默认为空数组(Issue #47 数据契约)', async () => {
    const created = await BookmarkService.createBookmark('w', 'c', { name: 'nb', url: 'https://n.com' });
    expect(created.tags).toEqual([]);
    // 持久化数据也带 tags
    const persisted = await getByKey<Bookmark>('bookmarks', created.id);
    expect(persisted?.tags).toEqual([]);
  });

  it('删洞回归:建 [0,1,2] 删中间 → 新建 order=maxOrder+1=3,非 length=2', async () => {
    await putBookmark({ id: 'b1', categoryId: 'c', order: 0 });
    await putBookmark({ id: 'b2', categoryId: 'c', order: 1 });
    await putBookmark({ id: 'b3', categoryId: 'c', order: 2 });
    await BookmarkService.deleteBookmark('b2');
    const created = await BookmarkService.createBookmark('w', 'c', { name: 'nb', url: 'https://n.com' });
    expect(created.order).toBe(3); // maxOrder(2)+1
  });
});

describe('reorderBookmarks — 单事务校验 + full-rewrite', () => {
  it('按 orderedIds 重排:full-rewrite order 为 0..N', async () => {
    await putBookmark({ id: 'b1', categoryId: 'c', order: 0 });
    await putBookmark({ id: 'b2', categoryId: 'c', order: 1 });
    await putBookmark({ id: 'b3', categoryId: 'c', order: 2 });
    await BookmarkService.reorderBookmarks('c', ['b3', 'b2', 'b1']);
    const list = await BookmarkService.listBookmarks('c');
    expect(list.map((b) => b.id)).toEqual(['b3', 'b2', 'b1']);
    expect(list.map((b) => b.order)).toEqual([0, 1, 2]);
  });

  it('拒绝重复 ID → throw 且不改动现有 order', async () => {
    await putBookmark({ id: 'b1', categoryId: 'c', order: 0 });
    await putBookmark({ id: 'b2', categoryId: 'c', order: 1 });
    await expect(BookmarkService.reorderBookmarks('c', ['b1', 'b1'])).rejects.toThrow('重复');
    const list = await BookmarkService.listBookmarks('c');
    expect(list.map((b) => b.id)).toEqual(['b1', 'b2']); // 原 order 未动
  });

  it('拒绝缺失 ID(数量不等)→ throw', async () => {
    await putBookmark({ id: 'b1', categoryId: 'c', order: 0 });
    await putBookmark({ id: 'b2', categoryId: 'c', order: 1 });
    await expect(BookmarkService.reorderBookmarks('c', ['b1'])).rejects.toThrow();
  });

  it('拒绝跨 categoryId 的 ID(不属于该分类)→ throw', async () => {
    await putBookmark({ id: 'b1', categoryId: 'c', order: 0 });
    await putBookmark({ id: 'b3', categoryId: 'c', order: 1 });
    await putBookmark({ id: 'b2', categoryId: 'other', order: 0 });
    await expect(BookmarkService.reorderBookmarks('c', ['b1', 'b2'])).rejects.toThrow('不属于');
  });
});

describe('moveBookmark — 移动后 order 重分配为目标分类 maxOrder+1', () => {
  it('跨分类移动:目标分类已有 [0,1] → 移入书签 order=2(末尾追加)', async () => {
    await putBookmark({ id: 'b1', categoryId: 'src', order: 0 });
    await putBookmark({ id: 't1', categoryId: 'dst', order: 0 });
    await putBookmark({ id: 't2', categoryId: 'dst', order: 1 });
    await BookmarkService.moveBookmark('b1', 'w', 'dst');
    const moved = await getByKey<Bookmark>('bookmarks', 'b1');
    expect(moved?.categoryId).toBe('dst');
    expect(moved?.order).toBe(2); // dst maxOrder(1)+1
  });

  it('同分类移动(改 workspaceId 场景):order 重分配为该分类 maxOrder+1(排除自身防冲突)', async () => {
    await putBookmark({ id: 'b1', categoryId: 'c', order: 0 });
    await putBookmark({ id: 'b2', categoryId: 'c', order: 1 });
    await putBookmark({ id: 'b3', categoryId: 'c', order: 2 });
    await BookmarkService.moveBookmark('b1', 'w', 'c');
    const moved = await getByKey<Bookmark>('bookmarks', 'b1');
    expect(moved?.order).toBe(3); // 排除自身后 max(1,2)+1
  });
});
