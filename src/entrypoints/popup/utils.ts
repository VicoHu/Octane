import type { Bookmark } from '@/shared/types';

/**
 * 校验 URL 是否合法（仅允许 http/https 协议）。
 *
 * Popup 表单用：拒绝 chrome://、chrome-extension://、本地文件、
 * 无协议字符串等无法作为书签目标的内容。
 */
export function isUrlValid(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 在已有书签中查找重复 URL。
 *
 * 去重维度：workspaceId + categoryId + url。
 * 调用方应先用 `listBookmarksByWorkspace(workspaceId)` 取得某工作区
 * 下的全部书签（workspaceId 维度由此限定），本函数仅在结果中按
 * categoryId + url 精确匹配——同一工作区不同分类允许重复。
 *
 * 不做 URL 规范化：尾部斜杠等差异视为不同 URL。
 *
 * @returns 命中的书签；无重复返回 null
 */
export function findDuplicateUrl(
  bookmarks: Bookmark[],
  categoryId: string,
  url: string,
): Bookmark | null {
  return bookmarks.find((b) => b.categoryId === categoryId && b.url === url) ?? null;
}
