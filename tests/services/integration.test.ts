import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetDB, getDB } from '@/shared/db/database';
import { setTestKey, setupTestKey } from '@/services/CryptoService';
import { createWorkspace, listWorkspaces, updateWorkspace, deleteWorkspace } from '@/services/WorkspaceService';
import { createCategory, listCategories, updateCategory, deleteCategory } from '@/services/CategoryService';
import { createBookmark, listBookmarks, listBookmarksByWorkspace, updateBookmark, deleteBookmark, getFaviconUrl } from '@/services/BookmarkService';
import { getNote, saveNote } from '@/services/NoteService';

async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const storeNames = ['workspaces', 'categories', 'bookmarks', 'notes', 'cryptoMetadata'] as const;
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

describe('端到端流程：工作区 → 分类 → 书签 → 笔记', () => {
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

    // 保存笔记
    await saveNote(bm1.id, 'Web 开发参考文档', false);
    const note = await getNote(bm1.id);
    expect(note).not.toBeNull();
    expect(note!.content).toBe('Web 开发参考文档');
    expect(note!.isEncrypted).toBe(false);

    // 无笔记的书签
    const noNote = await getNote(bm2.id);
    expect(noNote).toBeNull();
  });

  it('级联删除工作区 → 全部清除', async () => {
    const ws = await createWorkspace('测试', '🧪');
    const cat = await createCategory(ws.id, '分类A', '📂');
    const bm = await createBookmark(ws.id, cat.id, { name: 'Test', url: 'https://test.com' });
    await saveNote(bm.id, '测试笔记', false);

    await deleteWorkspace(ws.id);

    // 所有数据应被清除
    expect(await listWorkspaces()).toHaveLength(0);
    expect(await listCategories(ws.id)).toHaveLength(0);
    expect(await listBookmarks(cat.id)).toHaveLength(0);
    expect(await getNote(bm.id)).toBeNull();
  });

  it('级联删除分类 → 书签+笔记清除，其他分类不受影响', async () => {
    const ws = await createWorkspace('工作', '📁');
    const cat1 = await createCategory(ws.id, '保留', '✅');
    const cat2 = await createCategory(ws.id, '删除', '🗑️');
    const bm1 = await createBookmark(ws.id, cat1.id, { name: '保留书签', url: 'https://keep.com' });
    const bm2 = await createBookmark(ws.id, cat2.id, { name: '删除书签', url: 'https://delete.com' });
    await saveNote(bm1.id, '保留笔记', false);
    await saveNote(bm2.id, '删除笔记', false);

    await deleteCategory(cat2.id);

    // cat2 的数据被清除
    expect(await listBookmarks(cat2.id)).toHaveLength(0);
    expect(await getNote(bm2.id)).toBeNull();

    // cat1 的数据保留
    expect(await listBookmarks(cat1.id)).toHaveLength(1);
    const note = await getNote(bm1.id);
    expect(note!.content).toBe('保留笔记');
  });
});

describe('加密笔记流程', () => {
  it('保存加密笔记 → 读取时自动解密', async () => {
    await setupTestKey('master-password');
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '敏感', '🔒');
    const bm = await createBookmark(ws.id, cat.id, { name: 'Secret', url: 'https://secret.com' });

    await saveNote(bm.id, '这是一条敏感信息 🔐', true);

    const note = await getNote(bm.id);
    expect(note).not.toBeNull();
    expect(note!.content).toBe('这是一条敏感信息 🔐');
    expect(note!.isEncrypted).toBe(true);
  });

  it('加密笔记往返：不同密钥无法解密', async () => {
    await setupTestKey('password-A');
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '加密', '🔒');
    const bm = await createBookmark(ws.id, cat.id, { name: 'Encrypted', url: 'https://enc.com' });

    await saveNote(bm.id, '秘密内容', true);

    // 换一个密钥
    await setupTestKey('password-B');
    await expect(getNote(bm.id)).rejects.toThrow();
  });

  it('同一书签：明文笔记 → 加密笔记 → 清空笔记', async () => {
    await setupTestKey('password');
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '测试', '🧪');
    const bm = await createBookmark(ws.id, cat.id, { name: 'Test', url: 'https://test.com' });

    // 明文笔记
    await saveNote(bm.id, '明文笔记', false);
    let note = await getNote(bm.id);
    expect(note!.isEncrypted).toBe(false);

    // 切换为加密
    await saveNote(bm.id, '现在是加密的', true);
    note = await getNote(bm.id);
    expect(note!.content).toBe('现在是加密的');
    expect(note!.isEncrypted).toBe(true);

    // 清空笔记 → 删除
    await saveNote(bm.id, '', false);
    note = await getNote(bm.id);
    expect(note).toBeNull();
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
