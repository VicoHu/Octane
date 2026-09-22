import { create } from 'zustand';
import {
  isPasswordSet,
  setupPassword,
  lock,
  hasVerifier,
  clearMeta,
  isPinEnabled,
  hasPinEnvelope,
  changePassword as cryptoChangePassword,
} from '@/services/CryptoService';
import {
  unlock as surfaceUnlock,
  unlockWithPin as surfaceUnlockWithPin,
  markSurfaceUnlocked,
  isUnlocked as surfaceIsUnlocked,
} from '@/services/UnlockSession';
import {
  getAllContexts,
  reencryptAllContexts,
  syncContextMeta,
} from '@/services/ContextService';
import { deleteRecord } from '@/shared/db/database';

interface CryptoState {
  passwordSet: boolean;
  unlocked: boolean;
  loading: boolean;
  /** 已设密码但 meta 无 verifier（旧版数据），需引导用户重设密码。 */
  needsReset: boolean;
  /** 主密码 Modal 是否被手动请求打开（区别于「已设密码重锁」的自动弹出）。 */
  unlockModalOpen: boolean;
  /** 已启用快速解锁 PIN（设置成功或历史启用） */
  pinEnabled: boolean;
  /** 当前模式下 PIN 信封可用（决定解锁弹窗默认显示 PIN 输入还是主密码） */
  pinEnvelopeAvailable: boolean;

  checkStatus: () => Promise<void>;
  setupMasterPassword: (password: string) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  unlockWithPin: (pin: string) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string, pin?: string) => Promise<void>;
  resetPassword: (newPassword: string) => Promise<void>;
  lockSession: () => Promise<void>;
  openUnlockModal: () => void;
  closeUnlockModal: () => void;
  /** 刷新 PIN 状态（设置/关闭/熔断后调用） */
  refreshPinStatus: () => Promise<void>;
}

export const useCrypto = create<CryptoState>((set) => ({
  passwordSet: false,
  unlocked: false,
  loading: false,
  needsReset: false,
  unlockModalOpen: false,
  pinEnabled: false,
  pinEnvelopeAvailable: false,

  checkStatus: async () => {
    const passwordSet = await isPasswordSet();
    // home 已纳入 UnlockSession surface 体系：闲置自动锁定/共享 key 连带清标记均在其判定内
    const unlocked = passwordSet ? await surfaceIsUnlocked('home') : false;
    // 已设密码但无 verifier = 旧版数据，密码系统未真正生效，需重设。
    const needsReset = passwordSet && !(await hasVerifier());
    const pinEnabled = passwordSet ? await isPinEnabled() : false;
    const pinEnvelopeAvailable = pinEnabled ? await hasPinEnvelope() : false;
    set({ passwordSet, unlocked, needsReset, pinEnabled, pinEnvelopeAvailable });
  },

  setupMasterPassword: async (password) => {
    set({ loading: true });
    await setupPassword(password);
    // setupPassword 已完成派生+校验并写入共享 key，这里只补 home 标记（免二次 PBKDF2）
    await markSurfaceUnlocked('home');
    set({ passwordSet: true, unlocked: true, loading: false, unlockModalOpen: false });
  },

  unlockWithPassword: async (password) => {
    set({ loading: true });
    try {
      // 走 UnlockSession('home')：完整 PBKDF2 + verifier + 写 home 独立标记
      const ok = await surfaceUnlock('home', password);
      if (!ok) {
        set({ loading: false });
        throw new Error('密码错误');
      }
      set({ unlocked: true, loading: false, unlockModalOpen: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  unlockWithPin: async (pin) => {
    set({ loading: true });
    try {
      const ok = await surfaceUnlockWithPin('home', pin);
      if (!ok) {
        set({ loading: false });
        throw new Error('PIN 错误');
      }
      set({ unlocked: true, loading: false, unlockModalOpen: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  changePassword: async (oldPassword, newPassword, pin) => {
    set({ loading: true });
    try {
      // 重加密在回调内用 ContextService 完成；CryptoService 保证 meta 最后写（原子）。
      // 提供 PIN 则信封随之重建（PIN 保持有效），否则 PIN 自动停用。
      await cryptoChangePassword(oldPassword, newPassword, async (oldKey, newKey) => {
        await reencryptAllContexts(oldKey, newKey);
      }, pin !== undefined ? { pin } : undefined);
      const pinEnabled = await isPinEnabled();
      set({ loading: false, pinEnabled, pinEnvelopeAvailable: pinEnabled ? await hasPinEnvelope() : false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  resetPassword: async (newPassword) => {
    set({ loading: true });
    try {
      // 清空所有加密 contexts，并重算受影响 bookmark 的冗余字段。
      const all = await getAllContexts();
      const affected = new Set<string>();
      for (const ctx of all) {
        if (ctx.isEncrypted) {
          affected.add(ctx.bookmarkId);
          await deleteRecord('contexts', ctx.id);
        }
      }
      for (const bookmarkId of affected) {
        await syncContextMeta(bookmarkId);
      }
      // 清旧 meta + session，再重新设置主密码。
      await clearMeta();
      await setupPassword(newPassword);
      await markSurfaceUnlocked('home');
      set({
        passwordSet: true,
        unlocked: true,
        needsReset: false,
        pinEnabled: false,
        pinEnvelopeAvailable: false,
        loading: false,
        unlockModalOpen: false,
      });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  lockSession: async () => {
    // 清共享派生密钥；home/sidepanel 标记由下次 isUnlocked 连带清除（key 缺失 → 清标记）
    await lock();
    set({ unlocked: false });
  },

  openUnlockModal: () => set({ unlockModalOpen: true }),
  closeUnlockModal: () => set({ unlockModalOpen: false }),

  refreshPinStatus: async () => {
    const pinEnabled = await isPinEnabled();
    set({ pinEnabled, pinEnvelopeAvailable: pinEnabled ? await hasPinEnvelope() : false });
  },
}));
