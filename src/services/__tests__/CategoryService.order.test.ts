import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/shared/types';
import { getDB, resetDB, putRecord } from '@/shared/db/database';
import * as CategoryService from '@/services/CategoryService';

async function putCategory(opts: {
  id: string;
  workspaceId?: string;
  order: number;
  createdAt?: number;
}): Promise<void> {
  await putRecord('categories', {
    id: opts.id,
    workspaceId: opts.workspaceId ?? 'w',
    name: opts.id,
    icon: '📁',
    order: opts.order,
    createdAt: opts.createdAt ?? 0,
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

describe('createCategory — 新建 order = maxOrder+1(单事务防并发)', () => {
  it('追加到末尾:连续 order [0,1] → 新建 order=2', async () => {
    await putCategory({ id: 'c1', order: 0 });
    await putCategory({ id: 'c2', order: 1 });
    const created = await CategoryService.createCategory('w', 'nc', '📁');
    expect(created.order).toBe(2);
  });

  it('删洞回归:建 [0,1,2] 删中间 → 新建 order=maxOrder+1=3,非 length=2', async () => {
    await putCategory({ id: 'c1', order: 0 });
    await putCategory({ id: 'c2', order: 1 });
    await putCategory({ id: 'c3', order: 2 });
    await CategoryService.deleteCategory('c2');
    const created = await CategoryService.createCategory('w', 'nc', '📁');
    expect(created.order).toBe(3); // maxOrder(2)+1
  });
});

describe('reorderCategories — 单事务校验 + full-rewrite(per-workspace)', () => {
  it('按 orderedIds 重排该工作区的分类:full-rewrite order 0..N', async () => {
    await putCategory({ id: 'c1', workspaceId: 'w', order: 0 });
    await putCategory({ id: 'c2', workspaceId: 'w', order: 1 });
    await putCategory({ id: 'c3', workspaceId: 'w', order: 2 });
    await CategoryService.reorderCategories('w', ['c2', 'c1', 'c3']);
    const list = await CategoryService.listCategories('w');
    expect(list.map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
    expect(list.map((c) => c.order)).toEqual([0, 1, 2]);
  });

  it('拒绝重复 ID → throw', async () => {
    await putCategory({ id: 'c1', workspaceId: 'w', order: 0 });
    await putCategory({ id: 'c2', workspaceId: 'w', order: 1 });
    await expect(CategoryService.reorderCategories('w', ['c1', 'c1'])).rejects.toThrow('重复');
  });
});
