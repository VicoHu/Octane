import { arrayMove } from "@dnd-kit/sortable";

/**
 * 排序辅助纯函数（DRY：4 个 reorder API + createXxx 复用）。
 *
 * nextOrder 的 `(x.order ?? -1)` 与 BookmarkService.listBookmarks 的读 fallback
 * `(b.order ?? b.createdAt)` 对称：防 v5 DB 恢复 v3 备份（replaceAllDataRaw 不触发
 * 迁移、DB 已是 v5 schema）时 order 为 undefined → reduce 起点污染 → NaN 崩排序。
 */

/** 计算下一个 order：现有集合最大 order + 1；空集 → 0。order 缺失按 -1 防御。 */
export function nextOrder<T extends { order?: number }>(items: readonly T[]): number {
  return items.reduce((max, x) => Math.max(max, x.order ?? -1), -1) + 1;
}

/**
 * 校验排序 ID 集合与现有集合一致：无重复、无缺失、无多余、全部属于同一容器。
 * 数量不等即覆盖缺失/多余；逐项检查覆盖重复与不属于。
 *
 * @returns 中文错误信息（供 UI catch + Toast）；null 表示合法。
 */
export function validateOrderedIds(orderedIds: readonly string[], existingIds: readonly string[]): string | null {
  if (orderedIds.length !== existingIds.length) {
    return "排序 ID 数量与现有记录不一致（缺失或多余）";
  }
  const existingSet = new Set(existingIds);
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) return "排序 ID 存在重复";
    seen.add(id);
    if (!existingSet.has(id)) return "排序 ID 不属于该容器";
  }
  return null;
}

/**
 * 计算拖拽重排后的 id 序列（UI 拖拽与 service 重排的共享语义）。
 *
 * - active/over 任一不在列表 → null（非法落区，调用方应忽略）
 * - active === over → null（同位无需重排）
 * - 否则返回 arrayMove 后的 id 序列，调用方据此调 store.reorderXxx
 *
 * 抽出为纯函数：供 PinnedManageDialog / 末来同类拖拽组件复用，且可独立测试
 * （dnd-kit pointer 序列在 jsdom 难驱动，排序语义靠此函数覆盖）。
 */
export function computeReorderIds<T extends { id: string }>(
  items: readonly T[],
  activeId: string,
  overId: string,
): string[] | null {
  if (activeId === overId) return null;
  const oldIndex = items.findIndex((x) => x.id === activeId);
  const newIndex = items.findIndex((x) => x.id === overId);
  if (oldIndex < 0 || newIndex < 0) return null;
  return arrayMove([...items], oldIndex, newIndex).map((x) => x.id);
}
