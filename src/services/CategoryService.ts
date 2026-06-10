import { putRecord, getByKey, getByIndex } from '@/shared/db/database';
import { cascadeDeleteCategory } from '@/shared/db/database';
import type { Category } from '@/shared/types';

function generateId(): string {
  return crypto.randomUUID();
}

/** 获取指定工作区的分类，按 order 排序 */
export async function listCategories(workspaceId: string): Promise<Category[]> {
  const categories = await getByIndex<Category>('categories', 'by-workspaceId', workspaceId);
  return categories.sort((a, b) => a.order - b.order);
}

/** 创建分类 */
export async function createCategory(
  workspaceId: string,
  name: string,
  icon: string,
): Promise<Category> {
  const existing = await listCategories(workspaceId);
  const category: Category = {
    id: generateId(),
    workspaceId,
    name,
    icon,
    order: existing.length,
    createdAt: Date.now(),
  };
  await putRecord('categories', category);
  return category;
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
