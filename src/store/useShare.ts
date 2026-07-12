import { create } from 'zustand';
import { exportAllData } from '@/shared/db/database';
import { buildBackupBlob, parseBackupFile, type ShareImportResult } from '@/services/BackupService';
import type { BackupData, Bookmark, Category, ShareSelection, Workspace } from '@/shared/types';

type ExportStatus = 'idle' | 'loading' | 'exporting' | 'success' | 'error';
type ImportStatus = 'idle' | 'parsing' | 'previewing' | 'importing' | 'success' | 'error';

/** 导出结构（SelectionTree 数据源） */
interface ExportStructure {
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
}

interface ShareState {
  // 导出侧
  exportStatus: ExportStatus;
  exportStructure: ExportStructure | null;
  exportSelection: ShareSelection;
  includeContexts: boolean;
  // 导入侧
  importStatus: ImportStatus;
  importData: BackupData | null;
  importSelection: ShareSelection;
  importResult: ShareImportResult | null;
  importError: string | null;
  // actions
  openExport: () => Promise<void>;
  setExportSelection: (sel: ShareSelection) => void;
  toggleIncludeContexts: (v: boolean) => void;
  runExport: () => Promise<void>;
  pickImportFile: (file: File) => Promise<void>;
  setImportSelection: (sel: ShareSelection) => void;
  runImport: () => Promise<void>;
  resetExport: () => void;
  resetImport: () => void;
}

// 工厂函数产 INITIAL：每次 reset 新对象，防嵌套 selection 共享引用被 mutate
const exportInitial = () => ({
  exportStatus: 'idle' as ExportStatus,
  exportStructure: null as ExportStructure | null,
  exportSelection: { workspaceIds: [], categoryIds: [] } as ShareSelection,
  includeContexts: false,
});
const importInitial = () => ({
  importStatus: 'idle' as ImportStatus,
  importData: null as BackupData | null,
  importSelection: { workspaceIds: [], categoryIds: [] } as ShareSelection,
  importResult: null as ShareImportResult | null,
  importError: null as string | null,
});

/**
 * 分享导出/导入状态机（与 useBackup「一个 store 含多流程」模式一致）。
 * 导出与导入两套独立状态 + actions；browser 全局由 WXT auto-inject（测试 mock wxt/browser）。
 */
export const useShare = create<ShareState>((set, get) => ({
  ...exportInitial(),
  ...importInitial(),

  openExport: async () => {
    set({ ...exportInitial(), exportStatus: 'loading' });
    try {
      const d = await exportAllData();
      set({
        exportStructure: { workspaces: d.workspaces, categories: d.categories, bookmarks: d.bookmarks },
        exportStatus: 'idle',
      });
    } catch {
      set({ exportStatus: 'error' });
    }
  },
  setExportSelection: (sel) => set({ exportSelection: sel }),
  toggleIncludeContexts: (v) => set({ includeContexts: v }),

  runExport: async () => {
    set({ exportStatus: 'exporting' });
    try {
      const { exportSelection: selection, includeContexts } = get();
      const blob = await buildBackupBlob(selection, includeContexts);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `octane-share-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      set({ exportStatus: 'success' });
    } catch {
      set({ exportStatus: 'error' });
    }
  },

  pickImportFile: async (file) => {
    set({ ...importInitial(), importStatus: 'parsing' });
    const r = await parseBackupFile(file);
    if (!r.ok) {
      set({ importStatus: 'error', importError: r.error });
      return;
    }
    // kind 防护（C2）：分享入口只接受 share；全量备份走备份恢复入口
    if (r.kind !== 'share') {
      set({ importStatus: 'error', importError: '此为全量备份,会覆盖现有数据,请使用备份恢复入口' });
      return;
    }
    set({ importData: r.data, importStatus: 'previewing' });
  },
  setImportSelection: (sel) => set({ importSelection: sel }),

  runImport: async () => {
    const data = get().importData;
    if (!data) return;
    set({ importStatus: 'importing' });
    try {
      const res = await browser.runtime.sendMessage({
        type: 'octane:apply-share-import',
        data,
        selection: get().importSelection,
      });
      if (res && res.ok) {
        set({ importResult: res.result ?? null, importStatus: 'success' });
      } else {
        set({ importStatus: 'error', importError: (res?.error as string) || '导入失败' });
      }
    } catch (e) {
      set({ importStatus: 'error', importError: (e as Error).message || '导入失败' });
    }
  },

  resetExport: () => set(exportInitial()),
  resetImport: () => set(importInitial()),
}));
