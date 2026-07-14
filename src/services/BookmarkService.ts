import { putRecord, getByKey, getByIndex, deleteBookmarkCascade, getDB, broadcastChange } from '@/shared/db/database';
import type { Bookmark } from '@/shared/types';
import { nextOrder, validateOrderedIds } from '@/shared/utils/order';

function generateId(): string {
  return crypto.randomUUID();
}

/** 获取指定分类下的书签,按 order 升序(order 缺失 fallback createdAt,防御 v5 库灌入旧备份) */
export async function listBookmarks(categoryId: string): Promise<Bookmark[]> {
  const list = await getByIndex<Bookmark>('bookmarks', 'by-categoryId', categoryId);
  return list.sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
}

/** 获取指定工作区下的所有书签 */
export async function listBookmarksByWorkspace(workspaceId: string): Promise<Bookmark[]> {
  return getByIndex<Bookmark>('bookmarks', 'by-workspaceId', workspaceId);
}

/** 创建书签 */
/** 创建书签(单 readwrite 事务:read maxOrder + put 同事务,防 MV3 多 context 并发重复 order) */
export async function createBookmark(
  workspaceId: string,
  categoryId: string,
  data: { name: string; url: string; description?: string },
): Promise<Bookmark> {
  const now = Date.now();
  const db = await getDB();
  const tx = db.transaction('bookmarks', 'readwrite');
  const store = tx.objectStore('bookmarks');
  const existing = await store.index('by-categoryId').getAll(categoryId);
  const order = nextOrder(existing); // maxOrder+1(删洞安全,非 length)
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
    order,
  };
  await store.put(bookmark);
  await tx.done;
  broadcastChange('bookmarks', 'put');
  return bookmark;
}

/**
 * 重排分类内书签(单 readwrite 事务:校验读取 + full-rewrite 同事务,防 TOCTOU)。
 * 校验(失败 throw Error,UI catch + Toast):ID 无重复 / 全部属于该 categoryId /
 * 输入集合 === 当前集合(无缺失/多余)。按 orderedIds 赋 0..N full-rewrite。
 */
export async function reorderBookmarks(categoryId: string, orderedBookmarkIds: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('bookmarks', 'readwrite');
  const store = tx.objectStore('bookmarks');
  const existing = await store.index('by-categoryId').getAll(categoryId);
  const err = validateOrderedIds(orderedBookmarkIds, existing.map((b) => b.id));
  if (err) throw new Error(err);
  const byId = new Map(existing.map((b) => [b.id, b]));
  for (let i = 0; i < orderedBookmarkIds.length; i++) {
    const b = byId.get(orderedBookmarkIds[i]!)!;
    b.order = i;
    await store.put(b);
  }
  await tx.done;
  broadcastChange('bookmarks', 'put');
}

/** 更新书签 */
export async function updateBookmark(id: string, updates: Partial<Pick<Bookmark, 'name' | 'url' | 'description' | 'faviconUrl' | 'categoryId' | 'workspaceId' | 'contextCount' | 'hasEncryptedContext'>>): Promise<void> {
  const existing = await getByKey<Bookmark>('bookmarks', id);
  if (!existing) throw new Error('书签不存在');
  const updated: Bookmark = { ...existing, ...updates, updatedAt: Date.now() };
  await putRecord('bookmarks', updated);
}

/**
 * 移动书签到目标工作区/分类(编辑面板「改分类」入口)。
 * 单 readwrite 事务:读 existing + 读目标分类现有 + put 同事务,防并发。
 * order 重分配 = 目标分类 maxOrder+1(末尾追加;排除自身防同分类移动与旧 order 冲突)。
 * store action(T3)改成调本函数,替代旧 updateBookmark({...}) 保留 order 的路径。
 */
export async function moveBookmark(
  id: string,
  targetWorkspaceId: string,
  targetCategoryId: string,
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('bookmarks', 'readwrite');
  const store = tx.objectStore('bookmarks');
  const existing = await store.get(id);
  if (!existing) throw new Error('书签不存在');
  const targetMembers = (await store.index('by-categoryId').getAll(targetCategoryId))
    .filter((b) => b.id !== id);
  const order = nextOrder(targetMembers);
  const updated: Bookmark = {
    ...existing,
    workspaceId: targetWorkspaceId,
    categoryId: targetCategoryId,
    order,
    updatedAt: Date.now(),
  };
  await store.put(updated);
  await tx.done;
  broadcastChange('bookmarks', 'put');
}

/** 删除书签（级联删除上下文） */
export async function deleteBookmark(id: string): Promise<void> {
  await deleteBookmarkCascade(id);
}

/**
 * hostname 是否为本机/内网地址（Google Favicon API 无法索引）。
 * - localhost
 * - *.local（mDNS 局域网域名）
 * - IPv4 / IPv6 字面量（含 127.0.0.1、192.168.x、10.x 等所有 IP）
 */
function isLocalHostname(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (hostname.endsWith('.local')) return true;
  // IPv4 字面量
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // IPv6 字面量（含冒号；new URL().hostname 已剥离端口）
  if (hostname.includes(':')) return true;
  return false;
}

/**
 * @deprecated 自 favicon 本地缓存系统上线后不再使用。保留兼容旧调用方，
 * 新代码请用 FaviconService 的 useFavicon / fetchAndStoreFavicon。
 *
 * 获取 favicon URL。
 *
 * 公网域名走 Google Favicon API；本机/内网地址（localhost、IP、*.local）
 * Google 不可能索引，回退到源站 `${origin}/favicon.ico`——若源站无 favicon，
 * 由 UI 层（BookmarkCard）onError 回退首字母。
 */
export function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    if (isLocalHostname(u.hostname)) {
      return `${u.origin}/favicon.ico`;
    }
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
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
 * 调用方传入待筛选的书签数组（可为全局 getAll('bookmarks') 结果，或某 workspace
 * 子集），本函数仅按 hostname 过滤。同 hostname 多书签全部命中，由渲染层按书签分组展示。
 *
 * 无效 url（解析失败）的书签跳过，不计入结果。
 *
 * @param bookmarks 书签数组（全局或某 workspace 子集）
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
