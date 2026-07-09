import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// buildBackupBlob 内部用全局 browser.runtime.getManifest()（WXT auto-inject 自 wxt/browser）。
// 测试环境 stub 之——testing.md 白名单：chrome/browser 扩展 API 属合法副作用边界 mock。
const { getManifest } = vi.hoisted(() => ({ getManifest: vi.fn(() => ({ version: '0.1.11.3-test' })) }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { getManifest } } }));

import { getDB, resetDB, putRecord, getAll, getByKey, replaceAllDataRaw } from '@/shared/db/database';
import { buildBackupBlob, parseBackupFile, applyImport } from '@/services/BackupService';
import * as CryptoService from '@/services/CryptoService';
import { BACKUP_SCHEMA } from '@/shared/types';
import type { BackupData, Bookmark, Category, Context, CryptoMetadata, PinnedTab, Workspace } from '@/shared/types';
import { ContextType } from '@/shared/types';

/**
 * 灾备回归网（characterization tests）
 *
 * 目的：在 0.1.11.3 新增 mergeImportRaw / 改动 BackupService 之前，锁死现有「全量备份」
 * 灾备管道（buildBackupBlob → parseBackupFile → applyImport → replaceAllDataRaw）的行为。
 * 全量备份是用户书签的唯一副本（灾备生命线），这条链任何回归都是数据丢失级事故。
 *
 * 聚焦现有测试盲区（export-import.test.ts / backup-import.test.ts / BackupService.test.ts 均未覆盖）：
 *  - pinnedTabs 的 DB 往返（现有 seed/data 全程不含 pinnedTabs）
 *  - 完整序列化 round-trip（BackupService.test.ts 把 exportAllData mock 成空 okData）
 *  - replaceAllDataRaw 的 if(data.pinnedTabs) clear+put 分支
 *  - v1 旧备份（无 pinnedTabs 字段）恢复时 pinnedTabs store 保留
 *
 * 注：characterization test 针对已存在行为，会立即通过；用 mutation 验证（临时破坏生产代码
 * 看测试变红、再还原）代替 TDD 的「先看测试失败」，证明测试确在抓行为。
 */
const STORES = ['workspaces', 'categories', 'bookmarks', 'contexts', 'pinnedTabs', 'cryptoMetadata'] as const;

async function clearAll(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([...STORES], 'readwrite');
  for (const s of STORES) await tx.objectStore(s).clear();
  await tx.done;
}

beforeEach(async () => {
  resetDB();
  await getDB();
  await clearAll();
  // applyImport 内部调 lock()（访问 chrome.storage.session）；stub 避免扩展环境依赖。
  // 数据往返与 lock 无关——lock 编排已有 backup-import.test.ts 覆盖。
  vi.spyOn(CryptoService, 'lock').mockResolvedValue(undefined);
});
afterAll(() => {
  vi.restoreAllMocks();
  resetDB();
});

// 真实灾备样本：6 表全实体（加密 context + pinnedTabs + cryptoMetadata）
const ws: Workspace = { id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 };
const cat: Category = { id: 'cat-1', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 };
const bm: Bookmark = {
  id: 'bm-1', workspaceId: 'ws-1', categoryId: 'cat-1', name: 'Octane', url: 'https://x.com',
  description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: true, createdAt: 1, updatedAt: 1,
};
const encCtx: Context = {
  id: 'ctx-1', bookmarkId: 'bm-1', type: ContextType.NOTE, title: '密钥', content: '',
  isEncrypted: true, encryptedData: 'BASE64_CIPHER', iv: 'BASE64_IV', order: 0, createdAt: 1, updatedAt: 1,
};
const pin: PinnedTab = { id: 'pin-1', workspaceId: 'ws-1', name: '邮箱', url: 'https://mail.com', order: 0, createdAt: 1 };
const meta: CryptoMetadata = { id: 'singleton', salt: 'S1', iterations: 600000, algorithm: 'AES-GCM-256', createdAt: 1 };

async function seedSix(): Promise<void> {
  await putRecord('workspaces', ws);
  await putRecord('categories', cat);
  await putRecord('bookmarks', bm);
  await putRecord('contexts', encCtx);
  await putRecord('pinnedTabs', pin);
  await putRecord('cryptoMetadata', meta);
}

