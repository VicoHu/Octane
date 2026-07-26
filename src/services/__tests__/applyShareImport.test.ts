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
const bm: Bookmark = { id: 'bm-s', workspaceId: 'ws-s', categoryId: 'cat-s', name: 'A', url: 'https://a.com', description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: true, order: 0, createdAt: 1, updatedAt: 1, tags: [] };
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
    const gotMeta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
    expect(gotMeta?.salt).toBe('DIFFERENT');
  });

  it('仅结构包(cryptoMetadata null)→ contexts 空,不写 cryptoMetadata', async () => {
    const structurePackage: BackupData = { ...fullPackage, contexts: [], cryptoMetadata: null };
    await applyShareImport(structurePackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    expect(await getAll('contexts')).toHaveLength(0);
    expect(await getByKey("cryptoMetadata", "singleton")).toBeUndefined();
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

describe('applyShareImport — T2 多工作区 order 重映射(Success Criteria 6)', () => {
  it('接收方 2 ws(order 0,1)+ 分享 2 ws(各 2 cat,各 cat 2 bm)→ 新 ws order=2,3;每 ws 内 cat 从 0 起;每 cat 内 bm 从 0 起', async () => {
    // 接收方预置 2 ws(order 0,1)——分享内容应追加在其后
    await putRecord('workspaces', { id: 'recv-ws1', name: '接收1', icon: '📁', createdAt: 1, order: 0 });
    await putRecord('workspaces', { id: 'recv-ws2', name: '接收2', icon: '📁', createdAt: 2, order: 1 });

    // 分享包:2 ws(各 2 cat,各 cat 2 bm),发送方 order 故意跨容器重叠 + 乱序
    const sharePkg: BackupData = {
      workspaces: [
        { id: 'ws-s1', name: '分享1', icon: '📁', createdAt: 10, order: 5 },
        { id: 'ws-s2', name: '分享2', icon: '📁', createdAt: 20, order: 3 },
      ],
      categories: [
        { id: 'c-s1a', workspaceId: 'ws-s1', name: 'Cat1A', icon: '📂', order: 7, createdAt: 1 },
        { id: 'c-s1b', workspaceId: 'ws-s1', name: 'Cat1B', icon: '📂', order: 2, createdAt: 2 },
        { id: 'c-s2a', workspaceId: 'ws-s2', name: 'Cat2A', icon: '📂', order: 9, createdAt: 3 },
        { id: 'c-s2b', workspaceId: 'ws-s2', name: 'Cat2B', icon: '📂', order: 1, createdAt: 4 },
      ],
      bookmarks: [
        { id: 'b-s1a-x', workspaceId: 'ws-s1', categoryId: 'c-s1a', name: 'X', url: 'https://x.com', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 8, createdAt: 1, updatedAt: 1, tags: [] },
        { id: 'b-s1a-y', workspaceId: 'ws-s1', categoryId: 'c-s1a', name: 'Y', url: 'https://y.com', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 4, createdAt: 2, updatedAt: 2, tags: [] },
        { id: 'b-s1b-x', workspaceId: 'ws-s1', categoryId: 'c-s1b', name: 'X', url: 'https://x.com', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 0, createdAt: 3, updatedAt: 3, tags: [] },
        { id: 'b-s2a-x', workspaceId: 'ws-s2', categoryId: 'c-s2a', name: 'X', url: 'https://x.com', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 6, createdAt: 4, updatedAt: 4, tags: [] },
        { id: 'b-s2a-y', workspaceId: 'ws-s2', categoryId: 'c-s2a', name: 'Y', url: 'https://y.com', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 1, createdAt: 5, updatedAt: 5, tags: [] },
        { id: 'b-s2b-x', workspaceId: 'ws-s2', categoryId: 'c-s2b', name: 'X', url: 'https://x.com', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 3, createdAt: 6, updatedAt: 6, tags: [] },
      ],
      contexts: [],
      pinnedTabs: [],
      cryptoMetadata: null,
    };

    const result = await applyShareImport(sharePkg, { workspaceIds: ['ws-s1', 'ws-s2'], categoryIds: [] });
    expect(result.workspaces).toBe(2);

    // 断言 1:接收方现有 ws 保留 order 0,1;新 ws 追加 order=2,3
    const allWs = await getAll<Workspace>('workspaces');
    expect(allWs).toHaveLength(4);
    const newWs1 = allWs.find((w) => w.name === '分享1')!;
    const newWs2 = allWs.find((w) => w.name === '分享2')!;
    expect(allWs.find((w) => w.name === '接收1')!.order).toBe(0);
    expect(allWs.find((w) => w.name === '接收2')!.order).toBe(1);
    // 新 ws 按发送方 order 升序:ws-s2(order=3) < ws-s1(order=5) → 分享2=2, 分享1=3
    expect(newWs2.order).toBe(2);
    expect(newWs1.order).toBe(3);

    // 断言 2:每个新 ws 内 category 各自从 0 起(非全局连续 0,1,2,3)
    const allCat = await getAll<Category>('categories');
    expect(allCat).toHaveLength(4);
    const catsInWs1 = allCat.filter((c) => c.workspaceId === newWs1.id).sort((a, b) => a.order - b.order);
    const catsInWs2 = allCat.filter((c) => c.workspaceId === newWs2.id).sort((a, b) => a.order - b.order);
    // 分享1:c-s1b(order=2) < c-s1a(order=7) → Cat1B=0, Cat1A=1
    expect(catsInWs1.map((c) => c.name)).toEqual(['Cat1B', 'Cat1A']);
    expect(catsInWs1.map((c) => c.order)).toEqual([0, 1]);
    // 分享2:c-s2b(order=1) < c-s2a(order=9) → Cat2B=0, Cat2A=1(非 2,3)
    expect(catsInWs2.map((c) => c.name)).toEqual(['Cat2B', 'Cat2A']);
    expect(catsInWs2.map((c) => c.order)).toEqual([0, 1]);

    // 断言 3:每个 category 内 bookmark 各自从 0 起(非全局连续)
    const allBm = await getAll<Bookmark>('bookmarks');
    expect(allBm).toHaveLength(6);
    const cat1a = allCat.find((c) => c.name === 'Cat1A')!;
    const cat2a = allCat.find((c) => c.name === 'Cat2A')!;
    const bmsInCat1a = allBm.filter((b) => b.categoryId === cat1a.id).sort((a, b) => a.order - b.order);
    const bmsInCat2a = allBm.filter((b) => b.categoryId === cat2a.id).sort((a, b) => a.order - b.order);
    // Cat1A:b-s1a-y(order=4) < b-s1a-x(order=8) → 0, 1
    expect(bmsInCat1a.map((b) => b.order)).toEqual([0, 1]);
    // Cat2A:b-s2a-y(order=1) < b-s2a-x(order=6) → 0, 1(非全局连续)
    expect(bmsInCat2a.map((b) => b.order)).toEqual([0, 1]);
  });
});

// ── Issue #55: 接收方合并后持久化 Bookmark 包含正确 Tag ──

describe('applyShareImport — Tag 原样保留并持久化（#55）', () => {
  it('接收方合并后 bookmark tags 原样保留（含 ID 重映射、顺序重排、冗余重算）', async () => {
    // 发送方包：bookmark 带 tags
    const tagPackage: BackupData = {
      ...fullPackage,
      bookmarks: [{ ...bm, tags: ['前端', 'React', '重要'] }],
    };
    await applyShareImport(tagPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    const gotBm = await getAll<Bookmark>('bookmarks');
    expect(gotBm).toHaveLength(1);
    expect(gotBm[0]!.tags).toEqual(['前端', 'React', '重要']);
  });

  it('空 tags 的 bookmark 合并后仍为空数组', async () => {
    await applyShareImport(fullPackage, { workspaceIds: ['ws-s'], categoryIds: [] });
    const gotBm = await getAll<Bookmark>('bookmarks');
    expect(gotBm).toHaveLength(1);
    expect(gotBm[0]!.tags).toEqual([]);
  });
});
