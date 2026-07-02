import { getByKey, getByIndex, getAll, putRecord, deleteRecord } from '@/shared/db/database';
import { encrypt, decrypt, encryptWithKey, decryptWithKey } from '@/services/CryptoService';
import { updateBookmark } from '@/services/BookmarkService';
import type { Context } from '@/shared/types';
import { ContextType } from '@/shared/types';

/** 获取所有上下文（不解密，原始记录）。用于密码迁移/重置遍历。 */
export async function getAllContexts(): Promise<Context[]> {
  return getAll<Context>('contexts');
}

/**
 * 用显式 oldKey/newKey 重加密所有加密上下文（供 changePassword 编排）。
 * 用 oldKey 解密 → 用 newKey 重加密 → 写回。非加密上下文跳过。
 */
export async function reencryptAllContexts(
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<void> {
  const all = await getAll<Context>('contexts');
  for (const ctx of all) {
    if (!ctx.isEncrypted || !ctx.encryptedData || !ctx.iv) continue;
    const plaintext = await decryptWithKey(oldKey, ctx.encryptedData, ctx.iv);
    const { encryptedData, iv } = await encryptWithKey(newKey, plaintext);
    await putRecord('contexts', {
      ...ctx,
      encryptedData,
      iv,
      updatedAt: Date.now(),
    });
  }
}

/** 获取书签的所有上下文（明文），按 createdAt 升序。
 *  容错：密文上下文若解密失败（未解锁/密钥不可用）→ 保留加密占位（content 不解密，isEncrypted 保留），
 *  明文与已解密上下文正常返回——支持上下文级粒度（明文始终可见，密文单独 gate）。 */
export async function getContexts(bookmarkId: string): Promise<Context[]> {
  const contexts = await getByIndex<Context>('contexts', 'by-bookmarkId', bookmarkId);
  const result: Context[] = [];
  for (const ctx of contexts) {
    if (ctx.isEncrypted && ctx.encryptedData && ctx.iv) {
      try {
        const plaintext = await decrypt(ctx.encryptedData, ctx.iv);
        result.push({ ...ctx, content: plaintext });
      } catch {
        // 未解锁（密钥不可用）：保留加密占位，明文不泄露
        result.push(ctx);
      }
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