describe('灾备回归网 — 全量备份导出→覆盖导入 round-trip', () => {
  it('v2 完整往返：6 表（含加密 context + pinnedTabs + cryptoMetadata）逐表一致，密文原样保留', async () => {
    await seedSix();

    // 真实导出（exportAllData 不经 mock）
    const blob = await buildBackupBlob();
    const r = await parseBackupFile(new File([await blob.text()], 'octane-backup.json', { type: 'application/json' }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('parse 失败');

    // 模拟灾备恢复到新设备：清空 DB
    await clearAll();
    expect(await getAll('pinnedTabs')).toHaveLength(0);

    await applyImport(r.data);

    // 逐表一致
    expect(await getAll('workspaces')).toHaveLength(1);
    expect(await getAll('categories')).toHaveLength(1);
    expect(await getAll('bookmarks')).toHaveLength(1);
    expect(await getAll('contexts')).toHaveLength(1);
    expect(await getAll('pinnedTabs')).toHaveLength(1);
    // 加密 context 密文往返不变（存储态，未被解密）
    const gotCtx = (await getAll<Context>('contexts'))[0]!;
    expect(gotCtx.encryptedData).toBe('BASE64_CIPHER');
    expect(gotCtx.iv).toBe('BASE64_IV');
    expect(gotCtx.isEncrypted).toBe(true);
    // pinnedTabs + cryptoMetadata 往返
    expect((await getAll<PinnedTab>('pinnedTabs'))[0]!.id).toBe('pin-1');
    expect((await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton'))?.salt).toBe('S1');
  });

  it('覆盖恢复语义：接收方旧数据（workspace/pinnedTab/cryptoMetadata）被新备份清空并覆盖', async () => {
    // 1. 先准备「新备份」（seedSix 数据）
    await seedSix();
    const blob = await buildBackupBlob();
    const r = await parseBackupFile(new File([await blob.text()], 'b.json'));
    if (!r.ok) throw new Error('parse 失败');

    // 2. 清空后预置接收方旧数据
    await clearAll();
    await putRecord('workspaces', { ...ws, id: 'ws-old', name: '旧工作区' });
    await putRecord('pinnedTabs', { ...pin, id: 'pin-old', name: '旧常驻' });
    await putRecord('cryptoMetadata', { ...meta, salt: 'OLD' });

    // 3. 灾备恢复（新备份覆盖导入）
    await applyImport(r.data);

    // 旧数据被清空
    expect(await getByKey('workspaces', 'ws-old')).toBeUndefined();
    expect(await getByKey('pinnedTabs', 'pin-old')).toBeUndefined();
    // 新数据写入 + cryptoMetadata 被覆盖
    expect(await getAll('workspaces')).toHaveLength(1);
    expect(await getAll('pinnedTabs')).toHaveLength(1);
    expect((await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton'))?.salt).toBe('S1');
  });
});

describe('灾备回归网 — pinnedTabs 覆盖分支（replaceAllDataRaw 零覆盖盲区）', () => {
  it('replaceAllDataRaw 含 pinnedTabs → 先 clear 再 put（旧常驻清空，新常驻写入）', async () => {
    await putRecord('pinnedTabs', { ...pin, id: 'pin-old' });
    const data: BackupData = {
      workspaces: [], categories: [], bookmarks: [], contexts: [],
      pinnedTabs: [pin], cryptoMetadata: null,
    };
    await replaceAllDataRaw(data);
    expect(await getByKey('pinnedTabs', 'pin-old')).toBeUndefined();
    expect(await getAll('pinnedTabs')).toHaveLength(1);
    expect((await getAll<PinnedTab>('pinnedTabs'))[0]!.id).toBe('pin-1');
  });

  it('replaceAllDataRaw 不含 pinnedTabs（undefined）→ pinnedTabs store 原封不动', async () => {
    await putRecord('pinnedTabs', { ...pin, id: 'pin-keep' });
    const data: BackupData = {
      workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null,
    };
    await replaceAllDataRaw(data);
    expect(await getAll('pinnedTabs')).toHaveLength(1);
    expect((await getAll<PinnedTab>('pinnedTabs'))[0]!.id).toBe('pin-keep');
  });
});

describe('灾备回归网 — v1 旧备份向后兼容（无 pinnedTabs 字段）', () => {
  it('v1 备份导入到有 pinnedTabs 的设备 → pinnedTabs store 保留（灾备不破坏常驻标签）', async () => {
    await putRecord('pinnedTabs', { ...pin, id: 'pin-existing' });

    // 真实 v1 备份：version=1，data 无 pinnedTabs 字段
    const v1File = {
      schema: BACKUP_SCHEMA,
      version: 1,
      exportedAt: 1,
      appVersion: '0.1.10.1',
      data: { workspaces: [ws], categories: [cat], bookmarks: [bm], contexts: [encCtx], cryptoMetadata: meta },
    };
    const r = await parseBackupFile(new File([JSON.stringify(v1File)], 'v1.json', { type: 'application/json' }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('parse 失败');
    expect(r.data.pinnedTabs).toBeUndefined();

    await applyImport(r.data);

    // pinnedTabs store 保留原有，未被清空（v1 缺字段 → replaceAllDataRaw 不动该 store）
    expect(await getAll('pinnedTabs')).toHaveLength(1);
    expect((await getAll<PinnedTab>('pinnedTabs'))[0]!.id).toBe('pin-existing');
  });
});
