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

import { unlock as cryptoUnlock } from '@/services/CryptoService';

/** 需要独立解锁 gate 的 UI 入口点 */
export type Surface = 'home' | 'sidepanel';

/** sidepanel surface 的解锁标记（存 chrome.storage.session，会话级） */
const SIDE_PANEL_STATE_KEY = 'octane-unlock-sidepanel';

export interface SurfaceUnlockState {
  unlocked: boolean;
  unlockedAt: number;
  hiddenAt: number | null;
}

interface ChromeStorageSession {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (data: Record<string, unknown>) => Promise<void>;
  remove: (keys: string[]) => Promise<void>;
}

/** 安全访问 chrome.storage.session（非扩展环境返回 null） */
function getChromeSession(): ChromeStorageSession | null {
  const g = globalThis as Record<string, unknown>;
  const chrome = g['chrome'];
  if (chrome && typeof chrome === 'object') {
    const storage = (chrome as Record<string, unknown>)['storage'];
    if (storage && typeof storage === 'object') {
      const session = (storage as Record<string, unknown>)['session'];
      if (session && typeof session === 'object') {
        return session as ChromeStorageSession;
      }
    }
  }
  return null;
}

/** 写入 sidepanel surface 的解锁标记 */
async function writeSidePanelState(state: SurfaceUnlockState): Promise<void> {
  const session = getChromeSession();
  if (session) {
    await session.set({ [SIDE_PANEL_STATE_KEY]: state });
  }
}

/**
 * 某 surface 当前是否已解锁。
 *
 * sidepanel：读独立标记 octane-unlock-sidepanel.unlocked，**与 home 解锁态无关**
 * （切断联动）。home 解锁写入的 octane-derived-key 不影响此判定。
 *
 * 注意：完整 TTL（grace/hardCap）与 key 存在性校验在后续 T 加入；
 * 当前 T1 仅做标记读取，用于切断 home↔sidepanel 联动。
 *
 * @throws home surface 尚未纳入 UnlockSession（沿用 CryptoService 会话级行为），后续 T 迁移
 */
export async function isUnlocked(surface: Surface): Promise<boolean> {
  if (surface === 'home') {
    throw new Error('home surface 尚未纳入 UnlockSession');
  }
  const session = getChromeSession();
  if (!session) return false;
  const result = await session.get([SIDE_PANEL_STATE_KEY]);
  const state = result[SIDE_PANEL_STATE_KEY] as SurfaceUnlockState | undefined;
  return state?.unlocked === true;
}

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
 * @returns true=密码正确并已解锁；false=密码错误
 * @throws home surface 尚未纳入；未设主密码时由 CryptoService.unlock 抛错（前置条件由调用方/T12 处理）
 */
export async function unlock(surface: Surface, password: string): Promise<boolean> {
  if (surface === 'home') {
    throw new Error('home surface 尚未纳入 UnlockSession');
  }
  const ok = await cryptoUnlock(password);
  if (!ok) return false;
  await writeSidePanelState({ unlocked: true, unlockedAt: Date.now(), hiddenAt: null });
  return true;
}
