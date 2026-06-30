import type { Bookmark, Workspace, Category } from '@/shared/types';

export interface CategoryGroup {
  categoryId: string;
  /** 分类元数据；null = 孤儿引用（已删除/导入损坏） */
  category: { name: string; icon: string } | null;
  bookmarks: Bookmark[];
}

export interface WorkspaceGroup {
  workspaceId: string;
  /** 工作区元数据；null = 孤儿引用（归入尾部「其他」段） */
  workspace: { name: string; icon: string } | null;
  categories: CategoryGroup[];
}

/**
 * 把按 hostname 命中的书签按 workspaceId → categoryId 聚合成可渲染的分组树。
 *
 * - 排序：Workspace.order → Category.order → Bookmark.createdAt 升序
 * - 孤儿引用（workspaceId/categoryId 在 source 中已不存在）→ workspace/category=null，
 *   归入尾部「其他」段，绝不渲染 undefined
 *
 * 纯函数，无副作用，便于单测。
 */
export function groupBookmarksByWorkspace(
  bookmarks: Bookmark[],
  workspaces: Workspace[],
  categories: Category[],
): WorkspaceGroup[] {
  const wsMap = new Map(workspaces.map((w) => [w.id, w]));
  const catMap = new Map(categories.map((c) => [c.id, c]));

  // 孤儿引用统一归入哨兵 bucket（尾部单一「其他」段），避免散落多个 null 组
  const ORPHAN = '__orphan__';

  // 按 workspaceId → categoryId 聚合（找不到的归 ORPHAN）
  const byWs = new Map<string, Map<string, Bookmark[]>>();
  for (const b of bookmarks) {
    const wsId = wsMap.has(b.workspaceId) ? b.workspaceId : ORPHAN;
    if (!byWs.has(wsId)) byWs.set(wsId, new Map());
    const byCat = byWs.get(wsId)!;
    const catId = catMap.has(b.categoryId) ? b.categoryId : ORPHAN;
    if (!byCat.has(catId)) byCat.set(catId, []);
    byCat.get(catId)!.push(b);
  }

  const groups: WorkspaceGroup[] = [];
  for (const [wsId, byCat] of byWs) {
    const ws = wsMap.get(wsId) ?? null;
    const catGroups: CategoryGroup[] = [];
    for (const [catId, bms] of byCat) {
      const cat = catMap.get(catId) ?? null;
      bms.sort((a, b) => a.createdAt - b.createdAt);
      catGroups.push({
        categoryId: catId,
        category: cat ? { name: cat.name, icon: cat.icon } : null,
        bookmarks: bms,
      });
    }
    // 分类序：有 order 的按 order，孤儿(Infinity) 最后
    catGroups.sort((a, b) => {
      const oa = a.category ? catMap.get(a.categoryId)!.order : Infinity;
      const ob = b.category ? catMap.get(b.categoryId)!.order : Infinity;
      return oa - ob;
    });
    groups.push({
      workspaceId: wsId,
      workspace: ws ? { name: ws.name, icon: ws.icon } : null,
      categories: catGroups,
    });
  }

  // 工作区序：有 order 的按 order，孤儿(Infinity) 最后
  groups.sort((a, b) => {
    const oa = a.workspace ? wsMap.get(a.workspaceId)!.order : Infinity;
    const ob = b.workspace ? wsMap.get(b.workspaceId)!.order : Infinity;
    return oa - ob;
  });
  return groups;
}
