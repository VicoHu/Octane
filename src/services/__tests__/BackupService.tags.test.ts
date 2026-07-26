import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_NAME, BACKUP_SCHEMA, BACKUP_VERSION } from '@/shared/types';
import type { BackupFile } from '@/shared/types';
import { getDB, resetDB, exportAllData, replaceAllDataRaw, putRecord } from '@/shared/db/database';
import { validateBackup, buildBackupBlob } from '@/services/BackupService';
import * as BookmarkService from '@/services/BookmarkService';
import { MAX_TAG_LENGTH, MAX_TAG_COUNT } from '@/shared/utils/tagRules';

// ── 测试基建 ──────────────────────────────────────────

afterEach(async () => {
  try {
    const db = await getDB();
    db.close();
  } catch {
    // 缓存为空时 getDB 新建连接，忽略本次异常
  }
  resetDB();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

/** 构造带 tags 的 v5 备份文件（Bookmark 仅含必需字段 + tags） */
function makeV5File(bookmarks: unknown[], overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: 1000,
    appVersion: '0.1.3.4',
    data: {
      workspaces: [],
      categories: [],
      bookmarks: bookmarks as never,
      contexts: [],
      pinnedTabs: [],
      cryptoMetadata: null,
    },
    ...overrides,
  };
}

/** 构造 v4 旧备份文件（无 tags 声明） */
function makeV4File(bookmarks: unknown[], overrides: Partial<BackupFile> = {}): unknown {
  return {
    schema: BACKUP_SCHEMA,
    version: 4,
    exportedAt: 1000,
    appVersion: '0.1.3.4',
    data: {
      workspaces: [],
      categories: [],
      bookmarks: bookmarks as never,
      contexts: [],
      pinnedTabs: [],
      cryptoMetadata: null,
    },
    ...overrides,
  };
}

function bookmarkWithTags(id: string, tags: unknown, categoryId = 'c'): Record<string, unknown> {
  return {
    id,
    workspaceId: 'w',
    categoryId,
    name: id,
    url: 'https://x.com',
    description: '',
    faviconUrl: '',
    contextCount: 0,
    hasEncryptedContext: false,
    createdAt: 1,
    updatedAt: 1,
    order: 0,
    tags,
  };
}

// ── v5 严格校验：合法 Tag 透传 ──────────────────────

describe('validateBackup — v5 新格式合法 Tag 透传', () => {
  it('合法 Tag 数组 → ok 且原样保留', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', ['工作', '学习'])]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bookmarks[0]?.tags).toEqual(['工作', '学习']);
  });

  it('空 Tag 数组 → ok', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', [])]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bookmarks[0]?.tags).toEqual([]);
  });

  it('单个合法 Tag → ok', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', ['开发'])]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bookmarks[0]?.tags).toEqual(['开发']);
  });
});

// ── v5 严格校验：非法 Tag 拒绝 ──────────────────────

describe('validateBackup — v5 新格式非法 Tag 明确拒绝', () => {
  it('tags 非数组（字符串）→ 拒绝', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', '工作')]));
    expect(r.ok).toBe(false);
  });

  it('tags 非数组（null）→ 拒绝', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', null)]));
    expect(r.ok).toBe(false);
  });

  it('tags 非数组（对象）→ 拒绝', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', { a: 1 })]));
    expect(r.ok).toBe(false);
  });

  it('tag 元素非字符串（数字）→ 拒绝', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', [123])]));
    expect(r.ok).toBe(false);
  });

  it('tag 元素非字符串（null）→ 拒绝', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', [null])]));
    expect(r.ok).toBe(false);
  });

  it('空白 Tag（纯空格）→ 拒绝', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', ['   '])]));
    expect(r.ok).toBe(false);
  });

  it('含内部空白的 Tag → 拒绝', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', ['a b'])]));
    expect(r.ok).toBe(false);
  });

  it('超长 Tag（超过 MAX_TAG_LENGTH）→ 拒绝', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', ['x'.repeat(MAX_TAG_LENGTH + 1)])]));
    expect(r.ok).toBe(false);
  });

  it('重复 Tag（大小写不敏感）→ 拒绝', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', ['Foo', 'foo'])]));
    expect(r.ok).toBe(false);
  });

  it('超量 Tag（超过 MAX_TAG_COUNT）→ 拒绝', () => {
    const tags = Array.from({ length: MAX_TAG_COUNT + 1 }, (_, i) => `tag${i}`);
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', tags)]));
    expect(r.ok).toBe(false);
  });

  it('Tag 需 trim（首尾空白）→ 拒绝（不做静默修改）', () => {
    const r = validateBackup(makeV5File([bookmarkWithTags('b1', [' foo'])]));
    expect(r.ok).toBe(false);
  });
});

