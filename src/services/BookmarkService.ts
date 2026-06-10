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
    hasNote: false,
    isNoteEncrypted: false,
    createdAt: now,
    updatedAt: now,
  };
  await putRecord('bookmarks', bookmark);
  return bookmark;
}

/** 更新书签 */
export async function updateBookmark(id: string, updates: Partial<Pick<Bookmark, 'name' | 'url' | 'description' | 'faviconUrl' | 'categoryId' | 'hasNote' | 'isNoteEncrypted'>>): Promise<void> {
  const existing = await getByKey<Bookmark>('bookmarks', id);
  if (!existing) throw new Error('书签不存在');
  const updated: Bookmark = { ...existing, ...updates, updatedAt: Date.now() };
  await putRecord('bookmarks', updated);
}

/** 删除书签（级联删除笔记） */
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
