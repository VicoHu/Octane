import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Bookmark } from '@/shared/types';

// 打桩 service 层:仅验证 store 状态机,不触真实 IndexedDB
vi.mock('@/services/BookmarkService', () => ({
  listBookmarks: vi.fn(async () => [] as Bookmark[]),
  listBookmarksByWorkspace: vi.fn(async () => [] as Bookmark[]),
  createBookmark: vi.fn(async (_ws: string, _cat: string, data: { name: string; url: string }) =>
    makeBookmark('new-1', data.name, data.url),
  ),
  updateBookmark: vi.fn(async () => undefined),
  deleteBookmark: vi.fn(async () => undefined),
  getFaviconUrl: vi.fn(() => ''),
}));
vi.mock('@/shared/db/database', () => ({ getByKey: vi.fn(async () => null) }));

import { useBookmarks } from '../useBookmarks';
import * as BookmarkService from '@/services/BookmarkService';
import { getByKey } from '@/shared/db/database';

function makeBookmark(id: string, name: string, url: string, categoryId = 'cat-1'): Bookmark {
  return {
    id,
    workspaceId: 'ws-1',
    categoryId,
    name,
    url,
    description: '',
    faviconUrl: '',
    contextCount: 0,
    hasEncryptedContext: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('useBookmarks — R1 allBookmarks slice(跨分类去重数据源)', () => {
  beforeEach(() => {
    // 重置 store 状态与 mock 调用记录
    useBookmarks.setState({ bookmarks: [], allBookmarks: [], loading: false });
    vi.clearAllMocks();
  });

  it('loadAllByWorkspace 调用 listBookmarksByWorkspace 并填充 allBookmarks', async () => {
    const wsBookmarks = [makeBookmark('a', 'A', 'https://a.com', 'cat-1')];
    vi.mocked(BookmarkService.listBookmarksByWorkspace).mockResolvedValue(wsBookmarks);

    await useBookmarks.getState().loadAllByWorkspace('ws-1');

    expect(BookmarkService.listBookmarksByWorkspace).toHaveBeenCalledWith('ws-1');
    expect(useBookmarks.getState().allBookmarks).toEqual(wsBookmarks);
  });

  it('allBookmarks 与 bookmarks 相互独立:loadBookmarks(categoryId) 不污染 allBookmarks', async () => {
    const catBookmarks = [makeBookmark('a', 'A', 'https://a.com', 'cat-1')];
    vi.mocked(BookmarkService.listBookmarks).mockResolvedValue(catBookmarks);

    await useBookmarks.getState().loadBookmarks('cat-1');

    expect(useBookmarks.getState().bookmarks).toEqual(catBookmarks);
    // allBookmarks 不应被单分类加载触及(避免破坏跨分类去重数据源)
    expect(useBookmarks.getState().allBookmarks).toEqual([]);
  });

  it('createBookmark 同时追加到 bookmarks 与 allBookmarks(保存后去重即时生效)', async () => {
    // 预置 allBookmarks 已加载
    useBookmarks.setState({
      bookmarks: [],
      allBookmarks: [makeBookmark('a', 'A', 'https://a.com')],
    });

    const created = await useBookmarks
      .getState()
      .createBookmark('ws-1', 'cat-1', { name: 'New', url: 'https://new.com' });

    expect(created.url).toBe('https://new.com');
    // 两个 slice 都要包含新书签,否则保存后 TabList 去重数据陈旧
    expect(useBookmarks.getState().bookmarks.some((b) => b.id === created.id)).toBe(true);
    expect(useBookmarks.getState().allBookmarks.some((b) => b.id === created.id)).toBe(true);
  });
});

describe('useBookmarks — R2 移动/删除/编辑的双切片同步 (moveBookmark + 修 delete/refresh)', () => {
  beforeEach(() => {
    useBookmarks.setState({ bookmarks: [], allBookmarks: [], loading: false });
    vi.clearAllMocks();
  });

  it('T3 deleteBookmark 同时从 bookmarks 与 allBookmarks 移除 (修历史遗漏)', async () => {
    const bm = makeBookmark('a', 'A', 'https://a.com');
    useBookmarks.setState({ bookmarks: [bm], allBookmarks: [bm] });

    await useBookmarks.getState().deleteBookmark('a');

    expect(BookmarkService.deleteBookmark).toHaveBeenCalledWith('a');
    expect(useBookmarks.getState().bookmarks.some((b) => b.id === 'a')).toBe(false);
    // 关键:历史 bug 是只同步 bookmarks 漏 allBookmarks,导致 TabList 去重陈旧
    expect(useBookmarks.getState().allBookmarks.some((b) => b.id === 'a')).toBe(false);
  });

  it('T4 refreshBookmark(改名/改URL,归属不变) 同时更新 bookmarks 与 allBookmarks', async () => {
    const bm = makeBookmark('a', 'A', 'https://a.com');
    const updated: Bookmark = { ...bm, name: 'A2', url: 'https://a.com/v2' };
    useBookmarks.setState({ bookmarks: [bm], allBookmarks: [bm] });
    vi.mocked(getByKey).mockResolvedValue(updated);

    await useBookmarks.getState().refreshBookmark('a');

    expect(useBookmarks.getState().bookmarks[0]!.name).toBe('A2');
    // 关键:编辑路径也必须同步 allBookmarks,否则改名后 TabList 去重用到旧 url
    expect(useBookmarks.getState().allBookmarks[0]!.name).toBe('A2');
    expect(useBookmarks.getState().allBookmarks[0]!.url).toBe('https://a.com/v2');
  });

  it('T5 refreshBookmark(ContextEditor 路径,仅 contextCount 变) 不让书签从任何切片消失 (回归护栏)', async () => {
    // ContextEditor 是 refreshBookmark 的第二个 caller:上下文保存后刷新徽章计数。
    // 绝不能为「处理移动」重载 refreshBookmark 加 filter 移除语义,否则上下文保存后书签消失。
    const bm = makeBookmark('a', 'A', 'https://a.com');
    const onlyCountChanged: Bookmark = { ...bm, contextCount: 3, hasEncryptedContext: true };
    useBookmarks.setState({ bookmarks: [bm], allBookmarks: [bm] });
    vi.mocked(getByKey).mockResolvedValue(onlyCountChanged);

    await useBookmarks.getState().refreshBookmark('a');

    // 书签仍在两个切片里,只是字段更新
    expect(useBookmarks.getState().bookmarks.length).toBe(1);
    expect(useBookmarks.getState().allBookmarks.length).toBe(1);
    expect(useBookmarks.getState().bookmarks[0]!.contextCount).toBe(3);
  });

  it('T1 moveBookmark 跨工作区 (ws-1→ws-2): bookmarks + allBookmarks 都移除', async () => {
    const bm = makeBookmark('a', 'A', 'https://a.com'); // ws-1, cat-1
    useBookmarks.setState({ bookmarks: [bm], allBookmarks: [bm] });

    await useBookmarks.getState().moveBookmark('a', 'ws-2', 'cat-2');

    expect(BookmarkService.updateBookmark).toHaveBeenCalledWith('a', {
      workspaceId: 'ws-2',
      categoryId: 'cat-2',
    });
    // 跨工作区:书签不再属于当前工作区 → 两个切片都移除
    expect(useBookmarks.getState().bookmarks.some((b) => b.id === 'a')).toBe(false);
    expect(useBookmarks.getState().allBookmarks.some((b) => b.id === 'a')).toBe(false);
  });

  it('T2 moveBookmark 同工作区跨分类 (ws-1/cat-1→ws-1/cat-2): 仅 bookmarks 移除, allBookmarks 保留并更新 categoryId', async () => {
    const bm = makeBookmark('a', 'A', 'https://a.com'); // ws-1, cat-1
    useBookmarks.setState({ bookmarks: [bm], allBookmarks: [bm] });

    await useBookmarks.getState().moveBookmark('a', 'ws-1', 'cat-2');

    // 同工作区跨分类:书签仍属当前工作区,只是换了分类
    // bookmarks(当前分类切片)移除——它不再属于当前分类列表
    expect(useBookmarks.getState().bookmarks.some((b) => b.id === 'a')).toBe(false);
    // allBookmarks(当前工作区跨分类切片)保留——TabList 跨分类去重仍需它
    const inAll = useBookmarks.getState().allBookmarks.find((b) => b.id === 'a');
    expect(inAll).toBeDefined();
    expect(inAll?.categoryId).toBe('cat-2');
    expect(inAll?.workspaceId).toBe('ws-1');
  });

  it('T2.5 同ws跨cat移动+改名: moveBookmark 后 refreshBookmark 重读最新, allBookmarks name 不陈旧', async () => {
    // 验证 Content.handleBookmarkSubmit 的编排:移动+改属性时,moveBookmark 用切片旧数据,
    // 需 refreshBookmark 重读 DB 最新,否则 allBookmarks 的 name/url 陈旧影响 TabList 去重。
    const bm = makeBookmark('a', 'A', 'https://a.com'); // ws-1, cat-1
    useBookmarks.setState({ bookmarks: [bm], allBookmarks: [bm] });

    // 1. moveBookmark:同ws跨cat → bookmarks 移除, allBookmarks 保留改 cat(用切片旧 name=A)
    await useBookmarks.getState().moveBookmark('a', 'ws-1', 'cat-2');
    // 2. refreshBookmark:重读 DB 最新(name 已改 B)
    vi.mocked(getByKey).mockResolvedValue({ ...bm, name: 'B', categoryId: 'cat-2' });
    await useBookmarks.getState().refreshBookmark('a');

    // bookmarks:moveBookmark 已 filter 移除,refreshBookmark map 无匹配,仍移除
    expect(useBookmarks.getState().bookmarks.some((b) => b.id === 'a')).toBe(false);
    // allBookmarks:保留,categoryId=cat-2 且 name=B(最新,未陈旧)
    const inAll = useBookmarks.getState().allBookmarks.find((b) => b.id === 'a');
    expect(inAll?.categoryId).toBe('cat-2');
    expect(inAll?.name).toBe('B');
  });
});
