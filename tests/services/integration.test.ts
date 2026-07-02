import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetDB, getDB } from '@/shared/db/database';
import { setTestKey, setupTestKey } from '@/services/CryptoService';
import { createWorkspace, listWorkspaces, updateWorkspace, deleteWorkspace } from '@/services/WorkspaceService';
import { createCategory, listCategories, updateCategory, deleteCategory } from '@/services/CategoryService';
import { createBookmark, listBookmarks, listBookmarksByWorkspace, updateBookmark, deleteBookmark, getFaviconUrl } from '@/services/BookmarkService';
import { getContexts, getContext, createContext, updateContext, deleteContext } from '@/services/ContextService';
import { ContextType } from '@/shared/types';

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
  setTestKey(null);
  await getDB();
  await clearAllStores();
});

afterAll(() => {
  resetDB();
  setTestKey(null);
});

describe('完整 CRUD 流程', () => {
  it('工作区 CRUD', async () => {
    const ws = await createWorkspace('工作', '📁');
    expect(ws.name).toBe('工作');
    expect(ws.icon).toBe('📁');

    const all = await listWorkspaces();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(ws.id);

    await updateWorkspace(ws.id, { name: '工作（已更新）' });
    const updated = await listWorkspaces();
    expect(updated[0]!.name).toBe('工作（已更新）');

    await deleteWorkspace(ws.id);
    const empty = await listWorkspaces();
    expect(empty).toHaveLength(0);
  });

  it('分类 CRUD', async () => {
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '工具', '🔧');

    const cats = await listCategories(ws.id);
    expect(cats).toHaveLength(1);
    expect(cats[0]!.name).toBe('工具');

    await updateCategory(cat.id, { name: '开发工具' });
    const updated = await listCategories(ws.id);
    expect(updated[0]!.name).toBe('开发工具');

    await deleteCategory(cat.id);
    const empty = await listCategories(ws.id);
    expect(empty).toHaveLength(0);
  });

  it('书签 CRUD', async () => {
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '工具', '🔧');
    const bm = await createBookmark(ws.id, cat.id, {
      name: 'GitHub',
      url: 'https://github.com',
      description: '代码托管',
    });

    const bms = await listBookmarks(cat.id);
    expect(bms).toHaveLength(1);
    expect(bms[0]!.name).toBe('GitHub');
    expect(bms[0]!.url).toBe('https://github.com');

    await updateBookmark(bm.id, { name: 'GitHub (Main)' });
    const updated = await listBookmarks(cat.id);
    expect(updated[0]!.name).toBe('GitHub (Main)');

    await deleteBookmark(bm.id);
    const empty = await listBookmarks(cat.id);
    expect(empty).toHaveLength(0);
  });
});

describe('端到端流程：工作区 → 分类 → 书签 → 上下文', () => {
  it('完整数据创建和查询', async () => {
    // 创建工作区
    const ws = await createWorkspace('个人', '🏠');
    // 创建两个分类
    const cat1 = await createCategory(ws.id, '技术', '💻');
    const cat2 = await createCategory(ws.id, '生活', '☕');
    // 创建书签
    const bm1 = await createBookmark(ws.id, cat1.id, { name: 'MDN', url: 'https://developer.mozilla.org' });
    const bm2 = await createBookmark(ws.id, cat1.id, { name: 'Stack Overflow', url: 'https://stackoverflow.com' });
    const bm3 = await createBookmark(ws.id, cat2.id, { name: 'YouTube', url: 'https://youtube.com' });

    // 按分类查询
    const techBms = await listBookmarks(cat1.id);
    expect(techBms).toHaveLength(2);
    const lifeBms = await listBookmarks(cat2.id);
    expect(lifeBms).toHaveLength(1);

    // 按工作区查询
    const allBms = await listBookmarksByWorkspace(ws.id);
    expect(allBms).toHaveLength(3);

    // 创建上下文（1:N）
    await createContext(bm1.id, ContextType.NOTE, '项目笔记', 'Web 开发参考文档', false);
    const contexts = await getContexts(bm1.id);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.content).toBe('Web 开发参考文档');
    expect(contexts[0]!.title).toBe('项目笔记');
    expect(contexts[0]!.isEncrypted).toBe(false);

    // 无上下文的书签
    const noContexts = await getContexts(bm2.id);
    expect(noContexts).toHaveLength(0);
  });

  it('一个书签可以创建多个上下文', async () => {
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '工具', '🔧');
    const bm = await createBookmark(ws.id, cat.id, { name: 'Test', url: 'https://test.com' });

    const ctx1 = await createContext(bm.id, ContextType.NOTE, '笔记1', '内容1', false);
    const ctx2 = await createContext(bm.id, ContextType.NOTE, '笔记2', '内容2', false);

    const contexts = await getContexts(bm.id);
    expect(contexts).toHaveLength(2);
    // 按 createdAt 升序，两个都在列表中即可
    const ids = contexts.map((c) => c.id);
    expect(ids).toContain(ctx1.id);
    expect(ids).toContain(ctx2.id);

    // 冗余字段同步
    const updatedBm = await listBookmarks(cat.id);
    expect(updatedBm[0]!.contextCount).toBe(2);
    expect(updatedBm[0]!.hasEncryptedContext).toBe(false);
  });

  it('级联删除工作区 → 全部清除', async () => {
    const ws = await createWorkspace('测试', '🧪');
    const cat = await createCategory(ws.id, '分类A', '📂');
    const bm = await createBookmark(ws.id, cat.id, { name: 'Test', url: 'https://test.com' });
    await createContext(bm.id, ContextType.NOTE, '笔记', '测试笔记', false);

    await deleteWorkspace(ws.id);

    // 所有数据应被清除
    expect(await listWorkspaces()).toHaveLength(0);
    expect(await listCategories(ws.id)).toHaveLength(0);
    expect(await listBookmarks(cat.id)).toHaveLength(0);
    expect(await getContexts(bm.id)).toHaveLength(0);
  });

  it('级联删除分类 → 书签+上下文清除，其他分类不受影响', async () => {
    const ws = await createWorkspace('工作', '📁');
    const cat1 = await createCategory(ws.id, '保留', '✅');
    const cat2 = await createCategory(ws.id, '删除', '🗑️');
    const bm1 = await createBookmark(ws.id, cat1.id, { name: '保留书签', url: 'https://keep.com' });
    const bm2 = await createBookmark(ws.id, cat2.id, { name: '删除书签', url: 'https://delete.com' });
    await createContext(bm1.id, ContextType.NOTE, '保留笔记', '保留笔记', false);
    await createContext(bm2.id, ContextType.NOTE, '删除笔记', '删除笔记', false);

    await deleteCategory(cat2.id);

    // cat2 的数据被清除
    expect(await listBookmarks(cat2.id)).toHaveLength(0);
    expect(await getContexts(bm2.id)).toHaveLength(0);

    // cat1 的数据保留
    expect(await listBookmarks(cat1.id)).toHaveLength(1);
    const contexts = await getContexts(bm1.id);
    expect(contexts[0]!.content).toBe('保留笔记');
  });
});

