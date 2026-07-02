/**
 * UnlockSession — 分 surface 的解锁状态管理（方案 B 统一抽象）。
 *
 * 取代 useEncryptedContexts 对全局 CryptoService.isUnlocked() 的依赖，
 * 实现 home / sidepanel 两个 surface 的「解锁标记」物理隔离：
 * home 解锁不再联动 sidepanel 自动解锁（切断联动的核心改动）。
 *
 * 注意：解锁标记隔离，但解密派生密钥 octane-derived-key 仍共享——
 * home 主动 lockSession() 清 key 时 sidepanel 解密能力一并失效（后续 T 实现）。
 *
 * T1 阶段：仅实现 isUnlocked('sidepanel') 读取独立标记 octane-unlock-sidepanel。
 * unlock / lock / grace / hardCap / onChanged 感知由后续 T 逐步加入。
 */

import { unlock as cryptoUnlock, isPasswordSet, hasVerifier } from '@/services/CryptoService';

/** 需要独立解锁 gate 的 UI 入口点 */
export type Surface = 'home' | 'sidepanel';

/** 解锁前置条件（点解锁图标前检查，决定弹密码框 or Toast 引导） */
export type UnlockPrerequisite = 'ok' | 'no-password' | 'needs-reset';

/** sidepanel surface 的解锁标记（存 chrome.storage.session，会话级） */
const SIDE_PANEL_STATE_KEY = 'octane-unlock-sidepanel';

/** 共享派生密钥（home/sidepanel 共用，CryptoService 写入；home lockSession 清除） */
const DERIVED_KEY = 'octane-derived-key';

/** TTL 用户配置（存 chrome.storage.local，跨会话保留） */
const TTL_CONFIG_KEY = 'octane-ttl-config';

/** 默认 grace：sidepanel 失焦超 5min 锁（短暂切窗不打扰） */
const DEFAULT_GRACE = 5 * 60 * 1000;
/** 默认 hardCap：解锁后最长 30min 必锁（防一直盯着永不锁） */
const DEFAULT_HARD_CAP = 30 * 60 * 1000;

export interface SurfaceUnlockState {
  unlocked: boolean;
  unlockedAt: number;
  hiddenAt: number | null;
}

export interface TtlConfig {
  /** 失焦超时锁（ms），默认 5min */
  grace: number;
  /** 硬上限锁（ms），默认 30min */
  hardCap: number;
}

interface ChromeStorage {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (data: Record<string, unknown>) => Promise<void>;
  remove: (keys: string[]) => Promise<void>;
}

/** 安全访问 chrome.storage.<area>（非扩展环境返回 null） */
function getChromeStorage(area: 'session' | 'local'): ChromeStorage | null {
  const g = globalThis as Record<string, unknown>;
  const chrome = g['chrome'];
  if (chrome && typeof chrome === 'object') {
    const storage = (chrome as Record<string, unknown>)['storage'];
    if (storage && typeof storage === 'object') {
      const a = (storage as Record<string, unknown>)[area];
      if (a && typeof a === 'object') {
        return a as ChromeStorage;
      }
    }
  }
  return null;
}

/** 读取 TTL 配置（缺失用默认值） */
export async function readTtlConfig(): Promise<TtlConfig> {
  const local = getChromeStorage('local');
  if (!local) return { grace: DEFAULT_GRACE, hardCap: DEFAULT_HARD_CAP };
  const r = await local.get([TTL_CONFIG_KEY]);
  const cfg = r[TTL_CONFIG_KEY] as Partial<TtlConfig> | undefined;
  return {
    grace: typeof cfg?.grace === 'number' ? cfg.grace : DEFAULT_GRACE,
    hardCap: typeof cfg?.hardCap === 'number' ? cfg.hardCap : DEFAULT_HARD_CAP,
  };
}

/** 写入 TTL 配置（部分更新，未传字段保留原值；存 chrome.storage.local 跨会话保留） */
export async function writeTtlConfig(patch: Partial<TtlConfig>): Promise<void> {
  const local = getChromeStorage('local');
  if (!local) return;
  const current = await readTtlConfig();
  await local.set({
    [TTL_CONFIG_KEY]: {
      grace: patch.grace ?? current.grace,
      hardCap: patch.hardCap ?? current.hardCap,
    },
  });
}

/** 写入 sidepanel surface 的解锁标记 */
async function writeSidePanelState(state: SurfaceUnlockState): Promise<void> {
  const session = getChromeStorage('session');
  if (session) {
    await session.set({ [SIDE_PANEL_STATE_KEY]: state });
  }
}

/** 清除 sidepanel 解锁标记（锁定） */
async function clearSidePanelState(): Promise<void> {
  const session = getChromeStorage('session');
  if (session) {
    await session.remove([SIDE_PANEL_STATE_KEY]);
  }
}

/**
 * 某 surface 当前是否已解锁。
 *
 * sidepanel：读独立标记 octane-unlock-sidepanel，**与 home 解锁态无关**（切断联动）。
 * 标记之上叠加 TTL 规则（每次调用都校验，不依赖外部触发）：
 *   - 共享 key：octane-derived-key 不在（home lockSession 清除）→ 连带锁 + 清 sidepanel 标记
 *   - hardCap：`now - unlockedAt >= hardCap` → 锁
 *   - grace：当 hiddenAt != null（曾失焦）且 `now - hiddenAt >= grace` → 锁
 * 任一超时/缺失即判定 locked 并清标记。hiddenAt == null（当前可见/从未失焦）时 grace 项 pass。
 *
 * @throws home surface 尚未纳入 UnlockSession（沿用 CryptoService 会话级行为），后续 T 迁移
 */
