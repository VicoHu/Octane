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

  checkStatus: () => Promise<void>;
  setupMasterPassword: (password: string) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  lockSession: () => Promise<void>;
}

export const useCrypto = create<CryptoState>((set) => ({
  passwordSet: false,
  unlocked: false,
  loading: false,

  checkStatus: async () => {
    const passwordSet = await isPasswordSet();
    const unlocked = await isUnlocked();
    set({ passwordSet, unlocked });
  },

  setupMasterPassword: async (password) => {
    set({ loading: true });
    await setupPassword(password);
    set({ passwordSet: true, unlocked: true, loading: false });
  },

  unlockWithPassword: async (password) => {
    set({ loading: true });
    await unlock(password);
    set({ unlocked: true, loading: false });
  },

  lockSession: async () => {
    await lock();
    set({ unlocked: false });
  },
}));
