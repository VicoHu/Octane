import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { getDB, resetDB } from '@/shared/db/database';
import * as PinnedTabService from '../PinnedTabService';

/** 清空 pinnedTabs store，隔离每个用例。 */
async function clearPinnedTabs(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pinnedTabs', 'readwrite');
  await tx.objectStore('pinnedTabs').clear();
  await tx.done;
}

afterEach(async () => {
  await clearPinnedTabs();
  resetDB();
});

describe('PinnedTabService', () => {
  describe('createPinnedTab', () => {
    it('拒绝非 http/https scheme（防御 javascript:/data: 等危险 URL 落库）', async () => {
      await expect(
        PinnedTabService.createPinnedTab('ws-1', { name: 'X', url: 'javascript:alert(1)' }),
      ).rejects.toThrow('http/https');
      await expect(
        PinnedTabService.createPinnedTab('ws-1', { name: 'X', url: 'data:text/html,<script>' }),
      ).rejects.toThrow('http/https');
      await expect(
        PinnedTabService.createPinnedTab('ws-1', { name: 'X', url: 'ftp://example.com' }),
      ).rejects.toThrow('http/https');
    });

    it('拒绝无法解析的 URL', async () => {
      await expect(
        PinnedTabService.createPinnedTab('ws-1', { name: 'X', url: '不是有效链接' }),
      ).rejects.toThrow('无效');
      // 确保危险/无效 URL 都没落库
      const db = await getDB();
      expect(await db.count('pinnedTabs')).toBe(0);
    });

    it('写入并返回完整 PinnedTab（含 id/workspaceId/order/createdAt）', async () => {
      const pin = await PinnedTabService.createPinnedTab('ws-1', {
        name: 'GitHub',
        url: 'https://github.com',
      });

      expect(pin.id).toEqual(expect.any(String));
      expect(pin.workspaceId).toBe('ws-1');
      expect(pin.name).toBe('GitHub');
      expect(pin.url).toBe('https://github.com');
      expect(pin.order).toBe(0);
      expect(pin.createdAt).toEqual(expect.any(Number));

      // 真实落库
      const db = await getDB();
      const stored = await db.get('pinnedTabs', pin.id);
      expect(stored).toMatchObject({ id: pin.id, url: 'https://github.com' });
    });

    it('多条追加：order 按 0/1/2 递增', async () => {
      await PinnedTabService.createPinnedTab('ws-1', { name: 'A', url: 'https://a.com' });
      await PinnedTabService.createPinnedTab('ws-1', { name: 'B', url: 'https://b.com' });
      const third = await PinnedTabService.createPinnedTab('ws-1', { name: 'C', url: 'https://c.com' });
      expect(third.order).toBe(2);
    });

    it('dedup：同工作区同 URL 再创建抛错', async () => {
      await PinnedTabService.createPinnedTab('ws-1', { name: 'GitHub', url: 'https://github.com' });
      await expect(
        PinnedTabService.createPinnedTab('ws-1', { name: '别名', url: 'https://github.com' }),
      ).rejects.toThrow('URL');
    });

    it('dedup 规范化：trailing slash / 大小写 / hash 视为同一条', async () => {
      await PinnedTabService.createPinnedTab('ws-1', { name: 'GitHub', url: 'https://github.com' });
      // trailing slash
      await expect(
        PinnedTabService.createPinnedTab('ws-1', { name: 'A', url: 'https://github.com/' }),
      ).rejects.toThrow('URL');
      // 大写 host
      await expect(
        PinnedTabService.createPinnedTab('ws-1', { name: 'B', url: 'HTTPS://GitHub.COM' }),
      ).rejects.toThrow('URL');
      // 带 hash
      await expect(
        PinnedTabService.createPinnedTab('ws-1', { name: 'C', url: 'https://github.com#readme' }),
      ).rejects.toThrow('URL');
    });

    it('dedup 保留 query 语义：不同 query 视为不同条目', async () => {
      await PinnedTabService.createPinnedTab('ws-1', { name: 'A', url: 'https://github.com?a=1' });
      await expect(
        PinnedTabService.createPinnedTab('ws-1', { name: 'B', url: 'https://github.com?a=2' }),
      ).resolves.toMatchObject({ url: 'https://github.com?a=2' });
    });

    it('dedup 跨工作区允许：不同 ws 同 URL 不冲突', async () => {
      await PinnedTabService.createPinnedTab('ws-1', { name: 'GitHub', url: 'https://github.com' });
      await expect(
        PinnedTabService.createPinnedTab('ws-2', { name: 'GitHub', url: 'https://github.com' }),
      ).resolves.toMatchObject({ workspaceId: 'ws-2' });
    });

    it('cap：第 9 条抛错（PINNED_TAB_CAP=8），message 含「上限」', async () => {
      for (let i = 0; i < 8; i++) {
        await PinnedTabService.createPinnedTab('ws-1', { name: `T${i}`, url: `https://t${i}.com` });
      }
      await expect(
        PinnedTabService.createPinnedTab('ws-1', { name: '第9', url: 'https://t8.com' }),
      ).rejects.toThrow('上限');
    });

    it('cap 边界：第 8 条成功创建且 order=7', async () => {
      for (let i = 0; i < 7; i++) {
        await PinnedTabService.createPinnedTab('ws-1', { name: `T${i}`, url: `https://t${i}.com` });
      }
      const eighth = await PinnedTabService.createPinnedTab('ws-1', { name: 'T8', url: 'https://t7.com' });
      expect(eighth.order).toBe(7);
    });

    it('order 删除后不碰撞：删除中间项后再创建，order 取 max+1', async () => {
      // 建 3 条：order 0/1/2
      await PinnedTabService.createPinnedTab('ws-1', { name: 'A', url: 'https://a.com' });
      await PinnedTabService.createPinnedTab('ws-1', { name: 'B', url: 'https://b.com' });
      const c = await PinnedTabService.createPinnedTab('ws-1', { name: 'C', url: 'https://c.com' });
      expect(c.order).toBe(2);
      // 删除中间项 B（order=1）
      const before = await PinnedTabService.listByWorkspace('ws-1');
      const bId = before.find((p) => p.name === 'B')!.id;
      await PinnedTabService.deletePinnedTab(bId);
      // 再创建：order 应为 max(0,2)+1 = 3，不复用 1 也不撞 2
      const d = await PinnedTabService.createPinnedTab('ws-1', { name: 'D', url: 'https://d.com' });
      expect(d.order).toBe(3);
      const list = await PinnedTabService.listByWorkspace('ws-1');
      // order 值唯一
      const orders = list.map((p) => p.order);
      expect(new Set(orders).size).toBe(orders.length);
    });
  });

  describe('listByWorkspace', () => {
    it('只返回该工作区的 tabs，按 order 升序', async () => {
      await PinnedTabService.createPinnedTab('ws-1', { name: 'A', url: 'https://a.com' });
      await PinnedTabService.createPinnedTab('ws-2', { name: 'X', url: 'https://x.com' });
      await PinnedTabService.createPinnedTab('ws-1', { name: 'B', url: 'https://b.com' });

      const list = await PinnedTabService.listByWorkspace('ws-1');
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.name)).toEqual(['A', 'B']);
      expect(list.every((p) => p.workspaceId === 'ws-1')).toBe(true);
    });

    it('空工作区返回 []', async () => {
      const list = await PinnedTabService.listByWorkspace('ws-empty');
      expect(list).toEqual([]);
    });
  });

  describe('deletePinnedTab', () => {
    it('按 id 删除记录', async () => {
      const pin = await PinnedTabService.createPinnedTab('ws-1', { name: 'A', url: 'https://a.com' });
      await PinnedTabService.deletePinnedTab(pin.id);

      const db = await getDB();
      expect(await db.get('pinnedTabs', pin.id)).toBeUndefined();
    });
  });
});
