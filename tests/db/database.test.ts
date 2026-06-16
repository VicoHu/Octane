import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  getDB,
  resetDB,
  putRecord,
  getByKey,
  getAll,
  getByIndex,
  deleteRecord,
  cascadeDeleteWorkspace,
  cascadeDeleteCategory,
  deleteBookmarkCascade,
} from '@/shared/db/database';
import type { Workspace, Category, Bookmark, Context } from '@/shared/types';
import { ContextType, DB_NAME } from '@/shared/types';

/** 清空所有 object store */
async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const storeNames = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...storeNames], 'readwrite');
  for (const name of storeNames) {
    await tx.objectStore(name).clear();
  }
  await tx.done;
}

beforeEach(async () => {
  resetDB();
  // 确保数据库已创建
  await getDB();
  await clearAllStores();
});

afterAll(() => {
  resetDB();
});

function makeWorkspace(id: string, name: string): Workspace {
  return { id, name, icon: '📁', createdAt: Date.now(), order: 0 };
}

function makeCategory(id: string, workspaceId: string, name: string): Category {
  return { id, workspaceId, name, icon: '📂', order: 0, createdAt: Date.now() };
}

function makeBookmark(id: string, workspaceId: string, categoryId: string): Bookmark {
  return {
    id, workspaceId, categoryId,
    name: '测试书签', url: 'https://example.com',
    description: '', faviconUrl: '',
    contextCount: 0, hasEncryptedContext: false,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function makeContext(id: string, bookmarkId: string, title: string): Context {
  return {
    id, bookmarkId,
    type: ContextType.NOTE,
    title,
    content: '',
    isEncrypted: false,
    order: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('IndexedDB CRUD', () => {
  it('写入并读取工作区', async () => {
    const ws = makeWorkspace('ws-1', '工作');
    await putRecord('workspaces', ws);
    const result = await getByKey<Workspace>('workspaces', 'ws-1');
    expect(result).toBeDefined();
    expect(result!.name).toBe('工作');
  });

  it('获取所有记录', async () => {
    await putRecord('workspaces', makeWorkspace('ws-1', '工作'));
    await putRecord('workspaces', makeWorkspace('ws-2', '个人'));
    const all = await getAll<Workspace>('workspaces');
    expect(all).toHaveLength(2);
  });

  it('按索引查询分类', async () => {
    await putRecord('categories', makeCategory('cat-1', 'ws-1', '工具'));
    await putRecord('categories', makeCategory('cat-2', 'ws-1', '学习'));
    await putRecord('categories', makeCategory('cat-3', 'ws-2', '其他'));
    const results = await getByIndex<Category>('categories', 'by-workspaceId', 'ws-1');
    expect(results).toHaveLength(2);
  });

  it('删除记录', async () => {
    await putRecord('workspaces', makeWorkspace('ws-1', '工作'));
    await deleteRecord('workspaces', 'ws-1');
    const result = await getByKey<Workspace>('workspaces', 'ws-1');
    expect(result).toBeUndefined();
  });

  it('更新记录（put 覆盖）', async () => {
    await putRecord('workspaces', makeWorkspace('ws-1', '工作'));
    const updated = makeWorkspace('ws-1', '工作（已更新）');
    await putRecord('workspaces', updated);
    const result = await getByKey<Workspace>('workspaces', 'ws-1');
    expect(result!.name).toBe('工作（已更新）');
  });
});

describe('级联删除', () => {
  it('删除工作区 → 级联删除所有分类+书签+上下文', async () => {
    await putRecord('workspaces', makeWorkspace('ws-1', '工作'));
    await putRecord('categories', makeCategory('cat-1', 'ws-1', '工具'));
    await putRecord('categories', makeCategory('cat-2', 'ws-1', '学习'));
    await putRecord('bookmarks', makeBookmark('bm-1', 'ws-1', 'cat-1'));
    await putRecord('bookmarks', makeBookmark('bm-2', 'ws-1', 'cat-1'));
    await putRecord('bookmarks', makeBookmark('bm-3', 'ws-1', 'cat-2'));
    await putRecord('contexts', makeContext('ctx-1', 'bm-1', '笔记1'));
    await putRecord('contexts', makeContext('ctx-2', 'bm-2', '笔记2'));
    await putRecord('contexts', makeContext('ctx-3', 'bm-3', '笔记3'));

    await cascadeDeleteWorkspace('ws-1');

    expect(await getByKey('workspaces', 'ws-1')).toBeUndefined();
    expect(await getAll('categories')).toHaveLength(0);
    expect(await getAll('bookmarks')).toHaveLength(0);
    expect(await getAll('contexts')).toHaveLength(0);
  });

  it('删除分类 → 级联删除该书签+上下文，不影响其他分类', async () => {
    await putRecord('workspaces', makeWorkspace('ws-1', '工作'));
    await putRecord('categories', makeCategory('cat-1', 'ws-1', '工具'));
    await putRecord('categories', makeCategory('cat-2', 'ws-1', '学习'));
    await putRecord('bookmarks', makeBookmark('bm-1', 'ws-1', 'cat-1'));
    await putRecord('bookmarks', makeBookmark('bm-2', 'ws-1', 'cat-2'));
    await putRecord('contexts', makeContext('ctx-1', 'bm-1', '笔记1'));
    await putRecord('contexts', makeContext('ctx-2', 'bm-2', '笔记2'));

    await cascadeDeleteCategory('cat-1');

    expect(await getByKey('categories', 'cat-1')).toBeUndefined();
    expect(await getByKey('bookmarks', 'bm-1')).toBeUndefined();
    expect(await getByKey('contexts', 'ctx-1')).toBeUndefined();
    expect(await getByKey('categories', 'cat-2')).toBeDefined();
    expect(await getByKey('bookmarks', 'bm-2')).toBeDefined();
    expect(await getByKey('contexts', 'ctx-2')).toBeDefined();
  });

  it('删除书签 → 级联删除关联上下文（1:N）', async () => {
    await putRecord('bookmarks', makeBookmark('bm-1', 'ws-1', 'cat-1'));
    await putRecord('contexts', makeContext('ctx-1', 'bm-1', '笔记A'));
    await putRecord('contexts', makeContext('ctx-2', 'bm-1', '笔记B'));

    await deleteBookmarkCascade('bm-1');

    expect(await getByKey('bookmarks', 'bm-1')).toBeUndefined();
    expect(await getByKey('contexts', 'ctx-1')).toBeUndefined();
    expect(await getByKey('contexts', 'ctx-2')).toBeUndefined();
  });
});

/** 等待原生 BroadcastChannel 异步派发的 onmessage（postMessage 非同步触发） */
const flushMessages = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe('数据变更广播', () => {
  let received: { store: string; action: string }[] = [];
  let channel: BroadcastChannel;

  beforeEach(() => {
    received = [];
    channel = new BroadcastChannel(DB_NAME);
    channel.onmessage = (e: MessageEvent) => {
      received.push(e.data as { store: string; action: string });
    };
  });

  afterEach(() => channel.close());

  it('putRecord → 广播 { store, action: "put" }', async () => {
    await putRecord('bookmarks', makeBookmark('bm-1', 'ws-1', 'cat-1'));
    await flushMessages();
    expect(received).toContainEqual({ store: 'bookmarks', action: 'put' });
  });

  it('deleteRecord → 广播 { store, action: "delete" }', async () => {
    await putRecord('bookmarks', makeBookmark('bm-1', 'ws-1', 'cat-1'));
    await flushMessages();
    received = [];
    await deleteRecord('bookmarks', 'bm-1');
    await flushMessages();
    expect(received).toContainEqual({ store: 'bookmarks', action: 'delete' });
  });

  it('不同 store 各自广播对应 store 名', async () => {
    await putRecord('workspaces', makeWorkspace('ws-1', '工作'));
    await flushMessages();
    expect(received).toContainEqual({ store: 'workspaces', action: 'put' });
  });
});
