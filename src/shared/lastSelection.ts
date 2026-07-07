/**
 * 工作区/分类"上次选中"持久化的共享常量与回退逻辑。
 *
 * - workspace 用全局 key（工作区是顶层实体，跨入口共享一份"上次用的工作区"）。
 * - category 用 per-workspace map key：分类是工作区作用域的，单 key 会在多工作区
 *   切换时静默丢失前一个工作区的分类偏好（切回 A 拿不到 A 的 last-cat）。
 *
 * 读写落在 chrome.storage.local；调用方负责 try/catch 容错（home 首屏关键路径）。
 */

/** 全局：上次选中的工作区 id */
export const LAST_WS_KEY = 'lastWorkspaceId';

/** per-workspace map：{ [workspaceId]: categoryId } */
export const LAST_CAT_BY_WS_KEY = 'lastCategoryIdByWs';

/** 上次选中的分类（per-workspace）映射表 */
export type LastCatMap = Record<string, string>;

/**
 * 解析上次的 workspace id：仍在列表中则用，否则回退第一个，空列表返回 null。
 */
export function resolveLastWs(
  lastId: string | undefined,
  workspaces: { id: string }[],
): string | null {
  if (lastId && workspaces.some((w) => w.id === lastId)) return lastId;
  return workspaces[0]?.id ?? null;
}

/**
 * 解析上次的 category id（针对指定工作区）：map[wsId] 仍在该工作区分类列表中则用，
 * 否则回退第一个，空列表返回 null。
 */
export function resolveLastCat(
  wsId: string,
  categories: { id: string }[],
  catMap: LastCatMap,
): string | null {
  const last = catMap[wsId];
  if (last && categories.some((c) => c.id === last)) return last;
  return categories[0]?.id ?? null;
}
