import { getAll, putRecord, getByKey } from '@/shared/db/database';
import { cascadeDeleteWorkspace } from '@/shared/db/database';
import type { Workspace } from '@/shared/types';

function generateId(): string {
  return crypto.randomUUID();
}

/** 获取所有工作区，按 order 排序 */
export async function listWorkspaces(): Promise<Workspace[]> {
  const all = await getAll<Workspace>('workspaces');
  return all.sort((a, b) => a.order - b.order);
}

/** 创建工作区 */
export async function createWorkspace(name: string, icon: string): Promise<Workspace> {
  const all = await listWorkspaces();
  const workspace: Workspace = {
    id: generateId(),
    name,
    icon,
    createdAt: Date.now(),
    order: all.length,
  };
  await putRecord('workspaces', workspace);
  return workspace;
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
