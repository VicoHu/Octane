/**
 * UnlockSession — 分 surface 的解锁状态管理。
 *
 * home / sidepanel 两个 surface 的「解锁标记」物理隔离：home 解锁不联动 sidepanel
 * 自动解锁。解锁标记隔离，但解密派生密钥 octane-derived-key 仍共享——任一 surface
 * 主动锁定清 key 时另一 surface 解密能力一并失效。
 *
 * 统一自动锁定（#96）：单一「页面不可见持续 X 后锁定」设置（idleMs，null=永不），
 * home 与 sidepanel 共用；原 sidepanel 专属的 grace/hardCap 双参数模型废弃——
 * grace 懒迁移归最近档位，hardCap 直接移除。过期判定每次调用即时校验，不依赖外部触发。
 */

import {
  unlock as cryptoUnlock,
  unlockWithPin as cryptoUnlockWithPin,
  isPasswordSet,
  hasVerifier,
} from '@/services/CryptoService';

/** 需要独立解锁 gate 的 UI 入口点 */
export type Surface = 'home' | 'sidepanel';

/** 解锁前置条件（点解锁图标前检查，决定弹密码框 or Toast 引导） */
export type UnlockPrerequisite = 'ok' | 'no-password' | 'needs-reset';

/** 各 surface 的解锁标记（存 chrome.storage.session，会话级） */
const SURFACE_STATE_KEY: Record<Surface, string> = {
  home: 'octane-unlock-home',
  sidepanel: 'octane-unlock-sidepanel',
};

/**
 * 各 surface 的失焦计时（独立 key，会话级）。
 * 拆离解锁标记的目的：markHidden/markVisible 只改本 key，
 * 不触发 useEncryptedContexts 的 onChanged（它只监听解锁标记 + 共享 key），
 * 避免失焦/聚焦时整页 effect 重跑导致的 loading 闪烁。
 */
const SURFACE_VISIBILITY_KEY: Record<Surface, string> = {
  home: 'octane-unlock-visibility-home',
  sidepanel: 'octane-unlock-visibility-sidepanel',
};

/** 共享派生密钥（home/sidepanel 共用，CryptoService 写入；锁定时清除） */
const DERIVED_KEY = 'octane-derived-key';

/** 统一自动锁定配置（存 chrome.storage.local，跨会话保留） */
const AUTOLOCK_CONFIG_KEY = 'octane-autolock-config';
/** 旧版 sidepanel TTL 配置（#96 前的 grace/hardCap，读取时懒迁移后删除） */
const LEGACY_TTL_CONFIG_KEY = 'octane-ttl-config';

/** 自动锁定档位（ms）：立即 / 1 / 5 / 15 / 60 分钟；永不(null)不在档位表内 */
export const AUTOLOCK_PRESETS_MS = [0, 60_000, 300_000, 900_000, 3_600_000] as const;

export interface SurfaceUnlockState {
  unlocked: boolean;
  unlockedAt: number;
}

interface SurfaceVisibility {
  hiddenAt: number | null;
}

