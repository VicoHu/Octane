import { describe, it, expect, beforeEach } from 'vitest';
import { wsHash, makeGroupTitle, findGroupByIdentity } from '../tabGroupIdentity';

describe('tabGroupIdentity', () => {
  it('wsHash：去横线前 8 hex，跨重启稳定', () => {
    expect(wsHash('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400');
    expect(wsHash('550E8400-e29b-41d4')).toBe('550e8400'); // 小写化
  });

  it('makeGroupTitle：工作区名 + 标识后缀', () => {
    expect(makeGroupTitle('工作', '550e8400-e29b-41d4')).toBe('工作 ·550e8400');
  });

  describe('findGroupByIdentity', () => {
    beforeEach(() => {
      // 种子 tabGroups（用 setup.ts 注入的 __testGroups）
      const c = (globalThis as any).chrome;
      c.__testGroups.clear();
      c.__testGroups.set(100, { id: 100, windowId: 1, title: '工作 ·550e8400', color: 'grey', collapsed: false });
      c.__testGroups.set(101, { id: 101, windowId: 1, title: '学习 ·abc12345', color: 'grey', collapsed: true });
    });

    it('唯一命中返回 groupId', async () => {
      const gid = await findGroupByIdentity(1, '550e8400-e29b-41d4');
      expect(gid).toBe(100);
    });

    it('未命中返回 null（走兜底 restore）', async () => {
      expect(await findGroupByIdentity(1, '00000000-0000-0000')).toBeNull();
    });

    it('多结果歧义返回 null（不任选，走兜底）', async () => {
      const c = (globalThis as any).chrome;
      c.__testGroups.set(102, { id: 102, windowId: 1, title: '副本 ·550e8400', color: 'grey', collapsed: false });
      expect(await findGroupByIdentity(1, '550e8400-e29b-41d4')).toBeNull();
    });
  });
});
