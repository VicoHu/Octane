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
  setupPin,
  unlockWithPin,
  isPinEnabled,
  hasPinEnvelope,
  disablePin,
  lock,
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

// PIN 用例共享：chrome.storage 内存 mock（session=会话态信封/派生密钥，local=持久信封/失败计数）
let sessionStore: Record<string, unknown>;
let localStore: Record<string, unknown>;

function installChromeStorage() {
  const makeStorage = (store: Record<string, unknown>) => ({
    get: async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in store) out[k] = store[k];
      return out;
    },
    set: async (data: Record<string, unknown>) => {
      Object.assign(store, data);
    },
    remove: async (keys: string[]) => {
      for (const k of keys) delete store[k];
    },
  });
  sessionStore = {};
  localStore = {};
  (globalThis as Record<string, unknown>).chrome = {
    storage: { session: makeStorage(sessionStore), local: makeStorage(localStore) },
  };
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

describe('快速解锁 PIN — 启用与解锁（#96 信封机制）', () => {
  beforeEach(() => {
    installChromeStorage();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('已解锁时 setupPin → isPinEnabled 与 hasPinEnvelope 均为 true', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    expect(await isPinEnabled()).toBe(true);
    expect(await hasPinEnvelope()).toBe(true);
  });

  it('默认不持久化：信封只写 session，local 无信封', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    expect(sessionStore['octane-pin-envelope']).toBeDefined();
    expect(localStore['octane-pin-envelope']).toBeUndefined();
  });

  it('锁定后用正确 PIN 解锁 → 恢复解锁态', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await lock();
    expect(await isUnlocked()).toBe(false);
    expect(await unlockWithPin('1234')).toBe(true);
    expect(await isUnlocked()).toBe(true);
  });

  it('错误 PIN 解锁返回 false 且保持锁定', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await lock();
    expect(await unlockWithPin('0000')).toBe(false);
    expect(await isUnlocked()).toBe(false);
  });

  it('PIN 解锁后数据仍可解密（信封还原的是同一把派生密钥）', async () => {
    await setupPassword('master-password-123');
    const { encryptedData, iv } = await encrypt('PIN 解锁前的密文');
    await setupPin('1234', 'digits-4', false);
    await lock();
    expect(await unlockWithPin('1234')).toBe(true);
    expect(await decrypt(encryptedData, iv)).toBe('PIN 解锁前的密文');
  });

  it('格式校验：digits-4 传非 4 位数字 → 抛错且不启用', async () => {
    await setupPassword('master-password-123');
    await expect(setupPin('12345', 'digits-4', false)).rejects.toThrow();
    await expect(setupPin('12a4', 'digits-4', false)).rejects.toThrow();
    expect(await isPinEnabled()).toBe(false);
  });

  it('格式校验：custom 短于 4 位 → 抛错', async () => {
    await setupPassword('master-password-123');
    await expect(setupPin('ab1', 'custom', false)).rejects.toThrow();
  });

  it('未解锁时 setupPin → 抛错（包装需要当前派生密钥）', async () => {
    await setupPassword('master-password-123');
    await lock();
    await expect(setupPin('1234', 'digits-4', false)).rejects.toThrow();
  });

  it('disablePin → 信封与启用状态全部清除', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await disablePin();
    expect(await isPinEnabled()).toBe(false);
    expect(await hasPinEnvelope()).toBe(false);
    expect(sessionStore['octane-pin-envelope']).toBeUndefined();
  });
});

describe('快速解锁 PIN — 熔断与持久化（#96）', () => {
  beforeEach(() => {
    installChromeStorage();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('连续输错 5 次 → 熔断：PIN 停用，回退主密码', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await lock();
    for (let i = 0; i < 5; i++) {
      expect(await unlockWithPin('0000')).toBe(false);
    }
    expect(await isPinEnabled()).toBe(false);
    expect(await hasPinEnvelope()).toBe(false);
    // 主密码仍可解锁
    expect(await unlock('master-password-123')).toBe(true);
  });

  it('失败计数在成功解锁后清零：错 4 次 → 对 1 次 → 再错 4 次不熔断', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await lock();
    for (let i = 0; i < 4; i++) {
      await unlockWithPin('0000');
    }
    expect(await unlockWithPin('1234')).toBe(true);
    await lock();
    for (let i = 0; i < 4; i++) {
      await unlockWithPin('0000');
    }
    expect(await isPinEnabled()).toBe(true);
  });

  it('持久化信封：persistEnvelope=true 时信封在 local，session 清空（模拟重启）后 PIN 仍可解锁', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', true);
    expect(localStore['octane-pin-envelope']).toBeDefined();
    expect(sessionStore['octane-pin-envelope']).toBeUndefined();

    await lock();
    // 模拟浏览器重启：session 整体清空，local 保留
    for (const k of Object.keys(sessionStore)) delete sessionStore[k];
    expect(await hasPinEnvelope()).toBe(true);
    expect(await unlockWithPin('1234')).toBe(true);
    expect(await isUnlocked()).toBe(true);
  });

  it('非持久信封：session 清空（模拟重启）后信封不可用，回退主密码', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await lock();
    for (const k of Object.keys(sessionStore)) delete sessionStore[k];
    expect(await hasPinEnvelope()).toBe(false);
    expect(await unlockWithPin('1234')).toBe(false);
  });

  it('setPinPersistence(true) → 信封从 session 搬到 local', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    const { setPinPersistence } = await import('@/services/CryptoService');
    await setPinPersistence(true);
    expect(localStore['octane-pin-envelope']).toBeDefined();
    expect(sessionStore['octane-pin-envelope']).toBeUndefined();
    // 重启模拟后仍可用
    await lock();
    for (const k of Object.keys(sessionStore)) delete sessionStore[k];
    expect(await unlockWithPin('1234')).toBe(true);
  });

  it('changePassword 提供 PIN → 信封用新派生密钥重建，PIN 仍可解锁并解出新数据', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await changePassword('master-password-123', 'new-master-pass-456', async () => {}, {
      pin: '1234',
    });
    expect(await isPinEnabled()).toBe(true);
    // 锚定新密钥：changePassword 后 session 里是新密钥，用它加密；PIN 解出的必须是同一把才能解开
    const { encryptedData, iv } = await encrypt('改密后锚定的密文');
    await lock();
    expect(await unlockWithPin('1234')).toBe(true);
    expect(await decrypt(encryptedData, iv)).toBe('改密后锚定的密文');
  });

  it('changePassword 提供错误 PIN → 抛「PIN 错误」，旧密码仍可用、PIN 仍启用（原子拦截）', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await expect(
      changePassword('master-password-123', 'new-master-pass-456', async () => {}, {
        pin: '9999',
      }),
    ).rejects.toThrow('PIN 错误');
    expect(await unlock('master-password-123')).toBe(true);
    expect(await isPinEnabled()).toBe(true);
  });

  it('changePassword 提供正确 PIN 但旧信封不可用 → 改密成功、PIN 停用', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    // 模拟重启后的非持久模式：session 信封消失
    delete sessionStore['octane-pin-envelope'];
    await changePassword('master-password-123', 'new-master-pass-456', async () => {}, {
      pin: '1234',
    });
    expect(await unlock('new-master-pass-456')).toBe(true);
    expect(await isPinEnabled()).toBe(false);
  });

  it('changePassword 未提供 PIN（且 PIN 已启用）→ PIN 自动停用，主密码不受影响', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await changePassword('master-password-123', 'new-master-pass-456', async () => {});
    expect(await isPinEnabled()).toBe(false);
    expect(await unlock('new-master-pass-456')).toBe(true);
  });
});
