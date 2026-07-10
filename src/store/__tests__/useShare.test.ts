import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useShare } from '@/store/useShare';
import * as BackupService from '@/services/BackupService';
import * as DB from '@/shared/db/database';

// WXT 全局 browser（sendMessage）— vi.hoisted 避 TDZ（与 useBackup.test 一致）
const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));

const structureData = {
  workspaces: [{ id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 }],
  categories: [{ id: 'cat-1', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 }],
  bookmarks: [],
  contexts: [], pinnedTabs: [], cryptoMetadata: null,
};
const sharePkg = { ...structureData };

beforeEach(() => {
  useShare.getState().resetExport();
  useShare.getState().resetImport();
  sendMessage.mockReset();
  vi.restoreAllMocks();
});

describe('useShare — 导出状态机', () => {
  it('openExport → loading→idle + exportStructure 加载', async () => {
    vi.spyOn(DB, 'exportAllData').mockResolvedValue(structureData);
    await useShare.getState().openExport();
    const s = useShare.getState();
    expect(s.exportStatus).toBe('idle');
    expect(s.exportStructure?.workspaces).toHaveLength(1);
  });

  it('openExport 失败 → error', async () => {
    vi.spyOn(DB, 'exportAllData').mockRejectedValue(new Error('读库失败'));
    await useShare.getState().openExport();
    expect(useShare.getState().exportStatus).toBe('error');
  });

  it('runExport → buildBackupBlob(selection, includeContexts) + 下载 + success', async () => {
    vi.spyOn(DB, 'exportAllData').mockResolvedValue(structureData);
    await useShare.getState().openExport();
    useShare.getState().setExportSelection({ workspaceIds: ['ws-1'], categoryIds: [] });
    useShare.getState().toggleIncludeContexts(true);
    const buildSpy = vi.spyOn(BackupService, 'buildBackupBlob').mockResolvedValue(new Blob(['{}']));
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await useShare.getState().runExport();
    expect(buildSpy).toHaveBeenCalledWith({ workspaceIds: ['ws-1'], categoryIds: [] }, true);
    expect(useShare.getState().exportStatus).toBe('success');
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('runExport 失败 → error', async () => {
    vi.spyOn(BackupService, 'buildBackupBlob').mockRejectedValue(new Error('打包失败'));
    await useShare.getState().runExport();
    expect(useShare.getState().exportStatus).toBe('error');
  });
});

describe('useShare — 导入状态机', () => {
  it('pickImportFile kind=share → parsing→previewing + importData', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: sharePkg, kind: 'share' });
    await useShare.getState().pickImportFile(new File(['{}'], 's.json'));
    const s = useShare.getState();
    expect(s.importStatus).toBe('previewing');
    expect(s.importData).toEqual(sharePkg);
  });

  it('pickImportFile kind=backup → error 分流', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: sharePkg, kind: 'backup' });
    await useShare.getState().pickImportFile(new File(['{}'], 'b.json'));
    const s = useShare.getState();
    expect(s.importStatus).toBe('error');
    expect(s.importError).toMatch(/备份恢复|会覆盖/);
  });

  it('pickImportFile !ok → error', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: false, error: '坏文件' });
    await useShare.getState().pickImportFile(new File(['{}'], 'x.json'));
    expect(useShare.getState().importStatus).toBe('error');
    expect(useShare.getState().importError).toBe('坏文件');
  });

  it('runImport → sendMessage(octane:apply-share-import, data, selection) + success', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: sharePkg, kind: 'share' });
    await useShare.getState().pickImportFile(new File(['{}'], 's.json'));
    useShare.getState().setImportSelection({ workspaceIds: ['ws-1'], categoryIds: [] });
    sendMessage.mockResolvedValue({ ok: true, result: { workspaces: 1, categories: 1, bookmarks: 0, skippedEncrypted: 0 } });
    await useShare.getState().runImport();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'octane:apply-share-import',
      data: sharePkg,
      selection: { workspaceIds: ['ws-1'], categoryIds: [] },
    }));
    const s = useShare.getState();
    expect(s.importStatus).toBe('success');
    expect(s.importResult?.workspaces).toBe(1);
  });

  it('runImport res.ok=false → error', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: sharePkg, kind: 'share' });
    await useShare.getState().pickImportFile(new File(['{}'], 's.json'));
    sendMessage.mockResolvedValue({ ok: false, error: '事务失败' });
    await useShare.getState().runImport();
    expect(useShare.getState().importStatus).toBe('error');
    expect(useShare.getState().importError).toBe('事务失败');
  });

  it('runImport salt 冲突 → success + skippedEncrypted 计数', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: sharePkg, kind: 'share' });
    await useShare.getState().pickImportFile(new File(['{}'], 's.json'));
    sendMessage.mockResolvedValue({ ok: true, result: { workspaces: 1, categories: 1, bookmarks: 0, skippedEncrypted: 2 } });
    await useShare.getState().runImport();
    expect(useShare.getState().importResult?.skippedEncrypted).toBe(2);
    expect(useShare.getState().importStatus).toBe('success');
  });
});
