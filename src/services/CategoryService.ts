import { putRecord, getByKey, getByIndex, getDB, broadcastChange, cascadeDeleteCategory } from '@/shared/db/database';
import { nextOrder, validateOrderedIds } from '@/shared/utils/order';
import type { Category } from '@/shared/types';

function generateId(): string {
  return crypto.randomUUID();
}

/** 获取指定工作区的分类，按 order 排序 */
export async function listCategories(workspaceId: string): Promise<Category[]> {
  const categories = await getByIndex<Category>('categories', 'by-workspaceId', workspaceId);
  return categories.sort((a, b) => a.order - b.order);
}

/** 创建分类(单 readwrite 事务:read maxOrder + put 同事务,防并发重复 order) */
export async function createCategory(
  workspaceId: string,
  name: string,
  icon: string,
): Promise<Category> {
  const db = await getDB();
  const tx = db.transaction('categories', 'readwrite');
  const store = tx.objectStore('categories');
  const existing = await store.index('by-workspaceId').getAll(workspaceId);
  const order = nextOrder(existing); // maxOrder+1(删洞安全,非 length)
  const category: Category = {
    id: generateId(),
    workspaceId,
    name,
    icon,
    order,
    createdAt: Date.now(),
  };
  await store.put(category);
  await tx.done;
  broadcastChange('categories', 'put');
  return category;
}

/**
 * 重排工作区内分类(per-workspace)。单 readwrite 事务:校验读取 + full-rewrite 同事务,
 * 防 TOCTOU。校验失败 throw Error;按 orderedIds 赋 0..N。
 */
export async function reorderCategories(workspaceId: string, orderedIds: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('categories', 'readwrite');
  const store = tx.objectStore('categories');
  const existing = await store.index('by-workspaceId').getAll(workspaceId);
  const err = validateOrderedIds(orderedIds, existing.map((c) => c.id));
  if (err) throw new Error(err);
  const byId = new Map(existing.map((c) => [c.id, c]));
  for (let i = 0; i < orderedIds.length; i++) {
    const c = byId.get(orderedIds[i]!)!;
    c.order = i;
    await store.put(c);
  }
  await tx.done;
  broadcastChange('categories', 'put');
}

/** 更新分类 */
export async function updateCategory(id: string, updates: Partial<Pick<Category, 'name' | 'icon' | 'order'>>): Promise<void> {
  const existing = await getByKey<Category>('categories', id);
  if (!existing) throw new Error('分类不存在');
  const updated: Category = { ...existing, ...updates };
  await putRecord('categories', updated);
}

/** 删除分类（级联删除书签+笔记） */
export async function deleteCategory(id: string): Promise<void> {
  await cascadeDeleteCategory(id);
}