export async function isUnlocked(surface: Surface): Promise<boolean> {
  if (surface === 'home') {
    throw new Error('home surface 尚未纳入 UnlockSession');
  }
  const session = getChromeStorage('session');
  if (!session) return false;
  const result = await session.get([SIDE_PANEL_STATE_KEY, DERIVED_KEY]);
  const state = result[SIDE_PANEL_STATE_KEY] as SurfaceUnlockState | undefined;
  if (!state?.unlocked) return false;

  // home 主动 lockSession() 清共享 key → sidepanel 连带失能并清标记（key 复活不自动解锁）
  if (!result[DERIVED_KEY]) {
    await clearSidePanelState();
    return false;
  }

  const now = Date.now();
  const { grace, hardCap } = await readTtlConfig();
  const hardCapExceeded = now - state.unlockedAt >= hardCap;
  const graceExceeded = state.hiddenAt !== null && now - state.hiddenAt >= grace;
  if (hardCapExceeded || graceExceeded) {
    await clearSidePanelState();
    return false;
  }
  return true;
}

/**
 * 记录 sidepanel 失焦（visibilitychange/blur 触发）。
 * 仅在已解锁且 hiddenAt 未记时写入，避免覆盖更早的失焦时刻。
 */
export async function markHidden(surface: Surface): Promise<void> {
  if (surface === 'home') {
    throw new Error('home surface 尚未纳入 UnlockSession');
  }
  const session = getChromeStorage('session');
  if (!session) return;
  const result = await session.get([SIDE_PANEL_STATE_KEY]);
  const state = result[SIDE_PANEL_STATE_KEY] as SurfaceUnlockState | undefined;
  if (state?.unlocked && state.hiddenAt === null) {
    await writeSidePanelState({ ...state, hiddenAt: Date.now() });
  }
}

/**
 * 记录 sidepanel 重新可见/聚焦（visibilitychange/focus 触发）。
 * 清除 hiddenAt，使 grace 重新计时。聚焦后 isUnlocked 立即可重检（若失焦曾超 grace 已锁则保持 locked）。
 */
export async function markVisible(surface: Surface): Promise<void> {
  if (surface === 'home') {
    throw new Error('home surface 尚未纳入 UnlockSession');
  }
  const session = getChromeStorage('session');
  if (!session) return;
  const result = await session.get([SIDE_PANEL_STATE_KEY]);
  const state = result[SIDE_PANEL_STATE_KEY] as SurfaceUnlockState | undefined;
  if (state?.unlocked && state.hiddenAt !== null) {
    await writeSidePanelState({ ...state, hiddenAt: null });
  }
}

/** per-surface 解锁 in-flight 守卫：并发 unlock 复用同一 promise，避免重复 PBKDF2 */
const inflightUnlock = new Map<Surface, Promise<boolean>>();

/**
 * 解锁指定 surface（当前仅 sidepanel）。
 *
 * sidepanel：每次走完整 PBKDF2 + verifier 校验（复用 CryptoService.unlock），
 * **即使 octane-derived-key 已存在（home 已解锁）也必须用密码重新派生校验**——
 * 防偷看语义：偷看者在 home 解锁后输任意密码不得通过。
 *
 * 校验通过 → CryptoService.unlock 已写入共享 octane-derived-key（供 getContexts 解密），
 * 此处再写 sidepanel 独立标记 octane-unlock-sidepanel。
 *
 * 并发幂等：同一 surface 的并发 unlock 复用首个 promise（多个 BookmarkGroup 同时触发解锁时
 * PBKDF2 只派生一次）。
 *
 * @returns true=密码正确并已解锁；false=密码错误
 * @throws home surface 尚未纳入；未设主密码时由 CryptoService.unlock 抛错（前置条件由调用方/T12 处理）
 */
export async function unlock(surface: Surface, password: string): Promise<boolean> {
  if (surface === 'home') {
    throw new Error('home surface 尚未纳入 UnlockSession');
  }
  const existing = inflightUnlock.get(surface);
  if (existing) return existing;
  const p = (async () => {
    const ok = await cryptoUnlock(password);
    if (!ok) return false;
    await writeSidePanelState({ unlocked: true, unlockedAt: Date.now(), hiddenAt: null });
    return true;
  })();
  inflightUnlock.set(surface, p);
  try {
    return await p;
  } finally {
    inflightUnlock.delete(surface);
  }
}

/**
 * 解锁前置条件检查（点解锁图标前调用）。
 *
 * - no-password：从未设置主密码 → Toast 引导去 home 设置
 * - needs-reset：旧版 meta 无 verifier（无法校验密码）→ Toast 引导去 home 重设
 * - ok：可弹密码框
 *
 * @throws home surface 尚未纳入 UnlockSession
 */
export async function getUnlockPrerequisite(surface: Surface): Promise<UnlockPrerequisite> {
  if (surface === 'home') {
    throw new Error('home surface 尚未纳入 UnlockSession');
  }
  if (!(await isPasswordSet())) return 'no-password';
  if (!(await hasVerifier())) return 'needs-reset';
  return 'ok';
}
