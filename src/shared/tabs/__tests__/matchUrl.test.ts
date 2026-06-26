import { describe, it, expect } from 'vitest';
import { bookmarkMatchesOpenTab, normalizeUrl } from '../matchUrl';

describe('bookmarkMatchesOpenTab — 书签与已打开 Tab 的前缀匹配（段边界）', () => {
  it('[REGRESSION] 根书签匹配同站子路径：导航到 /archives 后竖线仍亮', () => {
    // 用户报告的原始 bug：书签 vicohu.com 打开后 tab 导航到子路径，竖线消失
    expect(
      bookmarkMatchesOpenTab('https://vicohu.com', 'https://vicohu.com/archives/hello-halo'),
    ).toBe(true);
  });

  it('段边界：/blog 不匹配 /blogger（前缀相同但非整段）', () => {
    expect(bookmarkMatchesOpenTab('https://vicohu.com/blog', 'https://vicohu.com/blogger')).toBe(
      false,
    );
  });

  it('段边界：/user 不匹配 /user2', () => {
    expect(bookmarkMatchesOpenTab('https://vicohu.com/user', 'https://vicohu.com/user2')).toBe(
      false,
    );
  });

  it('子路径书签匹配更深层页面：/archives 匹配 /archives/hello-halo', () => {
    expect(
      bookmarkMatchesOpenTab('https://vicohu.com/archives', 'https://vicohu.com/archives/hello-halo'),
    ).toBe(true);
  });

  it('精确匹配：路径完全相等', () => {
    expect(
      bookmarkMatchesOpenTab('https://vicohu.com/archives', 'https://vicohu.com/archives'),
    ).toBe(true);
  });

  it('末尾斜杠归一：/archives 与 /archives/ 等价（双向）', () => {
    expect(
      bookmarkMatchesOpenTab('https://vicohu.com/archives/', 'https://vicohu.com/archives'),
    ).toBe(true);
    expect(
      bookmarkMatchesOpenTab('https://vicohu.com/archives', 'https://vicohu.com/archives/'),
    ).toBe(true);
  });

  it('根书签匹配根 tab（双方都为根）', () => {
    expect(bookmarkMatchesOpenTab('https://vicohu.com', 'https://vicohu.com/')).toBe(true);
  });

  it('深链接书签不匹配同站根页面：/archives 不匹配 /', () => {
    expect(bookmarkMatchesOpenTab('https://vicohu.com/archives', 'https://vicohu.com/')).toBe(
      false,
    );
  });

  it('host 不等 → 不匹配', () => {
    expect(bookmarkMatchesOpenTab('https://vicohu.com', 'https://example.com/archives')).toBe(
      false,
    );
  });

  it('host 含端口参与比较（端口不等 → 不匹配）', () => {
    expect(bookmarkMatchesOpenTab('https://localhost:3000', 'https://localhost:8080/app')).toBe(
      false,
    );
  });

  it('忽略 protocol / query / hash（仅比较 host + pathname）', () => {
    expect(
      bookmarkMatchesOpenTab(
        'https://github.com/user/repo?a=1',
        'http://github.com/user/repo#top',
      ),
    ).toBe(true);
  });

  it('非法 bookmark URL → 不匹配', () => {
    expect(bookmarkMatchesOpenTab('not-a-url', 'https://vicohu.com')).toBe(false);
  });

  it('非法 tab URL → 不匹配', () => {
    expect(bookmarkMatchesOpenTab('https://vicohu.com', 'not-a-url')).toBe(false);
  });
});

describe('normalizeUrl（保留：精确 host+pathname key）', () => {
  it('返回 host + pathname（不去末尾斜杠），保留原始精确语义', () => {
    expect(normalizeUrl('https://vicohu.com/archives/')).toBe('vicohu.com/archives/');
    expect(normalizeUrl('http://github.com/user/repo?a=1#top')).toBe('github.com/user/repo');
  });

  it('非法 URL → null', () => {
    expect(normalizeUrl('not-a-url')).toBeNull();
  });
});
