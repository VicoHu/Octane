import { create } from 'zustand';
import { parseBackupFile, buildBackupBlob } from '@/services/BackupService';
import * as CloudStorageService from '@/services/CloudStorageService';
import type { BackupData } from '@/shared/types';
import type { BackupVersion, ProviderId, CloudStorageConfig } from '@/services/cloud/types';

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
  saveCloudConfig: (id: ProviderId, config: CloudStorageConfig) => Promise<void>;
  clearCloudConfig: (id: ProviderId) => Promise<void>;
  testCloudConnection: (id: ProviderId) => Promise<void>;
  uploadCloudBackup: (id: ProviderId) => Promise<void>;
  restoreFromCloud: (id: ProviderId) => Promise<BackupData>;
  applyCloudRestore: (data: BackupData) => Promise<void>;
  listCloudBackups: (id: ProviderId) => Promise<BackupVersion[]>;
  restoreCloudVersion: (id: ProviderId, versionId: string) => Promise<BackupData>;
  deleteCloudBackup: (id: ProviderId, versionId: string) => Promise<void>;
}

const INITIAL = { status: 'idle' as BackupStatus, errorMessage: null as string | null, pendingData: null as BackupData | null };

/** 下载的 cloud blob → parseBackupFile 校验 → BackupData（restoreFromCloud GET latest 与 restoreCloudVersion 指定版本共用）。 */
async function parseCloudBlob(blob: Blob): Promise<BackupData> {
  const r = await parseBackupFile(new File([blob], 'octane-cloud-backup.json'));
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export const useBackup = create<BackupState>((set, get) => ({
  ...INITIAL,

  pickFile: async (file) => {
    set({ status: 'validating', errorMessage: null });
    const r = await parseBackupFile(file);
    if (r.ok) {
      // kind 防护（C2）：备份入口只接受 backup；分享包走分享导入入口
      if (r.kind === 'share') {
        set({ status: 'error', errorMessage: '此为分享包,请使用分享导入入口', pendingData: null });
        return;
      }
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
      const blob = await buildBackupBlob();
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

  // ===== Cloud actions：薄封装，错误 throw，由组件 catch + Toast =====
  saveCloudConfig: async (id, config) => {
    await CloudStorageService.saveCloudConfig(id, config);
  },
  clearCloudConfig: async (id) => {
    await CloudStorageService.clearCloudConfig(id);
  },
  testCloudConnection: async (id) => {
    await CloudStorageService.testConnection(id);
  },
  uploadCloudBackup: async (id) => {
    const blob = await buildBackupBlob();
    await CloudStorageService.uploadBackup(id, blob);
  },
  restoreFromCloud: async (id) => parseCloudBlob(await CloudStorageService.downloadBackup(id)),
  restoreCloudVersion: async (id, versionId) =>
    parseCloudBlob(await CloudStorageService.downloadBackup(id, versionId)),
  applyCloudRestore: async (data) => {
    const res = await browser.runtime.sendMessage({ type: 'octane:apply-import', data });
    if (!res || !res.ok) throw new Error((res?.error as string) || '恢复失败');
  },
  listCloudBackups: async (id) => CloudStorageService.listBackups(id),
  deleteCloudBackup: async (id, versionId) => {
    await CloudStorageService.deleteBackup(id, versionId);
  },
}));
