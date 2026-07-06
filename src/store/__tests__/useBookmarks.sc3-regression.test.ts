import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { resetDB, getDB } from '@/shared/db/database';
import * as BookmarkService from '@/services/BookmarkService';
import { useBookmarks } from '../useBookmarks';

/**
 * SC3 性能回归 guard：loadBookmarks 不自愈写 favicon
 *
 * 背景：loadBookmarks 曾对每条书签串行 await updateBookmark 回填 faviconUrl（N 条 → N 次
 * IndexedDB put + N 次 broadcast），打开含 100 条书签的 home 会卡顿。favicon 本地缓存
 * 系统上线后已删除该自愈循环（favicon 改由 FaviconService.useFavicon 懒加载）。
 *
 * 本测试锁定该性能契约：loadBookmarks 加载任意数量书签时，updateBookmark / putRecord 调用
 * 次数必须为 0，防止未来重新引入自愈写库循环。
 */

async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const storeNames = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata', 'favicons'] as const;
  const tx = db.transaction([...storeNames], 'readwrite');
  for (const name of storeNames) {
    await tx.objectStore(name).clear();
  }
  await tx.done;
}

beforeEach(async () => {
  resetDB();
  await getDB();
  await clearAllStores();
  // 重置 store 状态
  useBookmarks.setState({ bookmarks: [], allBookmarks: [], loading: false });
});

afterAll(() => {
  resetDB();
});

describe('SC3 性能回归 guard：loadBookmarks 不自愈写 favicon', () => {
  it('加载 10 条同 categoryId 书签时，updateBookmark 调用次数 === 0', async () => {
    const categoryId = 'cat-sc3';
    const workspaceId = 'ws-sc3';
    const COUNT = 10;

    // 插入阶段：用真实 BookmarkService.createBookmark 写入 fake-indexeddb
    for (let i = 0; i < COUNT; i++) {
      await BookmarkService.createBookmark(workspaceId, categoryId, {
        name: `书签 ${i}`,
        url: `https://example-${i}.com`,
      });
    }

    // spy 在 loadBookmarks 之前装上
    const updateSpy = vi.spyOn(BookmarkService, 'updateBookmark');

    // 加载阶段：被测契约
    await useBookmarks.getState().loadBookmarks(categoryId);

    // 断言：加载阶段不能有任何 updateBookmark 调用
    expect(updateSpy).not.toHaveBeenCalled();
    expect(updateSpy.mock.calls.length).toBe(0);

    // 数据正确性附带校验：书签确实加载到 store
    expect(useBookmarks.getState().bookmarks).toHaveLength(COUNT);
    expect(useBookmarks.getState().loading).toBe(false);

    updateSpy.mockRestore();
  });
});
