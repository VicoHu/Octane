import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetDB, getDB } from '@/shared/db/database';
import {
  encrypt,
  decrypt,
  setTestKey,
  setupTestKey,
} from '@/services/CryptoService';

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

describe('CryptoService 加密往返', () => {
  it('加密后解密应返回原始明文', async () => {
    await setupTestKey('test-password-1234');
    const plaintext = '这是一条测试笔记，包含中文 🎉';
    const { encryptedData, iv } = await encrypt(plaintext);
    const decrypted = await decrypt(encryptedData, iv);
    expect(decrypted).toBe(plaintext);
  });

  it('每次加密生成不同的 IV', async () => {
    await setupTestKey('test-password-1234');
    const plaintext = '相同内容';
    const result1 = await encrypt(plaintext);
    const result2 = await encrypt(plaintext);
    expect(result1.iv).not.toBe(result2.iv);
    expect(result1.encryptedData).not.toBe(result2.encryptedData);
  });

  it('加密结果非空且与明文不同', async () => {
    await setupTestKey('test-password-1234');
    const plaintext = '敏感笔记内容';
    const { encryptedData, iv } = await encrypt(plaintext);
    expect(encryptedData).toBeTruthy();
    expect(iv).toBeTruthy();
    expect(encryptedData).not.toBe(plaintext);
  });

  it('空字符串也能正确加密解密', async () => {
    await setupTestKey('test-password-1234');
    const { encryptedData, iv } = await encrypt('');
    const decrypted = await decrypt(encryptedData, iv);
    expect(decrypted).toBe('');
  });

  it('长文本加密解密', async () => {
    await setupTestKey('test-password-1234');
    const plaintext = 'A'.repeat(10_000);
    const { encryptedData, iv } = await encrypt(plaintext);
    const decrypted = await decrypt(encryptedData, iv);
    expect(decrypted).toBe(plaintext);
  });

  it('未设置密钥时加密应抛出错误', async () => {
    setTestKey(null);
    await expect(encrypt('test')).rejects.toThrow('密钥不可用');
  });

  it('未设置密钥时解密应抛出错误', async () => {
    setTestKey(null);
    await expect(decrypt('fake', 'fake-iv')).rejects.toThrow('密钥不可用');
  });
});
