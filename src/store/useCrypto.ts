import { create } from 'zustand';
import {
  isPasswordSet,
  setupPassword,
  unlock,
  lock,
  isUnlocked,
} from '@/services/CryptoService';

interface CryptoState {
  passwordSet: boolean;
  unlocked: boolean;
  loading: boolean;
  /** 主密码 Modal 是否被手动请求打开（区别于「已设密码重锁」的自动弹出）。 */
  unlockModalOpen: boolean;

  checkStatus: () => Promise<void>;
  setupMasterPassword: (password: string) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  lockSession: () => Promise<void>;
  openUnlockModal: () => void;
  closeUnlockModal: () => void;
}

export const useCrypto = create<CryptoState>((set) => ({
  passwordSet: false,
  unlocked: false,
  loading: false,
  unlockModalOpen: false,

  checkStatus: async () => {
    const passwordSet = await isPasswordSet();
    const unlocked = await isUnlocked();
    set({ passwordSet, unlocked });
  },

  setupMasterPassword: async (password) => {
    set({ loading: true });
    await setupPassword(password);
    set({ passwordSet: true, unlocked: true, loading: false, unlockModalOpen: false });
  },

  unlockWithPassword: async (password) => {
    set({ loading: true });
    await unlock(password);
    set({ unlocked: true, loading: false, unlockModalOpen: false });
  },

  lockSession: async () => {
    await lock();
    set({ unlocked: false });
  },

  openUnlockModal: () => set({ unlockModalOpen: true }),
  closeUnlockModal: () => set({ unlockModalOpen: false }),
}));
