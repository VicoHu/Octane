import { create } from 'zustand';
import {
  isPasswordSet,
  setupPassword,
  unlock,
  lock,
  isUnlocked,
  hasVerifier,
  clearMeta,
  changePassword as cryptoChangePassword,
} from '@/services/CryptoService';
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

  checkStatus: () => Promise<void>;
  setupMasterPassword: (password: string) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  resetPassword: (newPassword: string) => Promise<void>;
  lockSession: () => Promise<void>;
  openUnlockModal: () => void;
  closeUnlockModal: () => void;
}

export const useCrypto = create<CryptoState>((set) => ({
  passwordSet: false,
  unlocked: false,
  loading: false,
  needsReset: false,
  unlockModalOpen: false,

  checkStatus: async () => {
    const passwordSet = await isPasswordSet();
    const unlocked = await isUnlocked();
    // 已设密码但无 verifier = 旧版数据，密码系统未真正生效，需重设。
    const needsReset = passwordSet && !(await hasVerifier());
    set({ passwordSet, unlocked, needsReset });
  },

  setupMasterPassword: async (password) => {
    set({ loading: true });
    await setupPassword(password);
    set({ passwordSet: true, unlocked: true, loading: false, unlockModalOpen: false });
  },

  unlockWithPassword: async (password) => {
    set({ loading: true });
    try {
      const ok = await unlock(password);
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

  changePassword: async (oldPassword, newPassword) => {
    set({ loading: true });
    try {
      // 重加密在回调内用 ContextService 完成；CryptoService 保证 meta 最后写（原子）。
      await cryptoChangePassword(oldPassword, newPassword, async (oldKey, newKey) => {
        await reencryptAllContexts(oldKey, newKey);
      });
      set({ loading: false });
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
      set({
        passwordSet: true,
        unlocked: true,
        needsReset: false,
        loading: false,
        unlockModalOpen: false,
      });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  lockSession: async () => {
    await lock();
    set({ unlocked: false });
  },

  openUnlockModal: () => set({ unlockModalOpen: true }),
  closeUnlockModal: () => set({ unlockModalOpen: false }),
}));
