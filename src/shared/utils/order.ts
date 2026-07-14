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
export function validateOrderedIds(
  orderedIds: readonly string[],
  existingIds: readonly string[],
): string | null {
  if (orderedIds.length !== existingIds.length) {
    return '排序 ID 数量与现有记录不一致（缺失或多余）';
  }
  const existingSet = new Set(existingIds);
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (seen.has(id)) return '排序 ID 存在重复';
    seen.add(id);
    if (!existingSet.has(id)) return '排序 ID 不属于该容器';
  }
  return null;
}
