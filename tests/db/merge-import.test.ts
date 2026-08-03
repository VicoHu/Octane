import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getDB, resetDB, putRecord, getAll, getByKey, mergeImportRaw } from '@/shared/db/database';
import type { BackupData, Bookmark, Category, CryptoMetadata, PinnedTab, Workspace } from '@/shared/types';
import { ContextType } from '@/shared/types';

/**
 * mergeImportRaw 数据层单测(0.1.11.3 第3步)。
 *
 * 分享包合并导入的原子 put 层:单 readwrite 事务,纯 put 不 clear(保留接收方现有数据)。
 * 与 replaceAllDataRaw(覆盖)的关键区别:不清空 store / 不重算 / 不 lock / 不广播。
 * ID 重映射 + 同名后缀 + 冲突过滤由调用方(服务层)在事务前完成,本函数只做原子搬运。
 *
 * cryptoMeta 单独传入(非 remapped.cryptoMetadata):它是经 salt 冲突过滤后的「最终写入决策」
 * (全拷贝包 salt 相同时才写);remapped.cryptoMetadata 是发送方原值,仅用于决策,不直接落盘。
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
});
afterAll(() => resetDB());

// 已重映射的分享包数据(模拟服务层 ID 重映射后的输出;新 ID,不与接收方冲突)
const wsNew: Workspace = { id: 'ws-new', name: '分享工作区', icon: '🎁', createdAt: 10, order: 0 };
const catNew: Category = { id: 'cat-new', workspaceId: 'ws-new', name: '分享分类', icon: '🗂️', order: 0, createdAt: 10 };
const bmNew: Bookmark = {
  id: 'bm-new', workspaceId: 'ws-new', categoryId: 'cat-new', name: '分享书签', url: 'https://share.com',
  description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 0, createdAt: 10, updatedAt: 10, tags: [],
};
const pinNew: PinnedTab = { id: 'pin-new', workspaceId: 'ws-new', name: '分享常驻', url: 'https://pin.com', order: 0, createdAt: 10 };
const metaNew: CryptoMetadata = { id: 'singleton', salt: 'S-NEW', iterations: 600000, algorithm: 'AES-GCM-256', createdAt: 10 };

const remappedData: BackupData = {
  workspaces: [wsNew], categories: [catNew], bookmarks: [bmNew], contexts: [],
  pinnedTabs: [pinNew], cryptoMetadata: null,
};

describe('mergeImportRaw — 合并导入(分享包,不覆盖接收方现有数据)', () => {
  it('合并不 clear:接收方现有 workspace/pinnedTab 保留 + 新数据追加', async () => {
    await putRecord('workspaces', { ...wsNew, id: 'ws-existing', name: '我原有' });
    await putRecord('pinnedTabs', { ...pinNew, id: 'pin-existing' });

    await mergeImportRaw(remappedData);

    // 旧数据保留(未被 clear)
    expect(await getByKey('workspaces', 'ws-existing')).toBeDefined();
    expect(await getByKey('pinnedTabs', 'pin-existing')).toBeDefined();
    // 新数据追加
    expect(await getByKey('workspaces', 'ws-new')).toBeDefined();
    expect(await getByKey('pinnedTabs', 'pin-new')).toBeDefined();
    expect(await getAll('workspaces')).toHaveLength(2);
    expect(await getAll('categories')).toHaveLength(1);
    expect(await getAll('bookmarks')).toHaveLength(1);
  });

  it('事务只打开书签相关 store，不触碰待办 store', async () => {
    const db = await getDB();
    const transactionSpy = vi.spyOn(db, 'transaction');

    await mergeImportRaw(remappedData);

    expect(transactionSpy).toHaveBeenCalledWith(
      ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata', 'pinnedTabs'],
      'readwrite',
    );
    transactionSpy.mockRestore();
  });

  it('cryptoMeta 传入 → 写入 cryptoMetadata(全拷贝包,salt 相同场景)', async () => {
    await mergeImportRaw(remappedData, metaNew);
    expect((await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton'))?.salt).toBe('S-NEW');
  });

  it('cryptoMeta 不传(undefined)→ 不动接收方 cryptoMetadata(保留原值)', async () => {
    await putRecord('cryptoMetadata', { ...metaNew, salt: 'S-RECEIVER' });
    await mergeImportRaw(remappedData);
    expect((await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton'))?.salt).toBe('S-RECEIVER');
  });

  it('写入决策只看 cryptoMeta 参数,remapped.cryptoMetadata(null)不直接落盘', async () => {
    // remappedData.cryptoMetadata = null,但传 cryptoMeta → 仍写入(决策权在参数)
    await mergeImportRaw(remappedData, metaNew);
    expect((await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton'))?.salt).toBe('S-NEW');
  });

  it('pinnedTabs 缺失(undefined)→ 不动 pinnedTabs store(保留接收方常驻)', async () => {
    await putRecord('pinnedTabs', { ...pinNew, id: 'pin-keep' });
    const noPin: BackupData = { ...remappedData, pinnedTabs: undefined };
    await mergeImportRaw(noPin);
    expect(await getAll('pinnedTabs')).toHaveLength(1);
    expect((await getAll<PinnedTab>('pinnedTabs'))[0]!.id).toBe('pin-keep');
  });
});
