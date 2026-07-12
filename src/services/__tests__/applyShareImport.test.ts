import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// broadcast 是跨上下文副作用,测试 mock;syncContextMeta/mergeImportRaw 用真实 fake-indexeddb。
vi.mock('@/shared/db/database', async (importActual) => {
  const actual = await importActual<typeof import('@/shared/db/database')>();
  return { ...actual, broadcastChange: vi.fn(), broadcastImport: vi.fn() };
});

import { getDB, resetDB, putRecord, getAll, getByKey } from '@/shared/db/database';
import { applyShareImport } from '@/services/BackupService';
import * as CryptoService from '@/services/CryptoService';
import type { BackupData, Bookmark, Category, Context, CryptoMetadata, Workspace } from '@/shared/types';
import { ContextType } from '@/shared/types';

// 发送方分享包样本(全拷贝:含 cryptoMetadata + 加密 context)
const ws: Workspace = { id: 'ws-s', name: '工作', icon: '📁', createdAt: 1, order: 0 };
const cat: Category = { id: 'cat-s', workspaceId: 'ws-s', name: '工具', icon: '📂', order: 0, createdAt: 1 };
const bm: Bookmark = { id: 'bm-s', workspaceId: 'ws-s', categoryId: 'cat-s', name: 'A', url: 'https://a.com', description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: true, createdAt: 1, updatedAt: 1 };
const encCtx: Context = { id: 'ctx-s', bookmarkId: 'bm-s', type: ContextType.NOTE, title: '密钥', content: '', isEncrypted: true, encryptedData: 'CIPHER', iv: 'IV', order: 0, createdAt: 1, updatedAt: 1 };
const senderMeta: CryptoMetadata = { id: 'singleton', salt: 'S1', iterations: 600000, algorithm: 'AES-GCM-256', createdAt: 1 };

const fullPackage: BackupData = {
  workspaces: [ws], categories: [cat], bookmarks: [bm], contexts: [encCtx], pinnedTabs: [], cryptoMetadata: senderMeta,
};

beforeEach(async () => {
  resetDB();
  const db = await getDB();
  // resetDB 仅断开连接不删数据(见 FaviconService.test 注释);分享导入跨用例复用同库,
  // 需显式清空各表以隔离用例,否则 contexts 等会跨用例累积导致计数失真。
  const stores = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata', 'favicons', 'pinnedTabs'] as const;
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
  vi.clearAllMocks();
});
afterAll(() => { vi.restoreAllMocks(); resetDB(); });

describe('applyShareImport — 分享包合并导入编排', () => {
  it('整选工作区 → 合并落盘,ID 全重映射无残留发送方 ID', async () => {
    const result = await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(result.workspaces).toBe(1);
    // 接收方库有 1 workspace,但其 id ≠ 'ws-s'(重映射)
    const gotWs = await getAll<Workspace>('workspaces');
    expect(gotWs).toHaveLength(1);
    expect(gotWs[0]!.id).not.toBe('ws-s');
    // category/bookmark 的 FK 也重映射,无残留发送方 ID
    const gotCat = await getAll<Category>('categories');
    expect(gotCat[0]!.workspaceId).toBe(gotWs[0]!.id);
    const gotBm = await getAll<Bookmark>('bookmarks');
    expect(gotBm[0]!.categoryId).toBe(gotCat[0]!.id);
    expect(gotBm[0]!.workspaceId).toBe(gotWs[0]!.id);
  });

  it('salt 相同 → 加密 context 入库 + 写入发送方 cryptoMetadata', async () => {
    // 接收方预置相同 salt 的 meta
    await putRecord('cryptoMetadata', { ...senderMeta });
    await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    const gotCtx = await getAll<Context>('contexts');
    expect(gotCtx).toHaveLength(1);
    expect(gotCtx[0]!.isEncrypted).toBe(true); // 加密 context 保留
    expect(gotCtx[0]!.encryptedData).toBe('CIPHER');
  });

  it('salt 不同 → 加密 context 不入库(仅明文) + 不覆盖接收方 cryptoMetadata + skippedEncrypted 计数', async () => {
    // 接收方预置不同 salt
    await putRecord('cryptoMetadata', { ...senderMeta, salt: 'DIFFERENT' });
    const result = await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(result.skippedEncrypted).toBe(1);
    // 加密 context 未入库
    expect(await getAll('contexts')).toHaveLength(0);
    // 接收方 cryptoMetadata 保留(salt 仍 DIFFERENT)
    expect((await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton'))?.salt).toBe('DIFFERENT');
  });

  it('仅结构包(cryptoMetadata null)→ contexts 空,不写 cryptoMetadata', async () => {
    const structurePackage: BackupData = { ...fullPackage, contexts: [], cryptoMetadata: null };
    await applyShareImport(structurePackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(await getAll('contexts')).toHaveLength(0);
    expect(await getByKey('cryptoMetadata', 'singleton')).toBeUndefined();
  });

  it('不调 lock(合并不改接收方加密设置)', async () => {
    const lockSpy = vi.spyOn(CryptoService, 'lock').mockResolvedValue(undefined);
    await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(lockSpy).not.toHaveBeenCalled();
  });

  it('广播 5 表 + broadcastImport', async () => {
    const { broadcastChange, broadcastImport } = await import('@/shared/db/database');
    await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(broadcastChange).toHaveBeenCalledWith('workspaces', 'put');
    expect(broadcastChange).toHaveBeenCalledWith('pinnedTabs', 'put');
    expect(broadcastImport).toHaveBeenCalled();
  });
});
