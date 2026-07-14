import { getAll, putRecord, getByKey, getDB, broadcastChange, cascadeDeleteWorkspace } from '@/shared/db/database';
import { nextOrder, validateOrderedIds } from '@/shared/utils/order';
import type { Workspace } from '@/shared/types';

function generateId(): string {
  return crypto.randomUUID();
}

/** 获取所有工作区，按 order 排序 */
export async function listWorkspaces(): Promise<Workspace[]> {
  const all = await getAll<Workspace>('workspaces');
  return all.sort((a, b) => a.order - b.order);
}

/** 创建工作区(单 readwrite 事务:read maxOrder + put 同事务,防并发重复 order) */
export async function createWorkspace(name: string, icon: string): Promise<Workspace> {
  const db = await getDB();
  const tx = db.transaction('workspaces', 'readwrite');
  const store = tx.objectStore('workspaces');
  const existing = await store.getAll();
  const order = nextOrder(existing); // maxOrder+1(删洞安全,非 length)
  const workspace: Workspace = {
    id: generateId(),
    name,
    icon,
    createdAt: Date.now(),
    order,
  };
  await store.put(workspace);
  await tx.done;
  broadcastChange('workspaces', 'put');
  return workspace;
}

/**
 * 重排全部工作区(全局,无 containerId)。校验:无重复 ID 且输入集合 === 全部 workspace ID。
 * 单 readwrite 事务 full-rewrite 0..N + 广播。
 */
export async function reorderWorkspaces(orderedIds: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('workspaces', 'readwrite');
  const store = tx.objectStore('workspaces');
  const existing = await store.getAll();
  const err = validateOrderedIds(orderedIds, existing.map((w) => w.id));
  if (err) throw new Error(err);
  const byId = new Map(existing.map((w) => [w.id, w]));
  for (let i = 0; i < orderedIds.length; i++) {
    const w = byId.get(orderedIds[i]!)!;
    w.order = i;
    await store.put(w);
  }
  await tx.done;
  broadcastChange('workspaces', 'put');
}

/** 更新工作区 */
export async function updateWorkspace(id: string, updates: Partial<Pick<Workspace, 'name' | 'icon' | 'order'>>): Promise<void> {
  const existing = await getByKey<Workspace>('workspaces', id);
  if (!existing) throw new Error('工作区不存在');
  const updated: Workspace = { ...existing, ...updates };
  await putRecord('workspaces', updated);
}

/** 删除工作区（级联删除分类+书签+笔记） */
export async function deleteWorkspace(id: string): Promise<void> {
  await cascadeDeleteWorkspace(id);
}