// ── 旧版本兼容：缺 tags → 空数组 ────────────────────

describe('validateBackup — v4 及以下旧版本缺 tags 兼容', () => {
  it('v4 备份 bookmark 缺 tags → 回填空数组并继续导入', () => {
    const parsed = makeV4File([
      { id: 'b1', workspaceId: 'w', categoryId: 'c', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1, order: 0 },
    ]);
    const r = validateBackup(parsed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bookmarks[0]?.tags).toEqual([]);
  });

  it('v3 备份 bookmark 缺 tags → 回填空数组', () => {
    const parsed = {
      schema: BACKUP_SCHEMA,
      version: 3,
      kind: 'backup',
      exportedAt: 1,
      appVersion: 'x',
      data: {
        workspaces: [],
        categories: [],
        bookmarks: [
          { id: 'b1', workspaceId: 'w', categoryId: 'c', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 },
        ],
        contexts: [],
        pinnedTabs: [],
        cryptoMetadata: null,
      },
    };
    const r = validateBackup(parsed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bookmarks[0]?.tags).toEqual([]);
  });
});

// ── 导出往返：tags 完整保留 ──────────────────────────

describe('导出 → 全量恢复 — tags 往返完整保留', () => {
  it('exportAllData → replaceAllDataRaw 往返：tags 原样保留', async () => {
    await putRecord('workspaces', { id: 'w', name: 'w', icon: '📁', createdAt: 0, order: 0 });
    await putRecord('categories', { id: 'c', workspaceId: 'w', name: 'c', icon: '📁', order: 0, createdAt: 0 });
    await putRecord('bookmarks', {
      id: 'b1',
      workspaceId: 'w',
      categoryId: 'c',
      name: 'b1',
      url: 'https://x.com',
      description: '',
      faviconUrl: '',
      contextCount: 0,
      hasEncryptedContext: false,
      createdAt: 0,
      updatedAt: 0,
      order: 0,
      tags: ['工作', '重要'],
    });
    await putRecord('bookmarks', {
      id: 'b2',
      workspaceId: 'w',
      categoryId: 'c',
      name: 'b2',
      url: 'https://y.com',
      description: '',
      faviconUrl: '',
      contextCount: 0,
      hasEncryptedContext: false,
      createdAt: 1,
      updatedAt: 1,
      order: 1,
      tags: [],
    });

    const data = await exportAllData();
    await replaceAllDataRaw(data);

    const list = await BookmarkService.listBookmarks('c');
    expect(list[0]?.tags).toEqual(['工作', '重要']);
    expect(list[1]?.tags).toEqual([]);
  });

  it('buildBackupBlob 导出 → parseBackFile 导入：tags 完整携带', async () => {
    const { vi } = await import('vitest');
    const wxtBrowser = await import('wxt/browser');
    vi.spyOn(wxtBrowser.browser.runtime, 'getManifest').mockReturnValue({ version: '0.2.2.1' } as never);

    await putRecord('workspaces', { id: 'w', name: 'w', icon: '📁', createdAt: 0, order: 0 });
    await putRecord('categories', { id: 'c', workspaceId: 'w', name: 'c', icon: '📁', order: 0, createdAt: 0 });
    await putRecord('bookmarks', {
      id: 'b1',
      workspaceId: 'w',
      categoryId: 'c',
      name: 'b1',
      url: 'https://x.com',
      description: '',
      faviconUrl: '',
      contextCount: 0,
      hasEncryptedContext: false,
      createdAt: 0,
      updatedAt: 0,
      order: 0,
      tags: ['前端', 'React'],
    });

    const blob = await buildBackupBlob();
    const text = await blob.text();
    const parsed = JSON.parse(text);
    expect(parsed.data.bookmarks[0].tags).toEqual(['前端', 'React']);
  });
});
