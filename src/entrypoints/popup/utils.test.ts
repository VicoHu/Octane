import { describe, it, expect } from 'vitest';
import { isUrlValid, findDuplicateUrl } from './utils';
import type { Bookmark } from '@/shared/types';

/** 书签测试工厂：补全所有必填字段，允许按用例覆盖 */
function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm-default',
    workspaceId: 'ws-1',
    categoryId: 'cat-1',
    name: '测试书签',
    url: 'https://github.com',
    description: '',
    faviconUrl: '',
    contextCount: 0,
    hasEncryptedContext: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('isUrlValid — URL 合法性校验（仅允许 http/https）', () => {
  it('合法 https URL 返回 true', () => {
    expect(isUrlValid('https://github.com')).toBe(true);
  });

  it('合法 http URL 返回 true', () => {
    expect(isUrlValid('http://example.com')).toBe(true);
  });

  it('带路径与查询参数的合法 URL 返回 true', () => {
    expect(isUrlValid('https://github.com/user/repo?tab=readme')).toBe(true);
  });

  it('chrome:// 等浏览器特殊协议返回 false', () => {
    expect(isUrlValid('chrome://newtab')).toBe(false);
    expect(isUrlValid('chrome-extension://abc/options.html')).toBe(false);
  });

  it('缺少协议的字符串返回 false', () => {
    expect(isUrlValid('github.com')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isUrlValid('')).toBe(false);
  });

  it('非 URL 文本返回 false', () => {
    expect(isUrlValid('这不是一个网址')).toBe(false);
  });
});

describe('findDuplicateUrl — 重复检测（维度：workspaceId + categoryId + url）', () => {
  // 注：传入的 bookmarks 应为某 workspaceId 下的全部书签，
  // workspaceId 维度已由 listBookmarksByWorkspace 限定，
  // 此函数仅按 categoryId + url 精确匹配。

  it('同分类已有相同 URL → 返回该书签', () => {
    const bookmarks = [
      makeBookmark({ id: 'bm-1', categoryId: 'cat-1', url: 'https://github.com' }),
      makeBookmark({ id: 'bm-2', categoryId: 'cat-2', url: 'https://github.com' }),
    ];
    const dup = findDuplicateUrl(bookmarks, 'cat-1', 'https://github.com');
    expect(dup?.id).toBe('bm-1');
  });

  it('同分类但 URL 不同 → 返回 null（无重复）', () => {
    const bookmarks = [makeBookmark({ categoryId: 'cat-1', url: 'https://github.com' })];
    expect(findDuplicateUrl(bookmarks, 'cat-1', 'https://other.com')).toBeNull();
  });

  it('同工作区不同分类的相同 URL → 返回 null（允许跨分类重复）', () => {
    const bookmarks = [makeBookmark({ categoryId: 'cat-1', url: 'https://github.com' })];
    // 在 cat-2 中检查，即使 cat-1 有同 URL 也不视为重复
    expect(findDuplicateUrl(bookmarks, 'cat-2', 'https://github.com')).toBeNull();
  });

  it('URL 尾部斜杠差异视为不同 URL（精确匹配，不做规范化）', () => {
    const bookmarks = [makeBookmark({ categoryId: 'cat-1', url: 'https://github.com' })];
    expect(findDuplicateUrl(bookmarks, 'cat-1', 'https://github.com/')).toBeNull();
  });

  it('空书签列表 → 返回 null', () => {
    expect(findDuplicateUrl([], 'cat-1', 'https://github.com')).toBeNull();
  });

  it('多个书签命中时返回第一个匹配项', () => {
    const bookmarks = [
      makeBookmark({ id: 'first', categoryId: 'cat-1', url: 'https://github.com' }),
      makeBookmark({ id: 'second', categoryId: 'cat-1', url: 'https://github.com' }),
    ];
    expect(findDuplicateUrl(bookmarks, 'cat-1', 'https://github.com')?.id).toBe('first');
  });
});
