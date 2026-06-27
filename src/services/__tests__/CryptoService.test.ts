import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetDB, getDB } from '@/shared/db/database';
import {
  encrypt,
  decrypt,
  setTestKey,
  setupTestKey,
  isUnlocked,
  setupPassword,
  unlock,
  changePassword,
  hasVerifier,
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

describe('会话密钥容错（M5：storage.session 不可用）', () => {
  it('chrome.storage.session 不可用时 isUnlocked 返回 false，不抛错', async () => {
    setTestKey(null);
    const g = globalThis as Record<string, unknown>;
    const origChrome = g['chrome'];
    // 有 storage 但无 session（受限环境/上下文未注入 session API）
    g['chrome'] = { storage: { local: {} } };
    try {
      const unlocked = await isUnlocked();
      expect(unlocked).toBe(false);
    } finally {
      g['chrome'] = origChrome;
    }
  });
});

describe('密码校验（verifier 机制，#4 安全修复）', () => {
  it('setupPassword 后用正确密码 unlock 返回 true', async () => {
    await setupPassword('correct-password-123');
    const ok = await unlock('correct-password-123');
    expect(ok).toBe(true);
  });

  it('错误密码 unlock 返回 false（#4 回归核心）', async () => {
    await setupPassword('correct-password-123');
    const ok = await unlock('wrong-password-xxx');
    expect(ok).toBe(false);
  });

  it('setupPassword 写入的 meta 含 verifier', async () => {
    await setupPassword('correct-password-123');
    expect(await hasVerifier()).toBe(true);
  });

  it('hasVerifier：无 verifier 的旧 meta 返回 false', async () => {
    const { putRecord, getByKey } = await import('@/shared/db/database');
    // 手动写入无 verifier 的旧版 meta，模拟升级前数据
    await putRecord('cryptoMetadata', {
      id: 'singleton',
      salt: 'b64salt==',
      iterations: 600_000,
      algorithm: 'AES-GCM-256',
      createdAt: 0,
    });
    const meta = await getByKey<import('@/shared/types').CryptoMetadata>('cryptoMetadata', 'singleton');
    expect(meta?.verifier).toBeUndefined();
    expect(await hasVerifier()).toBe(false);
  });

  it('changePassword：旧密码错误时抛错且不改 meta', async () => {
    await setupPassword('old-password-123');
    await expect(
      changePassword('wrong-old', 'new-password-456', async () => {}),
    ).rejects.toThrow();
    // 旧密码仍可用，说明 meta 未被破坏
    expect(await unlock('old-password-123')).toBe(true);
  });

  it('changePassword：旧密码正确则更新 meta，新密码可解锁、旧密码失效', async () => {
    await setupPassword('old-password-123');
    let reencryptCalled = false;
    await changePassword('old-password-123', 'new-password-456', async (oldKey, newKey) => {
      // 回调拿到两个不同的 key
      expect(oldKey).toBeTruthy();
      expect(newKey).toBeTruthy();
      expect(oldKey).not.toBe(newKey);
      reencryptCalled = true;
    });
    expect(reencryptCalled).toBe(true);
    expect(await unlock('new-password-456')).toBe(true);
    expect(await unlock('old-password-123')).toBe(false);
  });

  it('changePassword 回调抛错时不写 meta（原子回滚）', async () => {
    await setupPassword('old-password-123');
    await expect(
      changePassword('old-password-123', 'new-password-456', async () => {
        throw new Error('重加密失败');
      }),
    ).rejects.toThrow('重加密失败');
    // meta 未改，旧密码仍可用
    expect(await unlock('old-password-123')).toBe(true);
  });
});
