import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDB, getDB, putRecord } from '@/shared/db/database';
import { setupPassword, setTestKey, unlock as cryptoUnlock, setupPin, lock } from '@/services/CryptoService';
import { isUnlocked, unlock, markHidden, markVisible, getUnlockPrerequisite, unlockWithPin, readAutoLockConfig, writeAutoLockConfig } from '@/services/UnlockSession';
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
      'octane-unlock-sidepanel': { unlocked: true, unlockedAt: Date.now() },
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
    // unlock 重置失焦计时（独立 visibility key）
    expect(
      (sessionStore['octane-unlock-visibility-sidepanel'] as { hiddenAt: number | null })?.hiddenAt,
    ).toBeNull();
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

describe('闲置自动锁定（T3-T6 迁移至统一 idle 模型，#96）', () => {
  const IDLE = 5 * 60 * 1000; // 5min
  let sessionStore: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const installed = installChromeStorage(
      {},
      { 'octane-autolock-config': { idleMs: IDLE } },
    );
    sessionStore = installed.sessionStore;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  /** 直接写 sidepanel 已解锁状态（绕过真实 PBKDF2，专注 idle 判定） */
  function setUnlockedState(state: { unlockedAt: number; hiddenAt: number | null }) {
    sessionStore['octane-unlock-sidepanel'] = { unlocked: true, unlockedAt: state.unlockedAt };
    sessionStore['octane-unlock-visibility-sidepanel'] = { hiddenAt: state.hiddenAt };
    sessionStore['octane-derived-key'] = 'shared-key'; // 模拟 home 已派生共享 key
  }

  it('T3 失焦超 idle → isUnlocked false 且清标记（再次查仍 false）', async () => {
    const now = Date.now();
    setUnlockedState({ unlockedAt: now, hiddenAt: now - (IDLE + 1000) }); // 失焦超 idle
    expect(await isUnlocked('sidepanel')).toBe(false);
    // 超时锁定应清标记：key 被移除，再次查不会自动复活
    expect(sessionStore['octane-unlock-sidepanel']).toBeUndefined();
    expect(await isUnlocked('sidepanel')).toBe(false);
  });

  it('T4 失焦 < idle → 仍 unlocked（短暂切窗不打扰）', async () => {
    const now = Date.now();
    setUnlockedState({
      unlockedAt: now,
      hiddenAt: now - (IDLE - 60_000), // 失焦 4min < idle 5min
    });
    expect(await isUnlocked('sidepanel')).toBe(true);
  });

  it('T6 idle 判定只看失焦时长（旧 hardCap 已废除，见统一自动锁定 describe）', async () => {
    const now = Date.now();
    setUnlockedState({
      unlockedAt: now - 25 * 60 * 1000, // 解锁 25min 前（旧 hardCap 30min 语境）
      hiddenAt: now - 25 * 60 * 1000, // 失焦 25min（idle 5min 早超）
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
      { 'octane-autolock-config': { idleMs: 5 * 60 * 1000 } },
    );
    sessionStore = installed.sessionStore;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  /** 模拟 sidepanel 已解锁（标记 + 共享 key 俱在，TTL 未超） */
  function unlockBoth() {
    const now = Date.now();
    sessionStore['octane-unlock-sidepanel'] = { unlocked: true, unlockedAt: now };
    sessionStore['octane-unlock-visibility-sidepanel'] = { hiddenAt: null };
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
    sessionStore['octane-unlock-sidepanel'] = { unlocked: true, unlockedAt: Date.now() };
    sessionStore['octane-unlock-visibility-sidepanel'] = { hiddenAt };
    sessionStore['octane-derived-key'] = 'k';
  }

  it('T13 改 octane-autolock-config idleMs → 下次 isUnlocked 用新值判定', async () => {
    localStore['octane-autolock-config'] = { idleMs: 5 * 60 * 1000 };
    setUnlocked(Date.now() - 120000); // 失焦 2min
    expect(await isUnlocked('sidepanel')).toBe(true); // 2min < 5min

    localStore['octane-autolock-config'] = { idleMs: 60_000 }; // 改 1min
    expect(await isUnlocked('sidepanel')).toBe(false); // 2min > 新值 1min
  });
});

describe('markHidden / markVisible 语义（T14）', () => {
  const IDLE = 5 * 60 * 1000;
  let sessionStore: Record<string, unknown>;
  beforeEach(() => {
    vi.clearAllMocks();
    const installed = installChromeStorage(
      {},
      { 'octane-autolock-config': { idleMs: IDLE } },
    );
    sessionStore = installed.sessionStore;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  function setUnlocked(hiddenAt: number | null) {
    sessionStore['octane-unlock-sidepanel'] = { unlocked: true, unlockedAt: Date.now() };
    sessionStore['octane-unlock-visibility-sidepanel'] = { hiddenAt };
    sessionStore['octane-derived-key'] = 'k';
  }
  const read = () =>
    sessionStore['octane-unlock-visibility-sidepanel'] as { hiddenAt: number | null };

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

  it('T14c 失焦超 idle 已锁（标记被清）后 markVisible 不复活', async () => {
    setUnlocked(Date.now() - (IDLE + 1000));
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

describe('统一自动锁定 + home surface 接入（#96）', () => {
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

  /** 模拟 surface 已解锁（标记 + 共享 key） */
  function setUnlocked(surface: 'home' | 'sidepanel', hiddenAt: number | null) {
    sessionStore[`octane-unlock-${surface}`] = { unlocked: true, unlockedAt: Date.now() };
    sessionStore[`octane-unlock-visibility-${surface}`] = { hiddenAt };
    sessionStore['octane-derived-key'] = 'k';
  }

  it('home 标记 + 共享 key 在 → isUnlocked("home") true（不再 throw）', async () => {
    setUnlocked('home', null);
    expect(await isUnlocked('home')).toBe(true);
  });

  it('home 与 sidepanel 解锁标记互相独立', async () => {
    setUnlocked('home', null);
    expect(await isUnlocked('home')).toBe(true);
    expect(await isUnlocked('sidepanel')).toBe(false);
  });

  it('默认（无任何配置）→ 失焦永不自动锁定（复刻现状默认）', async () => {
    setUnlocked('sidepanel', Date.now() - 3 * 60 * 60 * 1000); // 失焦 3 小时
    expect(await isUnlocked('sidepanel')).toBe(true);
  });

  it('idleMs=60s：失焦 2min → locked 且清标记', async () => {
    localStore['octane-autolock-config'] = { idleMs: 60_000 };
    setUnlocked('sidepanel', Date.now() - 120_000);
    expect(await isUnlocked('sidepanel')).toBe(false);
    expect(sessionStore['octane-unlock-sidepanel']).toBeUndefined();
  });

  it('idleMs=null（显式永不）→ 失焦再久也不锁', async () => {
    localStore['octane-autolock-config'] = { idleMs: null };
    setUnlocked('sidepanel', Date.now() - 3 * 60 * 60 * 1000);
    expect(await isUnlocked('sidepanel')).toBe(true);
  });

  it('idleMs=0（立即）→ 只要失焦过即锁', async () => {
    localStore['octane-autolock-config'] = { idleMs: 0 };
    setUnlocked('sidepanel', Date.now() - 1);
    expect(await isUnlocked('sidepanel')).toBe(false);
  });

  it('hardCap 废除：解锁超 30min 但一直可见 → 仍 unlocked', async () => {
    setUnlocked('sidepanel', null);
    sessionStore['octane-unlock-sidepanel'] = {
      unlocked: true,
      unlockedAt: Date.now() - 31 * 60 * 1000, // 远超旧 hardCap 30min
    };
    expect(await isUnlocked('sidepanel')).toBe(true);
  });

  it('idle 判定对 home 同样生效', async () => {
    localStore['octane-autolock-config'] = { idleMs: 60_000 };
    setUnlocked('home', Date.now() - 120_000);
    expect(await isUnlocked('home')).toBe(false);
  });
});

describe('存量 TTL 迁移（#96：grace 归最近档位，hardCap 废弃）', () => {
  let localStore: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const installed = installChromeStorage({}, {});
    localStore = installed.localStore;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('旧 grace=5min → 迁移为 idleMs=300_000，旧 key 删除', async () => {
    localStore['octane-ttl-config'] = { grace: 300_000, hardCap: 1_800_000 };
    const cfg = await readAutoLockConfig();
    expect(cfg.idleMs).toBe(300_000);
    expect(localStore['octane-autolock-config']).toEqual({ idleMs: 300_000 });
    expect(localStore['octane-ttl-config']).toBeUndefined();
  });

  it('旧 grace=7min（非档位）→ 归最近档 5min', async () => {
    localStore['octane-ttl-config'] = { grace: 420_000, hardCap: 1_800_000 };
    const cfg = await readAutoLockConfig();
    expect(cfg.idleMs).toBe(300_000);
  });

  it('旧 grace=42min → 归最近档 60min', async () => {
    localStore['octane-ttl-config'] = { grace: 42 * 60 * 1000, hardCap: 1_800_000 };
    const cfg = await readAutoLockConfig();
    expect(cfg.idleMs).toBe(3_600_000);
  });

  it('无旧 key → idleMs=null（新默认：永不）', async () => {
    const cfg = await readAutoLockConfig();
    expect(cfg.idleMs).toBeNull();
  });

  it('已有新配置 → 优先新配置，不再看旧 key', async () => {
    localStore['octane-autolock-config'] = { idleMs: 60_000 };
    localStore['octane-ttl-config'] = { grace: 300_000, hardCap: 1_800_000 };
    const cfg = await readAutoLockConfig();
    expect(cfg.idleMs).toBe(60_000);
    expect(localStore['octane-ttl-config']).toBeDefined(); // 未触发迁移路径，不动用户数据
  });

  it('writeAutoLockConfig 写入后 readAutoLockConfig 读回', async () => {
    await writeAutoLockConfig(60_000);
    expect(localStore['octane-autolock-config']).toEqual({ idleMs: 60_000 });
    expect((await readAutoLockConfig()).idleMs).toBe(60_000);
    await writeAutoLockConfig(null);
    expect((await readAutoLockConfig()).idleMs).toBeNull();
  });
});

describe('unlockWithPin surface 解锁（#96）', () => {
  let sessionStore: Record<string, unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetDB();
    setTestKey(null);
    await getDB();
    const db = await getDB();
    const tx = db.transaction(['cryptoMetadata'], 'readwrite');
    await tx.objectStore('cryptoMetadata').clear();
    await tx.done;
    const installed = installChromeStorage();
    sessionStore = installed.sessionStore;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('正确 PIN → 返回 true + 写 surface 标记 + isUnlocked true', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await lock();
    const ok = await unlockWithPin('sidepanel', '1234');
    expect(ok).toBe(true);
    expect(await isUnlocked('sidepanel')).toBe(true);
    expect(sessionStore['octane-unlock-sidepanel']).toMatchObject({ unlocked: true });
  });

  it('错误 PIN → 返回 false + 不写 surface 标记', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    const ok = await unlockWithPin('sidepanel', '0000');
    expect(ok).toBe(false);
    expect(await isUnlocked('sidepanel')).toBe(false);
    expect(sessionStore['octane-unlock-sidepanel']).toBeUndefined();
  });

  it('home surface 同样支持 PIN 解锁', async () => {
    await setupPassword('master-password-123');
    await setupPin('1234', 'digits-4', false);
    await lock();
    expect(await unlockWithPin('home', '1234')).toBe(true);
    expect(await isUnlocked('home')).toBe(true);
  });
});
