import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME } from '@/shared/types';
import { getDB, resetDB, putRecord } from '@/shared/db/database';
import * as WorkspaceService from '@/services/WorkspaceService';

async function putWorkspace(opts: { id: string; order: number; createdAt?: number }): Promise<void> {
  await putRecord('workspaces', {
    id: opts.id,
    name: opts.id,
    icon: '📁',
    createdAt: opts.createdAt ?? 0,
    order: opts.order,
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

describe('createWorkspace — 新建 order = maxOrder+1(单事务防并发)', () => {
  it('追加到末尾:连续 order [0,1] → 新建 order=2', async () => {
    await putWorkspace({ id: 'w1', order: 0 });
    await putWorkspace({ id: 'w2', order: 1 });
    const created = await WorkspaceService.createWorkspace('nw', '📁');
    expect(created.order).toBe(2);
  });

  it('删洞回归:建 [0,1,2] 删中间 → 新建 order=maxOrder+1=3,非 length=2', async () => {
    await putWorkspace({ id: 'w1', order: 0 });
    await putWorkspace({ id: 'w2', order: 1 });
    await putWorkspace({ id: 'w3', order: 2 });
    await WorkspaceService.deleteWorkspace('w2');
    const created = await WorkspaceService.createWorkspace('nw', '📁');
    expect(created.order).toBe(3); // maxOrder(2)+1
  });
});

describe('reorderWorkspaces — 单事务校验 + full-rewrite(全局,无 containerId)', () => {
  it('按 orderedIds 重排全部工作区:full-rewrite order 0..N', async () => {
    await putWorkspace({ id: 'w1', order: 0 });
    await putWorkspace({ id: 'w2', order: 1 });
    await putWorkspace({ id: 'w3', order: 2 });
    await WorkspaceService.reorderWorkspaces(['w3', 'w1', 'w2']);
    const list = await WorkspaceService.listWorkspaces();
    expect(list.map((w) => w.id)).toEqual(['w3', 'w1', 'w2']);
    expect(list.map((w) => w.order)).toEqual([0, 1, 2]);
  });

  it('拒绝缺失/多余 ID(数量不等)→ throw', async () => {
    await putWorkspace({ id: 'w1', order: 0 });
    await putWorkspace({ id: 'w2', order: 1 });
    await expect(WorkspaceService.reorderWorkspaces(['w1'])).rejects.toThrow();
  });
});