export interface AutoLockConfig {
  /** 页面不可见持续该时长后锁定；null = 永不自动锁定 */
  idleMs: number | null;
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

/** 归到最近的自动锁定档位（迁移用：尊重原意图，行为偏差最小） */
function snapToNearestPreset(ms: number): number {
  let best: number = AUTOLOCK_PRESETS_MS[0];
  for (const p of AUTOLOCK_PRESETS_MS) {
    if (Math.abs(p - ms) < Math.abs(best - ms)) best = p;
  }
  return best;
}

/**
 * 读取统一自动锁定配置。
 *
 * 懒迁移：首次发现旧 octane-ttl-config（sidepanel grace/hardCap）时，把 grace 归最近
 * 档位写入新 key 并删除旧 key（hardCap 废弃不迁移）；从未配置过的用户得到新默认
 * idleMs=null（永不）——与 home 原行为一致，方向上是放宽（用户诉求），CHANGELOG 明示。
 */
export async function readAutoLockConfig(): Promise<AutoLockConfig> {
  const local = getChromeStorage('local');
  if (!local) return { idleMs: null };
  const r = await local.get([AUTOLOCK_CONFIG_KEY, LEGACY_TTL_CONFIG_KEY]);

  const current = r[AUTOLOCK_CONFIG_KEY];
  if (current && typeof current === 'object' && 'idleMs' in current) {
    const idleMs = (current as AutoLockConfig).idleMs;
    return { idleMs: typeof idleMs === 'number' ? idleMs : null };
  }

  const legacy = r[LEGACY_TTL_CONFIG_KEY];
  if (legacy && typeof legacy === 'object' && typeof (legacy as { grace?: unknown }).grace === 'number') {
    const idleMs = snapToNearestPreset((legacy as { grace: number }).grace);
    await local.set({ [AUTOLOCK_CONFIG_KEY]: { idleMs } });
    await local.remove([LEGACY_TTL_CONFIG_KEY]);
    return { idleMs };
  }

  return { idleMs: null };
}

/** 写入统一自动锁定配置（idleMs 传 null = 永不自动锁定） */
export async function writeAutoLockConfig(idleMs: number | null): Promise<void> {
  const local = getChromeStorage('local');
  if (!local) return;
  await local.set({ [AUTOLOCK_CONFIG_KEY]: { idleMs } });
}

/** 写入 surface 的解锁标记 */
async function writeSurfaceState(surface: Surface, state: SurfaceUnlockState): Promise<void> {
  const session = getChromeStorage('session');
  if (session) {
    await session.set({ [SURFACE_STATE_KEY[surface]]: state });
  }
}

/** 清除 surface 解锁标记（锁定） */
async function clearSurfaceState(surface: Surface): Promise<void> {
  const session = getChromeStorage('session');
  if (session) {
    await session.remove([SURFACE_STATE_KEY[surface]]);
  }
}

/** 读取 surface 失焦计时 */
async function readVisibility(surface: Surface): Promise<SurfaceVisibility> {
  const session = getChromeStorage('session');
  if (!session) return { hiddenAt: null };
  const r = await session.get([SURFACE_VISIBILITY_KEY[surface]]);
  return (r[SURFACE_VISIBILITY_KEY[surface]] as SurfaceVisibility | undefined) ?? { hiddenAt: null };
}

/** 写入 surface 失焦计时 */
async function writeVisibility(surface: Surface, vis: SurfaceVisibility): Promise<void> {
  const session = getChromeStorage('session');
  if (session) {
    await session.set({ [SURFACE_VISIBILITY_KEY[surface]]: vis });
  }
}

/**
 * 某 surface 当前是否已解锁。
 *
 * 读该 surface 独立标记，与另一 surface 的解锁态无关（切断联动）。
 * 标记之上叠加统一自动锁定规则（每次调用都校验，不依赖外部触发）：
 *   - 共享 key：octane-derived-key 不在（任一 surface 主动清 key）→ 连带锁 + 清本 surface 标记
 *   - idle：idleMs 非 null 且曾失焦（hiddenAt != null）且 `now - hiddenAt >= idleMs` → 锁
 * 任一条件命中即判定 locked 并清标记。hiddenAt == null（当前可见/从未失焦）时 idle 项 pass。
 */
export async function isUnlocked(surface: Surface): Promise<boolean> {
  const session = getChromeStorage('session');
  if (!session) return false;
  const result = await session.get([
    SURFACE_STATE_KEY[surface],
    DERIVED_KEY,
    SURFACE_VISIBILITY_KEY[surface],
  ]);
  const state = result[SURFACE_STATE_KEY[surface]] as SurfaceUnlockState | undefined;
  if (!state?.unlocked) return false;

  // 主动 lockSession() 清共享 key → 连带失能并清标记（key 复活不自动解锁）
  if (!result[DERIVED_KEY]) {
    await clearSurfaceState(surface);
    return false;
  }

  const { idleMs } = await readAutoLockConfig();
  if (idleMs !== null) {
    const visibility =
      (result[SURFACE_VISIBILITY_KEY[surface]] as SurfaceVisibility | undefined) ?? {
        hiddenAt: null,
      };
    if (visibility.hiddenAt !== null && Date.now() - visibility.hiddenAt >= idleMs) {
      await clearSurfaceState(surface);
      return false;
    }
  }
  return true;
}

/**
 * 记录 surface 失焦（visibilitychange/blur 触发）。
 * 仅在已解锁且 hiddenAt 未记时写入 visibility key，避免覆盖更早的失焦时刻。
 * 写 visibility key（独立于解锁标记）→ 不触发 useEncryptedContexts 重渲染（止闪烁）。
 */
export async function markHidden(surface: Surface): Promise<void> {
  const session = getChromeStorage('session');
  if (!session) return;
  const stateResult = await session.get([SURFACE_STATE_KEY[surface]]);
  const state = stateResult[SURFACE_STATE_KEY[surface]] as SurfaceUnlockState | undefined;
  if (!state?.unlocked) return;
  const vis = await readVisibility(surface);
  if (vis.hiddenAt === null) {
    await writeVisibility(surface, { hiddenAt: Date.now() });
  }
}

/**
 * 记录 surface 重新可见/聚焦（visibilitychange/focus 触发）。
 * 清除 hiddenAt 使 idle 重新计时。聚焦后下次 isUnlocked 重检（若失焦曾超时已锁则保持 locked）。
 */
export async function markVisible(surface: Surface): Promise<void> {
  const session = getChromeStorage('session');
  if (!session) return;
  const stateResult = await session.get([SURFACE_STATE_KEY[surface]]);
  const state = stateResult[SURFACE_STATE_KEY[surface]] as SurfaceUnlockState | undefined;
  if (!state?.unlocked) return;
  const vis = await readVisibility(surface);
  if (vis.hiddenAt !== null) {
    await writeVisibility(surface, { hiddenAt: null });
  }
}

/** per-surface 解锁 in-flight 守卫：并发 unlock 复用同一 promise，避免重复 PBKDF2 */
const inflightUnlock = new Map<Surface, Promise<boolean>>();
const inflightPinUnlock = new Map<Surface, Promise<boolean>>();

/**
 * 用主密码解锁指定 surface。
 *
 * 每次走完整 PBKDF2 + verifier 校验（复用 CryptoService.unlock），
 * **即使 octane-derived-key 已存在（另一 surface 已解锁）也必须用密码重新派生校验**——
 * 防偷看语义：偷看者在已解锁会话里输任意密码不得通过。
 *
 * 校验通过 → CryptoService.unlock 已写入共享 octane-derived-key（供 getContexts 解密），
 * 此处再写本 surface 独立标记。
 *
 * 并发幂等：同一 surface 的并发 unlock 复用首个 promise（多个组件同时触发解锁时
 * PBKDF2 只派生一次）。
 *
 * @returns true=密码正确并已解锁；false=密码错误
 */
export async function unlock(surface: Surface, password: string): Promise<boolean> {
  const existing = inflightUnlock.get(surface);
  if (existing) return existing;
  const p = (async () => {
    const ok = await cryptoUnlock(password);
    if (!ok) return false;
    await writeSurfaceState(surface, { unlocked: true, unlockedAt: Date.now() });
    await writeVisibility(surface, { hiddenAt: null }); // 重置失焦计时
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
 * 用快速解锁 PIN 解锁指定 surface（#96）。
 *
 * 解信封还原派生密钥（本身即验证）→ 写共享 key + 本 surface 标记。
 * 连续输错 5 次由 CryptoService 熔断（擦信封、停用 PIN），此后调用方回退主密码路径。
 * 并发幂等同 unlock。
 *
 * @returns true=PIN 正确并已解锁；false=PIN 错误 / 信封不可用（含已熔断）
 */
export async function unlockWithPin(surface: Surface, pin: string): Promise<boolean> {
  const existing = inflightPinUnlock.get(surface);
  if (existing) return existing;
  const p = (async () => {
    const ok = await cryptoUnlockWithPin(pin);
    if (!ok) return false;
    await writeSurfaceState(surface, { unlocked: true, unlockedAt: Date.now() });
    await writeVisibility(surface, { hiddenAt: null });
    return true;
  })();
  inflightPinUnlock.set(surface, p);
  try {
    return await p;
  } finally {
    inflightPinUnlock.delete(surface);
  }
}

/**
 * 直接写 surface 解锁标记（不跑密码校验）。
 * 仅供「密码刚刚验证过」的调用方使用（如 setupPassword 成功后补 home 标记），
 * 避免同一密码重复 PBKDF2。日常解锁务必走 unlock / unlockWithPin。
 */
export async function markSurfaceUnlocked(surface: Surface): Promise<void> {
  await writeSurfaceState(surface, { unlocked: true, unlockedAt: Date.now() });
  await writeVisibility(surface, { hiddenAt: null });
}

/**
 * 解锁前置条件检查（点解锁图标前调用）。
 *
 * - no-password：从未设置主密码 → Toast 引导去 home 设置
 * - needs-reset：旧版 meta 无 verifier（无法校验密码）→ Toast 引导去 home 重设
 * - ok：可弹密码框
 */
export async function getUnlockPrerequisite(surface: Surface): Promise<UnlockPrerequisite> {
  void surface; // 前置条件与 surface 无关，保留参数以稳定调用方契约
  if (!(await isPasswordSet())) return 'no-password';
  if (!(await hasVerifier())) return 'needs-reset';
  return 'ok';
}
