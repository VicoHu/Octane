import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDB, getDB, putRecord } from '@/shared/db/database';
import { setupPassword, setTestKey, unlock as cryptoUnlock } from '@/services/CryptoService';
import { isUnlocked, unlock, markHidden, markVisible, getUnlockPrerequisite } from '@/services/UnlockSession';
import type { SurfaceUnlockState } from '@/services/UnlockSession';

/**
 * chrome.storage 内存 mock（同时挂 session + local）。
 *
 * - session：sidepanel 标记 octane-unlock-sidepanel（会话级，重启清空）
 * - local：TTL 配置 octane-ttl-config（跨会话保留用户偏好）
 */
function installChromeStorage(
  initialSession: Record<string, unknown> = {},
  initialLocal: Record<string, unknown> = {},
) {
  const sessionStore: Record<string, unknown> = { ...initialSession };
  const localStore: Record<string, unknown> = { ...initialLocal };
  const makeStorage = (store: Record<string, unknown>) => ({
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
  });
  const session = makeStorage(sessionStore);
  const local = makeStorage(localStore);
  (globalThis as Record<string, unknown>).chrome = { storage: { session, local } };
  return { sessionStore, localStore, session, local };
}

describe('UnlockSession — sidepanel surface 独立解锁标记（T1 切断联动）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('sidepanel 标记 unlocked=true → isUnlocked("sidepanel") 返回 true', async () => {
    installChromeStorage({
      'octane-unlock-sidepanel': { unlocked: true, unlockedAt: Date.now(), hiddenAt: null },
      'octane-derived-key': 'shared-key',
    });
    expect(await isUnlocked('sidepanel')).toBe(true);
  });

  it('无 sidepanel 标记 → isUnlocked("sidepanel") 返回 false', async () => {
    installChromeStorage({});
    expect(await isUnlocked('sidepanel')).toBe(false);
  });

  it('切断联动核心：octane-derived-key 在（home 已解锁）但 sidepanel 标记缺失 → sidepanel 仍 locked', async () => {
    // home 已解锁：共享派生密钥存在。改造前全局 isUnlocked() 会读它返回 true（联动）。
    // 改造后 sidepanel 读自己的标记，与 home 解锁态无关。
    installChromeStorage({
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
  let sessionStore: Record<string, unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetDB();
    setTestKey(null);
    await getDB();
    await clearCryptoMeta();
    const installed = installChromeStorage();
    sessionStore = installed.sessionStore;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('正确密码 → 返回 true + 写入 sidepanel 标记 + isUnlocked("sidepanel") true', async () => {
    await setupPassword('right-pwd');
    const ok = await unlock('sidepanel', 'right-pwd');
    expect(ok).toBe(true);
    expect(await isUnlocked('sidepanel')).toBe(true);
    expect(sessionStore['octane-unlock-sidepanel']).toMatchObject({ unlocked: true });
    const state = sessionStore['octane-unlock-sidepanel'] as SurfaceUnlockState;
    expect(state.unlockedAt).toBeTypeOf('number');
    expect(state.hiddenAt).toBeNull();
  });

  it('错误密码 → 返回 false + 不写 sidepanel 标记 + isUnlocked 仍 false', async () => {
    await setupPassword('right-pwd');
    const ok = await unlock('sidepanel', 'wrong-pwd');
    expect(ok).toBe(false);
    expect(await isUnlocked('sidepanel')).toBe(false);
    expect(sessionStore['octane-unlock-sidepanel']).toBeUndefined();
  });

  it('防偷看：home 已解锁（octane-derived-key 已在）仍需正确密码，错误密码必失败', async () => {
    // home 先解锁：CryptoService.unlock 派生校验并写共享 octane-derived-key
    await setupPassword('right-pwd');
    await cryptoUnlock('right-pwd');
    expect(sessionStore['octane-derived-key']).toBeTruthy(); // home 已解锁，共享 key 在

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

describe('TTL: grace 失焦锁 + hardCap 硬上限（T3-T6）', () => {
  const GRACE = 5 * 60 * 1000; // 5min
  const HARD_CAP = 30 * 60 * 1000; // 30min
  let sessionStore: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const installed = installChromeStorage(
      {},
      { 'octane-ttl-config': { grace: GRACE, hardCap: HARD_CAP } },
    );
    sessionStore = installed.sessionStore;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  /** 直接写 sidepanel 已解锁状态（绕过真实 PBKDF2，专注 TTL 判定） */
  function setUnlockedState(state: { unlockedAt: number; hiddenAt: number | null }) {
    sessionStore['octane-unlock-sidepanel'] = { unlocked: true, ...state };
    sessionStore['octane-derived-key'] = 'shared-key'; // 模拟 home 已派生共享 key
  }

  it('T3 失焦超 grace → isUnlocked false 且清标记（再次查仍 false）', async () => {
    const now = Date.now();
    setUnlockedState({ unlockedAt: now, hiddenAt: now - (GRACE + 1000) }); // 失焦超 grace
    expect(await isUnlocked('sidepanel')).toBe(false);
    // 超时锁定应清标记：key 被移除，再次查不会自动复活
    expect(sessionStore['octane-unlock-sidepanel']).toBeUndefined();
    expect(await isUnlocked('sidepanel')).toBe(false);
  });

  it('T4 失焦 < grace → 仍 unlocked（短暂切窗不打扰）', async () => {
    const now = Date.now();
    setUnlockedState({
      unlockedAt: now,
      hiddenAt: now - (GRACE - 60_000), // 失焦 4min < grace 5min
    });
    expect(await isUnlocked('sidepanel')).toBe(true);
  });

  it('T5 硬上限超时（一直可见无失焦）→ isUnlocked false（不依赖 grace）', async () => {
    const now = Date.now();
    setUnlockedState({
      unlockedAt: now - (HARD_CAP + 1000), // 解锁 30min+ 前
      hiddenAt: null, // 一直可见，grace 永不触发
    });
    expect(await isUnlocked('sidepanel')).toBe(false);
  });

  it('T6 grace 先于 hardCap 触发（失焦 25min, grace=5, hardCap=30）→ locked 不依赖 hardCap', async () => {
    const now = Date.now();
    setUnlockedState({
      unlockedAt: now - 25 * 60 * 1000, // 解锁 25min 前（hardCap=30 没到）
      hiddenAt: now - 25 * 60 * 1000, // 失焦 25min（grace=5 早超）
    });
    expect(await isUnlocked('sidepanel')).toBe(false);
  });
});

describe('home lock 连带 + key 复活不自动解锁 + 重启清空（T7-T9）', () => {
  let sessionStore: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const installed = installChromeStorage(
      {},
      { 'octane-ttl-config': { grace: 5 * 60 * 1000, hardCap: 30 * 60 * 1000 } },
    );
    sessionStore = installed.sessionStore;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  /** 模拟 sidepanel 已解锁（标记 + 共享 key 俱在，TTL 未超） */
  function unlockBoth() {
    const now = Date.now();
    sessionStore['octane-unlock-sidepanel'] = { unlocked: true, unlockedAt: now, hiddenAt: null };
    sessionStore['octane-derived-key'] = 'shared-key';
  }

  it('T7 sidepanel 解锁态 + octane-derived-key 在 + TTL 未超 → true（key 检查不影响正常态）', async () => {
    unlockBoth();
    expect(await isUnlocked('sidepanel')).toBe(true);
  });

  it('T7 home lockSession 清 octane-derived-key → sidepanel 连带 locked 且清标记', async () => {
    unlockBoth();
    expect(await isUnlocked('sidepanel')).toBe(true);
    delete sessionStore['octane-derived-key']; // home 主动 lockSession() 清共享 key
    expect(await isUnlocked('sidepanel')).toBe(false);
    // 连带锁清 sidepanel 标记：key 复活也不会自动解锁（T8 前置）
    expect(sessionStore['octane-unlock-sidepanel']).toBeUndefined();
  });

  it('T8 home 重新 unlock 写回 key，但 sidepanel 标记已被清 → 仍 locked（key 复活不自动解锁）', async () => {
    unlockBoth();
    delete sessionStore['octane-derived-key']; // home lock → 连带清 sidepanel 标记
    await isUnlocked('sidepanel');
    expect(sessionStore['octane-unlock-sidepanel']).toBeUndefined();

    sessionStore['octane-derived-key'] = 'resurrected-key'; // home 重新 unlock 写回共享 key
    // sidepanel 必须自己再 unlock('sidepanel', pwd)，key 复活不自动解锁
    expect(await isUnlocked('sidepanel')).toBe(false);
  });

  it('T9 浏览器重启（chrome.storage.session 天然清空）→ sidepanel locked', async () => {
    unlockBoth();
    expect(await isUnlocked('sidepanel')).toBe(true);
    // 模拟浏览器重启：session 会话级存储清空
    delete sessionStore['octane-unlock-sidepanel'];
    delete sessionStore['octane-derived-key'];
    expect(await isUnlocked('sidepanel')).toBe(false);
  });
});

describe('并发解锁幂等（T11）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetDB();
    setTestKey(null);
    await getDB();
    await clearCryptoMeta();
    installChromeStorage();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('T11 两个并发 unlock 同密码 → 都成功，PBKDF2 只派生一次（inflight 守卫）', async () => {
    await setupPassword('pwd');
    const deriveSpy = vi.spyOn(crypto.subtle, 'deriveKey');
    const [a, b] = await Promise.all([
      unlock('sidepanel', 'pwd'),
      unlock('sidepanel', 'pwd'),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(deriveSpy).toHaveBeenCalledTimes(1); // 并发复用，不重复 PBKDF2
    deriveSpy.mockRestore();
  });
});

describe('TTL 配置读取生效（T13）', () => {
  let sessionStore: Record<string, unknown>;
  let localStore: Record<string, unknown>;
  beforeEach(() => {
    vi.clearAllMocks();
    const installed = installChromeStorage({}, {});
    sessionStore = installed.sessionStore;
    localStore = installed.localStore;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  function setUnlocked(hiddenAt: number | null) {
    sessionStore['octane-unlock-sidepanel'] = { unlocked: true, unlockedAt: Date.now(), hiddenAt };
    sessionStore['octane-derived-key'] = 'k';
  }

  it('T13 改 octane-ttl-config grace → 下次 isUnlocked 用新 grace 判定', async () => {
    localStore['octane-ttl-config'] = { grace: 5 * 60 * 1000, hardCap: 30 * 60 * 1000 };
    setUnlocked(Date.now() - 120000); // 失焦 2min
    expect(await isUnlocked('sidepanel')).toBe(true); // 2min < grace 5min

    localStore['octane-ttl-config'] = { grace: 60_000, hardCap: 30 * 60 * 1000 }; // grace 改 1min
    expect(await isUnlocked('sidepanel')).toBe(false); // 2min > 新 grace 1min
  });
});

describe('markHidden / markVisible 语义（T14）', () => {
  const GRACE = 5 * 60 * 1000;
  const HARD_CAP = 30 * 60 * 1000;
  let sessionStore: Record<string, unknown>;
  beforeEach(() => {
    vi.clearAllMocks();
    const installed = installChromeStorage(
      {},
      { 'octane-ttl-config': { grace: GRACE, hardCap: HARD_CAP } },
    );
    sessionStore = installed.sessionStore;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  function setUnlocked(hiddenAt: number | null) {
    sessionStore['octane-unlock-sidepanel'] = { unlocked: true, unlockedAt: Date.now(), hiddenAt };
    sessionStore['octane-derived-key'] = 'k';
  }
  const read = () => sessionStore['octane-unlock-sidepanel'] as SurfaceUnlockState;

  it('T14a markHidden 在已解锁且 hiddenAt=null 时记当前时间', async () => {
    setUnlocked(null);
    await markHidden('sidepanel');
    expect(read().hiddenAt).toBeTypeOf('number');
  });

  it('T14a markHidden 不覆盖已记的 hiddenAt（保留更早失焦时刻）', async () => {
    const earlier = Date.now() - 10000;
    setUnlocked(earlier);
    await markHidden('sidepanel');
    expect(read().hiddenAt).toBe(earlier);
  });

  it('T14b markVisible 清 hiddenAt（聚焦后 grace 重新计时）', async () => {
    setUnlocked(Date.now() - 60000);
    await markVisible('sidepanel');
    expect(read().hiddenAt).toBeNull();
  });

  it('T14c 失焦超 grace 已锁（标记被清）后 markVisible 不复活', async () => {
    setUnlocked(Date.now() - (GRACE + 1000));
    expect(await isUnlocked('sidepanel')).toBe(false);
    await markVisible('sidepanel');
    expect(await isUnlocked('sidepanel')).toBe(false);
  });

  it('T14d 未解锁时 markHidden/markVisible no-op（不写入标记）', async () => {
    await markHidden('sidepanel');
    await markVisible('sidepanel');
    expect(sessionStore['octane-unlock-sidepanel']).toBeUndefined();
  });
});

describe('解锁前置条件 getUnlockPrerequisite（T12）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetDB();
    setTestKey(null);
    await getDB();
    await clearCryptoMeta();
    installChromeStorage();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('未设密码（无 meta）→ no-password', async () => {
    expect(await getUnlockPrerequisite('sidepanel')).toBe('no-password');
  });

  it('needs-reset（旧版 meta 无 verifier）→ needs-reset', async () => {
    await putRecord('cryptoMetadata', {
      id: 'singleton',
      salt: 'eA==',
      iterations: 600000,
      algorithm: 'AES-GCM',
      createdAt: 0,
    });
    expect(await getUnlockPrerequisite('sidepanel')).toBe('needs-reset');
  });

  it('正常 meta（有 verifier）→ ok', async () => {
    await setupPassword('pwd');
    expect(await getUnlockPrerequisite('sidepanel')).toBe('ok');
  });
});