describe('加密上下文流程', () => {
  it('创建加密上下文 → 读取时自动解密', async () => {
    await setupTestKey('master-password');
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '敏感', '🔒');
    const bm = await createBookmark(ws.id, cat.id, { name: 'Secret', url: 'https://secret.com' });

    await createContext(bm.id, ContextType.NOTE, '秘密', '这是一条敏感信息 🔐', true);

    const contexts = await getContexts(bm.id);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.content).toBe('这是一条敏感信息 🔐');
    expect(contexts[0]!.isEncrypted).toBe(true);
  });

  it('加密上下文往返：不同密钥无法解密', async () => {
    await setupTestKey('password-A');
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '加密', '🔒');
    const bm = await createBookmark(ws.id, cat.id, { name: 'Encrypted', url: 'https://enc.com' });

    await createContext(bm.id, ContextType.NOTE, '加密笔记', '秘密内容', true);

    // 换一个密钥：错密钥无法解密，getContexts 容错返回占位（明文不泄露）
    await setupTestKey('password-B');
    const ctxs = await getContexts(bm.id);
    expect(ctxs).toHaveLength(1);
    expect(ctxs[0]!.isEncrypted).toBe(true);
    expect(ctxs[0]!.content).toBe(''); // 错密钥：占位，不解密不泄露
  });

  it('同一上下文：明文 → 加密 → 更新内容', async () => {
    await setupTestKey('password');
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '测试', '🧪');
    const bm = await createBookmark(ws.id, cat.id, { name: 'Test', url: 'https://test.com' });

    // 创建明文上下文
    const ctx = await createContext(bm.id, ContextType.NOTE, '测试', '明文内容', false);
    let loaded = await getContext(ctx.id);
    expect(loaded!.isEncrypted).toBe(false);

    // 切换为加密
    await updateContext(ctx.id, { content: '现在是加密的', sensitive: true });
    loaded = await getContext(ctx.id);
    expect(loaded!.content).toBe('现在是加密的');
    expect(loaded!.isEncrypted).toBe(true);

    // 切换回明文
    await updateContext(ctx.id, { content: '又变回明文', sensitive: false });
    loaded = await getContext(ctx.id);
    expect(loaded!.content).toBe('又变回明文');
    expect(loaded!.isEncrypted).toBe(false);
  });

  it('删除上下文 → 冗余字段同步', async () => {
    await setupTestKey('password');
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '测试', '🧪');
    const bm = await createBookmark(ws.id, cat.id, { name: 'Test', url: 'https://test.com' });

    const ctx1 = await createContext(bm.id, ContextType.NOTE, '笔记1', '内容1', false);
    const ctx2 = await createContext(bm.id, ContextType.NOTE, '笔记2', '内容2', true);

    let bms = await listBookmarks(cat.id);
    expect(bms[0]!.contextCount).toBe(2);
    expect(bms[0]!.hasEncryptedContext).toBe(true);

    // 删除加密的
    await deleteContext(ctx2.id);
    bms = await listBookmarks(cat.id);
    expect(bms[0]!.contextCount).toBe(1);
    expect(bms[0]!.hasEncryptedContext).toBe(false);

    // 删除最后一个
    await deleteContext(ctx1.id);
    bms = await listBookmarks(cat.id);
    expect(bms[0]!.contextCount).toBe(0);
    expect(bms[0]!.hasEncryptedContext).toBe(false);
  });
});

describe('ContextService CRUD', () => {
  it('getContext 返回 null 对不存在的 id', async () => {
    const result = await getContext('non-existent');
    expect(result).toBeNull();
  });

  it('updateContext 抛出错误对不存在的 id', async () => {
    await expect(updateContext('non-existent', { title: 'test' })).rejects.toThrow('上下文不存在');
  });

  it('deleteContext 对不存在的 id 不抛错', async () => {
    await expect(deleteContext('non-existent')).resolves.toBeUndefined();
  });
});

describe('Favicon URL 生成', () => {
  it('正常 URL 生成 Google Favicon 链接', () => {
    const url = getFaviconUrl('https://github.com/user/repo');
    expect(url).toBe('https://www.google.com/s2/favicons?domain=github.com&sz=32');
  });

  it('无效 URL 返回空字符串', () => {
    expect(getFaviconUrl('not-a-url')).toBe('');
    expect(getFaviconUrl('')).toBe('');
  });
});
