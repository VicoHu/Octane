import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDB, getDB } from '@/shared/db/database';
import { setupPassword, setTestKey, unlock as cryptoUnlock } from '@/services/CryptoService';
import { isUnlocked, unlock } from '@/services/UnlockSession';

/**
 * chrome.storage.session 内存 mock。
 *
 * UnlockSession 的 sidepanel 标记 octane-unlock-sidepanel 存 session（会话级，重启清空）。
 * 这里复用 storageMock.ts 的内存 store 模式，但挂在 chrome.storage.session 下。
 */
function installChromeStorageSession(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const session = {
    get: vi.fn(async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of arr) if (k in store) out[k] = store[k];
      return out;
    }),
    set: vi.fn(async (data: Record<string, unknown>) => {
      Object.assign(store, data);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) delete store[k];
    }),
  };
  (globalThis as Record<string, unknown>).chrome = {
    storage: { session },
  };
  return { store, session };
}

describe('UnlockSession — sidepanel surface 独立解锁标记（T1 切断联动）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('sidepanel 标记 unlocked=true → isUnlocked("sidepanel") 返回 true', async () => {
    installChromeStorageSession({
      'octane-unlock-sidepanel': { unlocked: true, unlockedAt: 1000, hiddenAt: null },
    });
    expect(await isUnlocked('sidepanel')).toBe(true);
  });

  it('无 sidepanel 标记 → isUnlocked("sidepanel") 返回 false', async () => {
    installChromeStorageSession({});
    expect(await isUnlocked('sidepanel')).toBe(false);
  });

  it('切断联动核心：octane-derived-key 在（home 已解锁）但 sidepanel 标记缺失 → sidepanel 仍 locked', async () => {
    // home 已解锁：共享派生密钥存在。改造前全局 isUnlocked() 会读它返回 true（联动）。
    // 改造后 sidepanel 读自己的标记，与 home 解锁态无关。
    installChromeStorageSession({
      'octane-derived-key': 'base64-key-from-home-unlock',
    });
    expect(await isUnlocked('sidepanel')).toBe(false);
  });

  it('chrome.storage.session 不可用（非扩展环境）→ 返回 false，不抛错', async () => {
    delete (globalThis as Record<string, unknown>).chrome;
    expect(await isUnlocked('sidepanel')).toBe(false);
  });
});

/** 清空 cryptoMetadata store（隔离每次 unlock 测试的密码 meta） */
async function clearCryptoMeta(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['cryptoMetadata'], 'readwrite');
  await tx.objectStore('cryptoMetadata').clear();
  await tx.done;
}

describe('unlock("sidepanel", password) — 完整 PBKDF2 + verifier（T2）', () => {
  let store: Record<string, unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetDB();
    setTestKey(null);
    await getDB();
    await clearCryptoMeta();
    const installed = installChromeStorageSession();
    store = installed.store;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('正确密码 → 返回 true + 写入 sidepanel 标记 + isUnlocked("sidepanel") true', async () => {
    await setupPassword('right-pwd');
    const ok = await unlock('sidepanel', 'right-pwd');
    expect(ok).toBe(true);
    expect(await isUnlocked('sidepanel')).toBe(true);
    expect(store['octane-unlock-sidepanel']).toMatchObject({ unlocked: true });
    const state = store['octane-unlock-sidepanel'] as { unlockedAt: number; hiddenAt: number | null };
    expect(state.unlockedAt).toBeTypeOf('number');
    expect(state.hiddenAt).toBeNull();
  });

  it('错误密码 → 返回 false + 不写 sidepanel 标记 + isUnlocked 仍 false', async () => {
    await setupPassword('right-pwd');
    const ok = await unlock('sidepanel', 'wrong-pwd');
    expect(ok).toBe(false);
    expect(await isUnlocked('sidepanel')).toBe(false);
    expect(store['octane-unlock-sidepanel']).toBeUndefined();
  });

  it('防偷看：home 已解锁（octane-derived-key 已在）仍需正确密码，错误密码必失败', async () => {
    // home 先解锁：CryptoService.unlock 派生校验并写共享 octane-derived-key
    await setupPassword('right-pwd');
    await cryptoUnlock('right-pwd');
    expect(store['octane-derived-key']).toBeTruthy(); // home 已解锁，共享 key 在

    // 偷看者在 sidepanel 输错密码 → 必须 fail（每次真身份验证，不复用已派生 key 跳过校验）
    const wrong = await unlock('sidepanel', 'wrong-pwd');
    expect(wrong).toBe(false);
    expect(await isUnlocked('sidepanel')).toBe(false);

    // 正确密码才通过
    const right = await unlock('sidepanel', 'right-pwd');
    expect(right).toBe(true);
    expect(await isUnlocked('sidepanel')).toBe(true);
  });
});
