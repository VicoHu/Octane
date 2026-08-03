import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getDB,
  resetDB,
  putRecord,
  getAll,
  getByKey,
  exportAllData,
  replaceAllDataRaw,
  IMPORT_CHANNEL_NAME,
  broadcastImport,
} from '@/shared/db/database';
import type { BackupData, Bookmark, Context, Workspace, Category, CryptoMetadata } from '@/shared/types';
import { ContextType } from '@/shared/types';

async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const names = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) await tx.objectStore(n).clear();
  await tx.done;
}

beforeEach(async () => {
  resetDB();
  await getDB();
  await clearAllStores();
});
afterAll(() => resetDB());

const ws: Workspace = { id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 };
const cat: Category = { id: 'cat-1', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 };
const bm: Bookmark = {
  id: 'bm-1', workspaceId: 'ws-1', categoryId: 'cat-1', name: 'n', url: 'https://x.com',
  description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1, tags: [],
};
// 加密 context：存储态 content='' + 密文（不解密）
const encCtx: Context = {
  id: 'ctx-1', bookmarkId: 'bm-1', type: ContextType.NOTE, title: 't', content: '',
  isEncrypted: true, encryptedData: 'BASE64_CIPHER', iv: 'BASE64_IV', order: 0, createdAt: 1, updatedAt: 1,
};
const meta: CryptoMetadata = { id: 'singleton', salt: 'S', iterations: 600000, algorithm: 'AES-GCM-256', createdAt: 1 };

async function seed(): Promise<void> {
  await putRecord('workspaces', ws);
  await putRecord('categories', cat);
  await putRecord('bookmarks', bm);
  await putRecord('contexts', encCtx);
  await putRecord('cryptoMetadata', meta);
}

describe('exportAllData', () => {
  it('导出 5 表，contexts 为存储态密文（content 为空，非解密明文）', async () => {
    await seed();
    const data = await exportAllData();
    expect(data.workspaces).toHaveLength(1);
    expect(data.contexts).toHaveLength(1);
    expect(data.contexts[0]!.content).toBe('');           // 存储态，未解密
    expect(data.contexts[0]!.encryptedData).toBe('BASE64_CIPHER');
    expect(data.cryptoMetadata?.salt).toBe('S');
  });

  it('无 cryptoMetadata 时导出 null', async () => {
    await putRecord('workspaces', ws);
    const data = await exportAllData();
    expect(data.cryptoMetadata).toBeNull();
  });
});

describe('replaceAllDataRaw', () => {
  it('覆盖：先有旧数据，replace 后只剩新数据', async () => {
    await putRecord('workspaces', { ...ws, id: 'old', name: '旧' });
    const data: BackupData = {
      workspaces: [ws], categories: [cat], bookmarks: [bm], contexts: [encCtx], cryptoMetadata: meta,
      taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [],
    };
    await replaceAllDataRaw(data);
    // eslint-disable-next-line testing-library/no-await-sync-queries
    expect(await getByKey('workspaces', 'old')).toBeUndefined();   // 旧数据被清
    expect(await getAll('workspaces')).toHaveLength(1);
    expect((await getAll<Context>('contexts'))[0]!.encryptedData).toBe('BASE64_CIPHER');
  });

  it('cryptoMetadata 缺失时保留本机原值（C1 边界）', async () => {
    await putRecord('cryptoMetadata', meta);
    const data: BackupData = {
      workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null,
      taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [],
    };
    await replaceAllDataRaw(data);
    // eslint-disable-next-line testing-library/no-await-sync-queries
    const kept = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
    expect(kept?.salt).toBe('S');   // 本机原值未被清空
  });

  it('cryptoMetadata 存在时覆盖', async () => {
    await putRecord('cryptoMetadata', { ...meta, salt: 'OLD' });
    const data: BackupData = {
      workspaces: [], categories: [], bookmarks: [], contexts: [],
      cryptoMetadata: { ...meta, salt: 'NEW' },
      taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [],
    };
    await replaceAllDataRaw(data);
    // eslint-disable-next-line testing-library/no-await-sync-queries
    expect((await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton'))?.salt).toBe('NEW');
  });
});

describe('broadcastImport', () => {
  it('在 octane-import channel 发 { type: "imported" }', async () => {
    const ch = new BroadcastChannel(IMPORT_CHANNEL_NAME);
    let received: unknown = null;
    ch.onmessage = (e: MessageEvent) => { received = e.data; };
    broadcastImport();
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual({ type: 'imported' });
    ch.close();
  });
});
