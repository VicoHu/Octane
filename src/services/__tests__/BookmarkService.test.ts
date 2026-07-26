import { describe, it, expect } from 'vitest';
import { findBookmarksByHost, getFaviconUrl } from '@/services/BookmarkService';
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
    order: 0,
    tags: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('findBookmarksByHost — 按 hostname 严格匹配书签', () => {
  it('严格 hostname 匹配：存 google.com，查 www.google.com → 不命中', () => {
    const bookmarks = [makeBookmark({ url: 'https://google.com' })];
    expect(findBookmarksByHost(bookmarks, 'www.google.com')).toHaveLength(0);
  });

  it('hostname 命中：存 www.google.com，查 www.google.com → 命中该书签', () => {
    const bookmarks = [makeBookmark({ id: 'bm-1', url: 'https://www.google.com' })];
    const result = findBookmarksByHost(bookmarks, 'www.google.com');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('bm-1');
  });

  it('带路径的 url 仅比较 hostname：存 .../search?q=x，查 www.google.com → 命中', () => {
    const bookmarks = [makeBookmark({ url: 'https://www.google.com/search?q=x' })];
    expect(findBookmarksByHost(bookmarks, 'www.google.com')).toHaveLength(1);
  });

  it('同 host 多书签全部命中', () => {
    const bookmarks = [
      makeBookmark({ id: 'bm-1', url: 'https://www.google.com' }),
      makeBookmark({ id: 'bm-2', url: 'https://www.google.com/maps' }),
      makeBookmark({ id: 'bm-3', url: 'https://github.com' }),
    ];
    const result = findBookmarksByHost(bookmarks, 'www.google.com');
    expect(result.map((b) => b.id).sort()).toEqual(['bm-1', 'bm-2']);
  });

  it('hostname 为空 → 返回 []', () => {
    const bookmarks = [makeBookmark({ url: 'https://www.google.com' })];
    expect(findBookmarksByHost(bookmarks, '')).toHaveLength(0);
  });

  it('localhost:port 提取 hostname 不含端口', () => {
    const bookmarks = [makeBookmark({ url: 'http://localhost:3000' })];
    expect(findBookmarksByHost(bookmarks, 'localhost')).toHaveLength(1);
  });

  it('url 解析失败的书签被跳过，不抛错', () => {
    const bookmarks = [
      makeBookmark({ id: 'bm-bad', url: '不是有效网址' }),
      makeBookmark({ id: 'bm-ok', url: 'https://www.google.com' }),
    ];
    const result = findBookmarksByHost(bookmarks, 'www.google.com');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('bm-ok');
  });
});

describe('getFaviconUrl — 公网走 Google，本机/内网回退源站', () => {
  it('公网域名 → Google Favicon API', () => {
    expect(getFaviconUrl('https://github.com/user/repo')).toBe(
      'https://www.google.com/s2/favicons?domain=github.com&sz=32',
    );
  });

  it('localhost（带端口+hash）→ 回退源站 origin/favicon.ico', () => {
    expect(getFaviconUrl('http://localhost:8648/#/hermes/chat')).toBe(
      'http://localhost:8648/favicon.ico',
    );
  });

  it('内网 IPv4 → 回退源站', () => {
    expect(getFaviconUrl('http://192.168.1.10:8080/app')).toBe(
      'http://192.168.1.10:8080/favicon.ico',
    );
  });

  it('回环地址 127.0.0.1 → 回退源站', () => {
    expect(getFaviconUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/favicon.ico');
  });

  it('*.local 局域网域名 → 回退源站', () => {
    expect(getFaviconUrl('http://nas.local')).toBe('http://nas.local/favicon.ico');
  });

  it('非法 url → 空串', () => {
    expect(getFaviconUrl('不是网址')).toBe('');
  });
});
