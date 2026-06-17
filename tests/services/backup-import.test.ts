import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { getDB, resetDB, putRecord, getByKey, getAll } from '@/shared/db/database';
import { applyImport } from '@/services/BackupService';
import { IMPORT_CHANNEL_NAME } from '@/shared/db/database';
import * as CryptoService from '@/services/CryptoService';
import type { BackupData, Bookmark, Context } from '@/shared/types';
import { ContextType } from '@/shared/types';

beforeEach(async () => {
  resetDB();
  await getDB();
  // 清空
  const db = await getDB();
  const names = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) await tx.objectStore(n).clear();
  await tx.done;
});
afterAll(() => resetDB());

// 构造：备份里 bookmark 的冗余字段被「篡改」为错误值，验证 applyImport 重算
const tamperedBm: Bookmark = {
  id: 'bm-1', workspaceId: 'ws-1', categoryId: 'cat-1', name: 'n', url: 'https://x.com',
  description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, // 故意写错：实际有 1 条 context
  createdAt: 1, updatedAt: 1,
};
const realCtx: Context = {
  id: 'ctx-1', bookmarkId: 'bm-1', type: ContextType.NOTE, title: 't', content: '明文',
  isEncrypted: false, order: 0, createdAt: 1, updatedAt: 1,
};
const payload: BackupData = {
  workspaces: [{ id: 'ws-1', name: 'w', icon: 'i', createdAt: 1, order: 0 }],
  categories: [{ id: 'cat-1', workspaceId: 'ws-1', name: 'c', icon: 'i', order: 0, createdAt: 1 }],
  bookmarks: [tamperedBm],
  contexts: [realCtx],
  cryptoMetadata: null,
};

describe('applyImport', () => {
  it('覆盖写入 5 表', async () => {
    await applyImport(payload);
    expect(await getAll('bookmarks')).toHaveLength(1);
    expect(await getAll('contexts')).toHaveLength(1);
  });

  it('重算冗余字段：篡改的 contextCount=0 → 重算为 1', async () => {
    await applyImport(payload);
    const bm = await getByKey<Bookmark>('bookmarks', 'bm-1');
    expect(bm?.contextCount).toBe(1);
    expect(bm?.hasEncryptedContext).toBe(false);
  });

  it('调用 lock() 清 session 旧密钥', async () => {
    const spy = vi.spyOn(CryptoService, 'lock').mockResolvedValue(undefined);
    await applyImport(payload);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('广播 octane-import 事件（newtab reload 用）', async () => {
    const ch = new BroadcastChannel(IMPORT_CHANNEL_NAME);
    let got = false;
    ch.onmessage = () => { got = true; };
    await applyImport(payload);
    await new Promise((r) => setTimeout(r, 10));
    expect(got).toBe(true);
    ch.close();
  });
});
