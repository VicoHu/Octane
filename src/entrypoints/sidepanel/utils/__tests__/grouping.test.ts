import { describe, it, expect } from 'vitest';
import { groupBookmarksByWorkspace, defaultExpandedIds } from '../grouping';
import type { Bookmark, Workspace, Category } from '@/shared/types';

/** Workspace 工厂 */
function makeWs(overrides: Partial<Workspace> = {}): Workspace {
  return { id: 'w1', name: '工作区1', icon: '🗂', createdAt: 0, order: 0, ...overrides };
}
/** Category 工厂（默认属于 w1） */
function makeCat(overrides: Partial<Category> = {}): Category {
  return { id: 'c1', workspaceId: 'w1', name: '分类1', icon: '📁', order: 0, createdAt: 0, ...overrides };
}
/** Bookmark 工厂（默认属于 w1/c1） */
function makeBm(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'b1', workspaceId: 'w1', categoryId: 'c1', name: 'github.com', url: 'https://github.com',
    description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 0,
    createdAt: 1000, updatedAt: 1000, tags: [], ...overrides,
  };
}

describe('groupBookmarksByWorkspace — 来源分组纯函数', () => {
  it('TG1 跨工作区跨分类命中 → 按 workspaceId→categoryId 聚合', () => {
    const wss = [makeWs({ id: 'w1' }), makeWs({ id: 'w2', name: '工作区2' })];
    const cats = [
      makeCat({ id: 'c1', workspaceId: 'w1' }),
      makeCat({ id: 'c2', workspaceId: 'w2', name: '分类2' }),
    ];
    const bms = [
      makeBm({ id: 'b1', workspaceId: 'w1', categoryId: 'c1' }),
      makeBm({ id: 'b2', workspaceId: 'w2', categoryId: 'c2' }),
    ];
    const groups = groupBookmarksByWorkspace(bms, wss, cats);
    expect(groups).toHaveLength(2);
    // 每个工作区一个分类段，每段一个书签
    const w1 = groups.find((g) => g.workspaceId === 'w1')!;
    expect(w1.workspace?.name).toBe('工作区1');
    expect(w1.categories).toHaveLength(1);
    expect(w1.categories[0]!.bookmarks).toHaveLength(1);
    const w2 = groups.find((g) => g.workspaceId === 'w2')!;
    expect(w2.categories[0]!.category?.name).toBe('分类2');
  });

  it('TG2 排序：Workspace.order → Category.order → Bookmark.createdAt 升序', () => {
    // w2 order=1 应排在 w1 order=99 之前
    const wss = [makeWs({ id: 'w1', order: 99 }), makeWs({ id: 'w2', order: 1, name: '靠前' })];
    // c2 order=1 应排在 c1 order=99 之前（同工作区 w1）；c3 属 w2
    const cats = [
      makeCat({ id: 'c1', workspaceId: 'w1', order: 99 }),
      makeCat({ id: 'c2', workspaceId: 'w1', order: 1, name: '靠前分类' }),
      makeCat({ id: 'c3', workspaceId: 'w2', order: 0 }),
    ];
    const bms = [
      makeBm({ id: 'b1', workspaceId: 'w1', categoryId: 'c1', createdAt: 500 }),
      makeBm({ id: 'b2', workspaceId: 'w1', categoryId: 'c1', createdAt: 300 }),
      makeBm({ id: 'b3', workspaceId: 'w1', categoryId: 'c2', createdAt: 1 }),
      makeBm({ id: 'b4', workspaceId: 'w2', categoryId: 'c3', createdAt: 1 }),
    ];
    const groups = groupBookmarksByWorkspace(bms, wss, cats);
    // 工作区序：w2(order1) 在 w1(order99) 前
    expect(groups.map((g) => g.workspaceId)).toEqual(['w2', 'w1']);
    // w1 内分类序：c2(order1) 在 c1(order99) 前
    const w1 = groups.find((g) => g.workspaceId === 'w1')!;
    expect(w1.categories.map((c) => c.categoryId)).toEqual(['c2', 'c1']);
    // c1 内书签序：createdAt 300 在 500 前
    const c1 = w1.categories.find((c) => c.categoryId === 'c1')!;
    expect(c1.bookmarks.map((b) => b.id)).toEqual(['b2', 'b1']);
  });

  it('TG3 孤儿 workspaceId/categoryId → workspace/category=null，不 crash', () => {
    // 书签引用了已删除的工作区/分类（导入损坏、级联删除竞态）
    const bms = [
      makeBm({ id: 'b1', workspaceId: 'w-gone', categoryId: 'c-gone' }),
      makeBm({ id: 'b2', workspaceId: 'w1', categoryId: 'c1' }),
    ];
    const wss = [makeWs({ id: 'w1', order: 0 })];
    const cats = [makeCat({ id: 'c1', order: 0 })];
    const groups = groupBookmarksByWorkspace(bms, wss, cats);
    // 孤儿组排在工作区之后，workspace/category 为 null
    const orphan = groups.find((g) => g.workspace === null);
    expect(orphan).toBeTruthy();
    expect(orphan!.categories[0]!.category).toBeNull();
    expect(orphan!.categories[0]!.bookmarks[0]!.id).toBe('b1');
    // 正常组在前
    expect(groups[0]!.workspaceId).toBe('w1');
  });

  it('TG4 空 matched → 空分组', () => {
    expect(groupBookmarksByWorkspace([], [makeWs()], [makeCat()])).toEqual([]);
  });
});

describe('defaultExpandedIds — Collapse 默认展开策略（T2）', () => {
  /** 构造一个含 N 条书签的工作区分组（单分类） */
  function groupWith(wsId: string, count: number): ReturnType<typeof groupBookmarksByWorkspace>[number] {
    const bookmarks = Array.from({ length: count }, (_, i) =>
      makeBm({ id: `${wsId}-b${i}`, workspaceId: wsId, categoryId: `${wsId}-c`, createdAt: i }),
    );
    return {
      workspaceId: wsId,
      workspace: { name: wsId, icon: '🗂' },
      categories: [{ categoryId: `${wsId}-c`, category: { name: 'cat', icon: '📁' }, bookmarks }],
    };
  }

  it('T2-a 总命中 ≤6 → 全部工作区展开', () => {
    const groups = [groupWith('w1', 2), groupWith('w2', 3)]; // total 5
    expect(defaultExpandedIds(groups).sort()).toEqual(['w1', 'w2']);
  });

  it('T2-b 总命中 >6 → 仅展开命中最多的工作区', () => {
    const groups = [groupWith('w1', 6), groupWith('w2', 1)]; // total 7
    expect(defaultExpandedIds(groups)).toEqual(['w1']);
  });

  it('T2-c 空分组 → 空展开集', () => {
    expect(defaultExpandedIds([])).toEqual([]);
  });
});
