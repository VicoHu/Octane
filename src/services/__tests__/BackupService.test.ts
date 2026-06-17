import { describe, it, expect } from 'vitest';
import { validateBackup } from '@/services/BackupService';
import { BACKUP_SCHEMA, BACKUP_VERSION } from '@/shared/types';
import type { BackupFile, BackupData } from '@/shared/types';

function makeFile(dataOver: Partial<BackupData> = {}, fileOver: Partial<BackupFile> = {}): BackupFile {
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: 1000,
    appVersion: '0.1.3.4',
    data: { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null, ...dataOver },
    ...fileOver,
  };
}

describe('validateBackup', () => {
  it('合法空备份 → ok', () => {
    const r = validateBackup(makeFile());
    expect(r.ok).toBe(true);
  });

  it('非对象输入 → 拒绝', () => {
    expect(validateBackup('x').ok).toBe(false);
    expect(validateBackup(null).ok).toBe(false);
  });

  it('schema 不符 → 拒绝', () => {
    expect(validateBackup(makeFile({}, { schema: 'other' as never })).ok).toBe(false);
  });

  it('version=2（未知）→ 拒绝', () => {
    expect(validateBackup(makeFile({}, { version: 2 })).ok).toBe(false);
  });

  it('data 缺失 → 拒绝', () => {
    const bad = { schema: BACKUP_SCHEMA, version: BACKUP_VERSION, exportedAt: 1, appVersion: 'x' };
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('bookmarks 非数组 → 拒绝', () => {
    expect(validateBackup(makeFile({ bookmarks: 'x' as never })).ok).toBe(false);
  });

  it('bookmark 缺 categoryId → 拒绝', () => {
    const bad = makeFile({ bookmarks: [{ id: 'b', workspaceId: 'w' } as never] });
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('context 缺 bookmarkId → 拒绝', () => {
    const bad = makeFile({ contexts: [{ id: 'c' } as never] });
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('含加密 context 但无 cryptoMetadata → 拒绝', () => {
    const bad = makeFile({
      contexts: [{ id: 'c', bookmarkId: 'b', isEncrypted: true, encryptedData: 'x', iv: 'y' } as never],
      cryptoMetadata: null,
    });
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('含加密 context 且有 cryptoMetadata → ok', () => {
    const ok = makeFile({
      contexts: [{ id: 'c', bookmarkId: 'b', isEncrypted: true, encryptedData: 'x', iv: 'y' } as never],
      cryptoMetadata: { id: 'singleton', salt: 's', iterations: 1, algorithm: 'AES-GCM-256', createdAt: 1 },
    });
    expect(validateBackup(ok).ok).toBe(true);
  });
});