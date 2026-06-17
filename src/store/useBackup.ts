import { create } from 'zustand';
import { parseBackupFile } from '@/services/BackupService';
import { exportAllData } from '@/shared/db/database';
import { BACKUP_SCHEMA, BACKUP_VERSION } from '@/shared/types';
import type { BackupData } from '@/shared/types';

export type BackupStatus = 'idle' | 'validating' | 'confirming' | 'running' | 'success' | 'error';

interface BackupState {
  status: BackupStatus;
  errorMessage: string | null;
  pendingData: BackupData | null;
  pickFile: (file: File) => Promise<void>;
  confirmImport: () => Promise<void>;
  cancelImport: () => void;
  exportData: () => Promise<void>;
  reset: () => void;
}

const INITIAL = { status: 'idle' as BackupStatus, errorMessage: null as string | null, pendingData: null as BackupData | null };

export const useBackup = create<BackupState>((set, get) => ({
  ...INITIAL,

  pickFile: async (file) => {
    set({ status: 'validating', errorMessage: null });
    const r = await parseBackupFile(file);
    if (r.ok) {
      set({ status: 'confirming', pendingData: r.data, errorMessage: null });
    } else {
      set({ status: 'error', errorMessage: r.error, pendingData: null });
    }
  },

  confirmImport: async () => {
    const data = get().pendingData;
    if (!data) return;
    set({ status: 'running', errorMessage: null });
    try {
      const res = await browser.runtime.sendMessage({ type: 'octane:apply-import', data });
      if (res && res.ok) {
        set({ status: 'success', pendingData: null });
      } else {
        set({ status: 'error', errorMessage: (res?.error as string) || '导入失败' });
      }
    } catch (e) {
      set({ status: 'error', errorMessage: (e as Error).message || '导入失败' });
    }
  },

  cancelImport: () => set({ status: 'idle', pendingData: null, errorMessage: null }),

  exportData: async () => {
    set({ status: 'running', errorMessage: null });
    try {
      const data = await exportAllData();
      const file = {
        schema: BACKUP_SCHEMA,
        version: BACKUP_VERSION,
        exportedAt: Date.now(),
        appVersion: browser.runtime.getManifest().version,
        data,
      };
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `octane-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      set({ status: 'success' });
    } catch (e) {
      set({ status: 'error', errorMessage: (e as Error).message || '导出失败' });
    }
  },

  reset: () => set(INITIAL),
}));
