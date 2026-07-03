// WXT 通过 unimport 将 `browser` 注入为 `import { browser } from 'wxt/browser'`，
// vi.stubGlobal 无法覆盖该模块绑定，因此用 vi.mock 统一替换。
const { sendMessage, getManifest } = vi.hoisted(() => {
  return {
    sendMessage: vi.fn(),
    getManifest: vi.fn(() => ({ version: '0.0.0' })),
  };
});
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage, getManifest },
  },
}));

// CloudStorageService 整体 mock（store cloud actions 的委托目标）。
const cloud = vi.hoisted(() => ({
  saveCloudConfig: vi.fn(),
  clearCloudConfig: vi.fn(),
  testConnection: vi.fn(),
  uploadBackup: vi.fn(),
  downloadBackup: vi.fn(),
}));
vi.mock('@/services/CloudStorageService', () => cloud);

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBackup } from '@/store/useBackup';
import * as BackupService from '@/services/BackupService';
import * as DB from '@/shared/db/database';
import type { BackupData } from '@/shared/types';

const okData: BackupData = { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null };

beforeEach(() => {
  useBackup.getState().reset();
  sendMessage.mockReset();
  getManifest.mockReset().mockReturnValue({ version: '0.0.0' });
  cloud.saveCloudConfig.mockReset();
  cloud.clearCloudConfig.mockReset();
  cloud.testConnection.mockReset();
  cloud.uploadBackup.mockReset();
  cloud.downloadBackup.mockReset();
});

describe('useBackup', () => {
  it('pickFile 合法文件 → confirming + pendingData', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: okData });
    await useBackup.getState().pickFile(new File(['x'], 'b.json'));
    expect(useBackup.getState().status).toBe('confirming');
    expect(useBackup.getState().pendingData).toEqual(okData);
  });

  it('pickFile 非法文件 → error', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: false, error: '坏文件' });
    await useBackup.getState().pickFile(new File(['x'], 'b.json'));
    expect(useBackup.getState().status).toBe('error');
    expect(useBackup.getState().errorMessage).toBe('坏文件');
  });

  it('confirmImport → 发消息给 background → success', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: okData });
    await useBackup.getState().pickFile(new File(['x'], 'b.json'));
    sendMessage.mockResolvedValue({ ok: true });
    await useBackup.getState().confirmImport();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'octane:apply-import', data: okData });
    expect(useBackup.getState().status).toBe('success');
  });

  it('confirmImport background 失败 → error', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: okData });
    await useBackup.getState().pickFile(new File(['x'], 'b.json'));
    sendMessage.mockResolvedValue({ ok: false, error: '写入失败' });
    await useBackup.getState().confirmImport();
    expect(useBackup.getState().status).toBe('error');
    expect(useBackup.getState().errorMessage).toBe('写入失败');
  });

  it('exportData → 导出 + 下载 → success', async () => {
    vi.spyOn(DB, 'exportAllData').mockResolvedValue(okData);
    const createSpy = vi.fn();
    const revokeSpy = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: createSpy.mockReturnValue('blob:x'), revokeObjectURL: revokeSpy });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await useBackup.getState().exportData();
    expect(useBackup.getState().status).toBe('success');
    expect(createSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled(); // 释放 blob URL，防内存泄漏
    expect(getManifest).toHaveBeenCalled();
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('useBackup cloud actions', () => {
  const cfg = { region: 'r', bucket: 'b', accessKeyId: 'ak', accessKeySecret: 'sk' };

  it('saveCloudConfig → 委托 CloudStorageService.saveCloudConfig', async () => {
    await useBackup.getState().saveCloudConfig('s3', cfg);
    expect(cloud.saveCloudConfig).toHaveBeenCalledWith('s3', cfg);
  });

  it('clearCloudConfig → 委托 CloudStorageService.clearCloudConfig', async () => {
    await useBackup.getState().clearCloudConfig('s3');
    expect(cloud.clearCloudConfig).toHaveBeenCalledWith('s3');
  });

  it('testCloudConnection → 委托 CloudStorageService.testConnection', async () => {
    await useBackup.getState().testCloudConnection('s3');
    expect(cloud.testConnection).toHaveBeenCalledWith('s3');
  });

  it('uploadCloudBackup → buildBackupBlob → uploadBackup(id, blob)', async () => {
    const blob = new Blob(['x']);
    vi.spyOn(BackupService, 'buildBackupBlob').mockResolvedValue(blob);
    cloud.uploadBackup.mockResolvedValue(undefined);
    await useBackup.getState().uploadCloudBackup('s3');
    expect(cloud.uploadBackup).toHaveBeenCalledWith('s3', blob);
  });

  it('restoreFromCloud → download → parseBackupFile → 返回 data', async () => {
    cloud.downloadBackup.mockResolvedValue(new Blob(['x']));
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: okData });
    const data = await useBackup.getState().restoreFromCloud('s3');
    expect(data).toEqual(okData);
  });

  it('restoreFromCloud 解析失败 → throw', async () => {
    cloud.downloadBackup.mockResolvedValue(new Blob(['x']));
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: false, error: '坏备份' });
    await expect(useBackup.getState().restoreFromCloud('s3')).rejects.toThrow('坏备份');
  });

  it('applyCloudRestore → 发 octane:apply-import', async () => {
    sendMessage.mockResolvedValue({ ok: true });
    await useBackup.getState().applyCloudRestore(okData);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'octane:apply-import', data: okData });
  });

  it('applyCloudRestore background 失败 → throw', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: '写入失败' });
    await expect(useBackup.getState().applyCloudRestore(okData)).rejects.toThrow('写入失败');
  });
});
