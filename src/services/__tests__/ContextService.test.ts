import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetDB, getDB, putRecord, getByKey } from '@/shared/db/database';
import {
  setTestKey,
  encryptWithKey,
  decryptWithKey,
} from '@/services/CryptoService';
import { reencryptAllContexts, getContexts, getContextsRaw } from '@/services/ContextService';
import { ContextType } from '@/shared/types';
import type { Context } from '@/shared/types';

/** 测试专用 PBKDF2→AES-GCM 派生（隔离于 CryptoService 私有 deriveKey） */
async function deriveKeyLocal(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const storeNames = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...storeNames], 'readwrite');
  for (const name of storeNames) {
    await tx.objectStore(name).clear();
  }
  await tx.done;
}

beforeEach(async () => {
  resetDB();
  setTestKey(null);
  await getDB();
  await clearAllStores();
});

afterAll(() => {
  resetDB();
  setTestKey(null);
});

describe('reencryptAllContexts（changePassword 重加密）', () => {
  it('用 oldKey→newKey 重加密所有加密上下文，新 key 可解密、旧 key 失败', async () => {
    const iterations = 10_000; // 测试用低迭代加速
    const oldKey = await deriveKeyLocal('old-pass', crypto.getRandomValues(new Uint8Array(16)), iterations);
    const newKey = await deriveKeyLocal('new-pass', crypto.getRandomValues(new Uint8Array(16)), iterations);
    setTestKey(oldKey);

    // 写入两条加密上下文（不同明文）+ 一条非加密上下文
    const enc1 = await encryptWithKey(oldKey, '第一条秘密');
    const enc2 = await encryptWithKey(oldKey, '第二条秘密');
    const ctx1: Context = {
      id: 'c1', bookmarkId: 'bm1', type: ContextType.NOTE, title: 't1',
      content: '', isEncrypted: true, encryptedData: enc1.encryptedData, iv: enc1.iv,
      order: 0, createdAt: 1, updatedAt: 1,
    };
    const ctx2: Context = {
      id: 'c2', bookmarkId: 'bm2', type: ContextType.NOTE, title: 't2',
      content: '', isEncrypted: true, encryptedData: enc2.encryptedData, iv: enc2.iv,
      order: 0, createdAt: 2, updatedAt: 2,
    };
    const ctxPlain: Context = {
      id: 'c3', bookmarkId: 'bm1', type: ContextType.NOTE, title: 't3',
      content: '明文', isEncrypted: false, order: 0, createdAt: 3, updatedAt: 3,
    };
    await putRecord('contexts', ctx1);
    await putRecord('contexts', ctx2);
    await putRecord('contexts', ctxPlain);

    await reencryptAllContexts(oldKey, newKey);

    const after1 = await getByKey<Context>('contexts', 'c1');
    const after2 = await getByKey<Context>('contexts', 'c2');
    const after3 = await getByKey<Context>('contexts', 'c3');

    // 新 key 可解密
    expect(await decryptWithKey(newKey, after1!.encryptedData!, after1!.iv!)).toBe('第一条秘密');
    expect(await decryptWithKey(newKey, after2!.encryptedData!, after2!.iv!)).toBe('第二条秘密');
    // 旧 key 解密失败（AES-GCM OperationError）
    await expect(decryptWithKey(oldKey, after1!.encryptedData!, after1!.iv!)).rejects.toThrow();
    // 非加密上下文保持不变
    expect(after3!.isEncrypted).toBe(false);
    expect(after3!.content).toBe('明文');
  });
});

describe('getContexts 上下文级容错（未解锁密文保留占位）', () => {
  it('未解锁时：明文正常返回，密文保留占位不解密（content 空，isEncrypted 保留）', async () => {
    setTestKey(null); // 模拟未解锁（无派生 key）
    const key = await deriveKeyLocal('pwd', crypto.getRandomValues(new Uint8Array(16)), 10_000);
    const enc = await encryptWithKey(key, '秘密内容');

    await putRecord('contexts', {
      id: 'c-plain', bookmarkId: 'bm1', type: ContextType.NOTE, title: '明文条目',
      content: '明文内容', isEncrypted: false, order: 0, createdAt: 1, updatedAt: 1,
    });
    await putRecord('contexts', {
      id: 'c-enc', bookmarkId: 'bm1', type: ContextType.NOTE, title: '密文条目',
      content: '', isEncrypted: true,
      encryptedData: enc.encryptedData, iv: enc.iv, order: 0, createdAt: 2, updatedAt: 2,
    });

    const ctxs = await getContexts('bm1');
    expect(ctxs).toHaveLength(2);
    const plain = ctxs.find((c) => c.id === 'c-plain')!;
    expect(plain.content).toBe('明文内容');
    const encRow = ctxs.find((c) => c.id === 'c-enc')!;
    expect(encRow.isEncrypted).toBe(true);
    expect(encRow.content).toBe(''); // 占位，未解密
  });

  it('已解锁时：密文正常解密', async () => {
    const key = await deriveKeyLocal('pwd', crypto.getRandomValues(new Uint8Array(16)), 10_000);
    setTestKey(key); // 已解锁
    const enc = await encryptWithKey(key, '秘密内容');
    await putRecord('contexts', {
      id: 'c-enc', bookmarkId: 'bm1', type: ContextType.NOTE, title: '密文条目',
      content: '', isEncrypted: true,
      encryptedData: enc.encryptedData, iv: enc.iv, order: 0, createdAt: 1, updatedAt: 1,
    });
    const ctxs = await getContexts('bm1');
    expect(ctxs[0]!.content).toBe('秘密内容');
  });
});

describe('getContextsRaw 不解密（sidepanel 未解锁用）', () => {
  it('即使派生 key 在场，密文也不解密（保留占位），明文正常', async () => {
    const key = await deriveKeyLocal('pwd', crypto.getRandomValues(new Uint8Array(16)), 10_000);
    setTestKey(key); // 模拟 home 已解锁（共享 key 在场）
    const enc = await encryptWithKey(key, '秘密内容');

    await putRecord('contexts', {
      id: 'c-plain', bookmarkId: 'bm1', type: ContextType.NOTE, title: '明文条目',
      content: '明文内容', isEncrypted: false, order: 0, createdAt: 1, updatedAt: 1,
    });
    await putRecord('contexts', {
      id: 'c-enc', bookmarkId: 'bm1', type: ContextType.NOTE, title: '密文条目',
      content: '', isEncrypted: true,
      encryptedData: enc.encryptedData, iv: enc.iv, order: 0, createdAt: 2, updatedAt: 2,
    });

    const ctxs = await getContextsRaw('bm1');
    expect(ctxs).toHaveLength(2);
    expect(ctxs.find((c) => c.id === 'c-plain')!.content).toBe('明文内容');
    const encRow = ctxs.find((c) => c.id === 'c-enc')!;
    expect(encRow.isEncrypted).toBe(true);
    expect(encRow.content).toBe(''); // 不解密——sidepanel 未解锁时密文不泄露
  });
});
