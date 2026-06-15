import { putRecord, getByKey, getByIndex, deleteBookmarkCascade } from '@/shared/db/database';
import type { Bookmark } from '@/shared/types';

function generateId(): string {
  return crypto.randomUUID();
}

/** 获取指定分类下的书签 */
export async function listBookmarks(categoryId: string): Promise<Bookmark[]> {
  return getByIndex<Bookmark>('bookmarks', 'by-categoryId', categoryId);
}

/** 获取指定工作区下的所有书签 */
export async function listBookmarksByWorkspace(workspaceId: string): Promise<Bookmark[]> {
  return getByIndex<Bookmark>('bookmarks', 'by-workspaceId', workspaceId);
}

/** 创建书签 */
export async function createBookmark(
  workspaceId: string,
  categoryId: string,
  data: { name: string; url: string; description?: string },
): Promise<Bookmark> {
  const now = Date.now();
  const bookmark: Bookmark = {
    id: generateId(),
    workspaceId,
    categoryId,
    name: data.name,
    url: data.url,
    description: data.description ?? '',
    faviconUrl: '',
    contextCount: 0,
    hasEncryptedContext: false,
    createdAt: now,
    updatedAt: now,
  };
  await putRecord('bookmarks', bookmark);
  return bookmark;
}

/** 更新书签 */
export async function updateBookmark(id: string, updates: Partial<Pick<Bookmark, 'name' | 'url' | 'description' | 'faviconUrl' | 'categoryId' | 'contextCount' | 'hasEncryptedContext'>>): Promise<void> {
  const existing = await getByKey<Bookmark>('bookmarks', id);
  if (!existing) throw new Error('书签不存在');
  const updated: Bookmark = { ...existing, ...updates, updatedAt: Date.now() };
  await putRecord('bookmarks', updated);
}

/** 删除书签（级联删除上下文） */
export async function deleteBookmark(id: string): Promise<void> {
  await deleteBookmarkCascade(id);
}

/** 获取 favicon URL（使用 Google Favicon API） */
export function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
}

/**
 * 按 hostname 严格匹配书签。
 *
 * 遍历书签，提取每条 url 的 hostname（new URL().hostname），
 * 与传入的 hostname 严格相等比较——不做 eTLD+1 归一化，
 * 即 www.google.com ≠ google.com，用户存哪个 host 就匹配哪个 host。
 *
 * 调用方应先用 listBookmarksByWorkspace(workspaceId) 取得某工作区
 * 下的全部书签（workspaceId 维度由此限定），本函数仅在结果中按 hostname 匹配。
 * 同 hostname 多书签全部命中，由渲染层按书签分组展示。
 *
 * 无效 url（解析失败）的书签跳过，不计入结果。
 *
 * @param bookmarks 书签数组（通常为某 workspace 的全部书签）
 * @param hostname 待匹配的 hostname（new URL().hostname 形式）
 * @returns 命中的书签数组
 */
export function findBookmarksByHost(bookmarks: Bookmark[], hostname: string): Bookmark[] {
  return bookmarks.filter((b) => {
    try {
      return new URL(b.url).hostname === hostname;
    } catch {
      return false;
    }
  });
}
