/**
 * Bookmark Tag 规则模块（Issue #47）。
 *
 * 集中实现 Tag 的清理、校验、大小写不敏感去重和上限控制，
 * 作为创建、编辑、筛选和导入共用的规则 interface，各入口不重复实现规则。
 */

/** 单个 Tag 最大长度（trim 后）。 */
export const MAX_TAG_LENGTH = 32;

/** 每个 Bookmark 最多 Tag 数量（去重后）。 */
export const MAX_TAG_COUNT = 20;

/**
 * 校验并清理单个 Tag：
 * 1. 去除首尾空白
 * 2. 结果必须非空
 * 3. 结果不含任何空白字符（空格 / Tab / 换行）
 * 4. 长度不超过 MAX_TAG_LENGTH
 *
 * @returns 合法的 Tag 字符串（已 trim）；非法 → null
 */
export function validateTag(tag: string): string | null {
  const trimmed = tag.trim();
  if (trimmed === '') return null;
  // 不含任何空白字符（含内部空格、Tab、换行等）
  if (/\s/.test(trimmed)) return null;
  if (trimmed.length > MAX_TAG_LENGTH) return null;
  return trimmed;
}

/**
 * 批量规范化 Tag：校验清理 + 大小写不敏感去重 + 数量上限。
 *
 * - 每个输入经 validateTag 校验，非法值被过滤。
 * - 同一 Bookmark 内按大小写不敏感规则去重，保留首次出现的展示形式。
 * - 去重后若超过 MAX_TAG_COUNT，截断到上限（保留添加顺序的前 N 个）。
 *
 * @param rawTags 原始输入数组
 * @returns 规范化后的 Tag 数组（合法、去重、≤ MAX_TAG_COUNT）
 */
export function normalizeTags(rawTags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawTags) {
    const tag = validateTag(raw);
    if (tag === null) continue;
    const lower = tag.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(tag);
    if (result.length >= MAX_TAG_COUNT) break;
  }
  return result;
}

/**
 * 从书签列表构建 Tag 建议：
 * 统计每个 Tag 的使用次数 → 按使用次数降序、名称升序排序。
 *
 * 数据源是当前 Workspace 的全部 Bookmark（已在内存），无需额外索引。
 * 用于 TagInput 建议列表。
 *
 * @param bookmarks 当前 Workspace 的书签数组
 * @returns 建议列表（去重，按使用次数降序 + 名称排序）
 */
export function buildTagSuggestions(
  bookmarks: readonly { tags?: readonly string[] }[],
): string[] {
  // 统计：大小写不敏感去重，保留首次出现的展示形式
  const countMap = new Map<string, number>();
  const displayMap = new Map<string, string>();

  for (const bookmark of bookmarks) {
    if (!bookmark.tags) continue;
    for (const tag of bookmark.tags) {
      const lower = tag.toLowerCase();
      countMap.set(lower, (countMap.get(lower) ?? 0) + 1);
      if (!displayMap.has(lower)) displayMap.set(lower, tag);
    }
  }

  return Array.from(countMap.entries())
    .map(([lower, count]) => ({ tag: displayMap.get(lower)!, count, lower }))
    .sort((a, b) => {
      // 使用次数降序 → 名称升序（稳定次序）
      if (b.count !== a.count) return b.count - a.count;
      return a.lower.localeCompare(b.lower);
    })
    .map((e) => e.tag);
}
