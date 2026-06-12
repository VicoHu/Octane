import { getByKey, getByIndex, putRecord, deleteRecord } from '@/shared/db/database';
import { encrypt, decrypt } from '@/services/CryptoService';
import { updateBookmark } from '@/services/BookmarkService';
import type { Context } from '@/shared/types';
import { ContextType } from '@/shared/types';

/** 获取书签的所有上下文（明文），按 createdAt 升序 */
export async function getContexts(bookmarkId: string): Promise<Context[]> {
  const contexts = await getByIndex<Context>('contexts', 'by-bookmarkId', bookmarkId);
  const result: Context[] = [];
  for (const ctx of contexts) {
    if (ctx.isEncrypted && ctx.encryptedData && ctx.iv) {
      const plaintext = await decrypt(ctx.encryptedData, ctx.iv);
      result.push({ ...ctx, content: plaintext });
    } else {
      result.push(ctx);
    }
  }
  return result.sort((a, b) => a.createdAt - b.createdAt);
}

/** 获取单个上下文（明文） */
export async function getContext(id: string): Promise<Context | null> {
  const ctx = await getByKey<Context>('contexts', id);
  if (!ctx) return null;

  if (ctx.isEncrypted && ctx.encryptedData && ctx.iv) {
    const plaintext = await decrypt(ctx.encryptedData, ctx.iv);
    return { ...ctx, content: plaintext };
  }
  return ctx;
}

/** 创建上下文 */
export async function createContext(
  bookmarkId: string,
  type: ContextType,
  title: string,
  content: string,
  sensitive: boolean,
): Promise<Context> {
  const now = Date.now();
  const id = crypto.randomUUID();

  let ctx: Context;
  if (sensitive && content) {
    const { encryptedData, iv } = await encrypt(content);
    ctx = {
      id,
      bookmarkId,
      type,
      title,
      content: '',
      isEncrypted: true,
      encryptedData,
      iv,
      order: 0,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    ctx = {
      id,
      bookmarkId,
      type,
      title,
      content,
      isEncrypted: false,
      order: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  await putRecord('contexts', ctx);
  await syncContextMeta(bookmarkId);
  return { ...ctx, content }; // 返回明文
}

/** 更新上下文 */
export async function updateContext(
  id: string,
  updates: { title?: string; content?: string; sensitive?: boolean },
): Promise<void> {
  const existing = await getByKey<Context>('contexts', id);
  if (!existing) throw new Error('上下文不存在');

  const now = Date.now();
  const content = updates.content ?? existing.content;
  const sensitive = updates.sensitive ?? existing.isEncrypted;
  const title = updates.title ?? existing.title;

  let ctx: Context;
  if (sensitive && content) {
    const { encryptedData, iv } = await encrypt(content);
    ctx = {
      ...existing,
      title,
      content: '',
      isEncrypted: true,
      encryptedData,
      iv,
      updatedAt: now,
    };
  } else {
    ctx = {
      ...existing,
      title,
      content,
      isEncrypted: false,
      encryptedData: undefined,
      iv: undefined,
      updatedAt: now,
    };
  }

  await putRecord('contexts', ctx);
  await syncContextMeta(existing.bookmarkId);
}

/** 删除上下文 */
export async function deleteContext(id: string): Promise<void> {
  const existing = await getByKey<Context>('contexts', id);
  if (!existing) return;

  await deleteRecord('contexts', id);
  await syncContextMeta(existing.bookmarkId);
}

/**
 * 同步 Bookmark 上的 contextCount / hasEncryptedContext 冗余字段。
 * 在每次创建、删除上下文或变更加密状态后调用。
 */
export async function syncContextMeta(bookmarkId: string): Promise<void> {
  const contexts = await getByIndex<Context>('contexts', 'by-bookmarkId', bookmarkId);
  const contextCount = contexts.length;
  const hasEncryptedContext = contexts.some((c) => c.isEncrypted);
  await updateBookmark(bookmarkId, { contextCount, hasEncryptedContext });
}
