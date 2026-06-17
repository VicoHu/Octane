import { describe, it, expect } from 'vitest';
import { validateBackup, parseBackupFile, MAX_BACKUP_BYTES } from '@/services/BackupService';
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

describe('parseBackupFile', () => {
  it('合法文件 → ok 且 data 正确', async () => {
    const payload = JSON.stringify(makeFile({ workspaces: [{ id: 'w', name: 'n', icon: 'i', createdAt: 1, order: 0 }] }));
    const file = new File([payload], 'b.json', { type: 'application/json' });
    const r = await parseBackupFile(file);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.workspaces).toHaveLength(1);
  });

  it('超 50MB → 拒绝（不解析）', async () => {
    const huge = new File([new Uint8Array(MAX_BACKUP_BYTES + 1)], 'huge.json');
    const r = await parseBackupFile(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/过大|50/);
  });

  it('非 JSON → 拒绝', async () => {
    const file = new File(['{不是json'], 'bad.json', { type: 'application/json' });
    const r = await parseBackupFile(file);
    expect(r.ok).toBe(false);
  });
});
