import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getManifest } = vi.hoisted(() => ({ getManifest: vi.fn(() => ({ version: '0.1.3.5' })) }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { getManifest } } }));

import { validateBackup, parseBackupFile, MAX_BACKUP_BYTES, buildBackupBlob } from '@/services/BackupService';
import * as DB from '@/shared/db/database';
import { BACKUP_SCHEMA, BACKUP_VERSION } from '@/shared/types';
import type { BackupFile, BackupData } from '@/shared/types';

function makeFile(dataOver: Partial<BackupData> = {}, fileOver: Partial<BackupFile> = {}): BackupFile {
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: 1000,
    appVersion: '0.1.3.4',
    data: {
      workspaces: [], categories: [], bookmarks: [], contexts: [], pinnedTabs: [], cryptoMetadata: null,
      taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [],
      ...dataOver,
    },
    ...fileOver,
  };
}

const okData: BackupData = {
  workspaces: [], categories: [], bookmarks: [], contexts: [], pinnedTabs: [], cryptoMetadata: null,
  taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [],
};

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

  it('version=7（未知版本，超出已发布）→ 拒绝', () => {
    expect(validateBackup(makeFile({}, { version: 7 } as never)).ok).toBe(false);
  });

  it('version=3（v3 新格式）→ ok', () => {
    expect(validateBackup(makeFile({}, { version: 3 } as never)).ok).toBe(true);
  });

  it('kind 透传：v3 backup → kind=backup', () => {
    const r = validateBackup(makeFile({}, { kind: 'backup' } as never));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('backup');
  });

  it('kind 透传：v3 share → kind=share', () => {
    const r = validateBackup(makeFile({}, { kind: 'share' } as never));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('share');
  });

  it('kind 缺失（v1/v2 旧文件）→ 默认 backup（向后兼容）', () => {
    const r = validateBackup(makeFile());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('backup');
  });

  it('v1 备份（无 pinnedTabs 字段）→ ok 且 pinnedTabs 保持 undefined（让 replaceAllDataRaw 保留现有数据）', () => {
    // 模拟真实 v1 备份：version=1，data 不含 pinnedTabs
    const v1File = {
      schema: BACKUP_SCHEMA,
      version: 1,
      exportedAt: 1,
      appVersion: '0.1.10.1',
      data: { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null },
    };
    const r = validateBackup(v1File);
    expect(r.ok).toBe(true);
    // 关键契约：v1 缺字段时保持 undefined，不 backfill []——
    // 否则 replaceAllDataRaw 的 if(data.pinnedTabs) 会因 [] truthy 而清空现有 pinnedTabs
    if (r.ok) expect(r.data.pinnedTabs).toBeUndefined();
  });

  it('v2 备份缺 pinnedTabs 字段 → 拒绝（v2 必须含此字段，缺失判 corrupt）', () => {
    const v2File = {
      schema: BACKUP_SCHEMA,
      version: 2,
      exportedAt: 1,
      appVersion: '0.1.11.0',
      data: { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null },
    };
    expect(validateBackup(v2File).ok).toBe(false);
  });

  it('version 非数字 → 拒绝', () => {
    expect(validateBackup(makeFile({}, { version: '2' as never })).ok).toBe(false);
    expect(validateBackup(makeFile({}, { version: null as never })).ok).toBe(false);
  });

  it('v2 备份（含 pinnedTabs）→ ok 且透传', () => {
    const pin = { id: 'p1', workspaceId: 'w', name: 'G', url: 'https://g.com', order: 0, createdAt: 1 };
    const r = validateBackup(makeFile({ pinnedTabs: [pin] as never }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.pinnedTabs).toEqual([pin]);
  });

  it('pinnedTabs: null → 拒绝（非 undefined 也非数组）', () => {
    expect(validateBackup(makeFile({ pinnedTabs: null as never })).ok).toBe(false);
  });

  it('pinnedTabs 非数组 → 拒绝', () => {
    expect(validateBackup(makeFile({ pinnedTabs: 'x' as never })).ok).toBe(false);
  });

  it('pinnedTab 缺 id → 拒绝', () => {
    const bad = makeFile({ pinnedTabs: [{ workspaceId: 'w', url: 'u', name: 'n' } as never] });
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('pinnedTab 缺 workspaceId → 拒绝', () => {
    const bad = makeFile({ pinnedTabs: [{ id: 'p', url: 'u', name: 'n' } as never] });
    expect(validateBackup(bad).ok).toBe(false);
  });

  it('pinnedTab 缺 url → 拒绝', () => {
    const bad = makeFile({ pinnedTabs: [{ id: 'p1', workspaceId: 'w', name: 'G' } as never] });
    expect(validateBackup(bad).ok).toBe(false);
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

describe('buildBackupBlob', () => {
  beforeEach(() => {
    getManifest.mockClear();
  });

  it('生成 schema/version/kind/appVersion/data 正确的备份 Blob（v3, kind=backup）', async () => {
    vi.spyOn(DB, 'exportAllData').mockResolvedValue(okData);
    const blob = await buildBackupBlob();
    const parsed = JSON.parse(await blob.text());
    expect(parsed.schema).toBe(BACKUP_SCHEMA);
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.kind).toBe('backup');
    expect(parsed.appVersion).toBe('0.1.3.5');
    expect(parsed.data).toEqual(okData);
    expect(getManifest).toHaveBeenCalled();
  });
});
