import type { Bookmark, Category, ShareSelection, Workspace } from '@/shared/types';

/** Semi Tree 节点（仅用 key + children 做转换，与组件 treeData 同构） */
export interface SelectionTreeNode {
  key: string;
  children?: SelectionTreeNode[];
}

/**
 * Semi Tree（multiple + checkRelation='related' + autoMergeValue=true）的 onChange value[]
 * 转 ShareSelection。
 * - workspace key 在 valueKeys → 整选（workspaceIds）
 * - workspace 不在但其 category key 在 → 半选（categoryIds）
 */
export function treeValueToSelection(
  valueKeys: string[],
  tree: SelectionTreeNode[],
): ShareSelection {
  const vset = new Set(valueKeys);
  const workspaceIds: string[] = [];
  const categoryIds: string[] = [];
  for (const ws of tree) {
    if (vset.has(ws.key)) {
      workspaceIds.push(ws.key);
    } else if (ws.children) {
      for (const cat of ws.children) {
        if (vset.has(cat.key)) categoryIds.push(cat.key);
      }
    }
  }
  return { workspaceIds, categoryIds };
}

/** ShareSelection → Semi Tree value[]（受控初始化用） */
export function selectionToTreeValue(sel: ShareSelection): string[] {
  return [...sel.workspaceIds, ...sel.categoryIds];
}

/**
 * 选集数量统计（用于 Modal success 文案「N 工作区 · M 分类 · K 书签」）。
 * 含整选 workspace 连带的分类（与 buildShareData 规范化逻辑一致）。
 */
export function shareStats(
  workspaces: Workspace[],
  categories: Category[],
  bookmarks: Bookmark[],
  selection: ShareSelection,
): { ws: number; cat: number; bm: number } {
  const wsSet = new Set(selection.workspaceIds);
  const catIds = new Set(selection.categoryIds);
  for (const c of categories) {
    if (wsSet.has(c.workspaceId)) catIds.add(c.id);
  }
  // 单选 category 的 parent ws 纳入（与 buildShareData 自洽补全一致——success 文案「N 工作区」含连带的）
  const effectiveWs = new Set(selection.workspaceIds);
  for (const c of categories) {
    if (catIds.has(c.id)) effectiveWs.add(c.workspaceId);
  }
  return {
    ws: workspaces.filter((w) => effectiveWs.has(w.id)).length,
    cat: categories.filter((c) => catIds.has(c.id)).length,
    bm: bookmarks.filter((b) => catIds.has(b.categoryId)).length,
  };
}