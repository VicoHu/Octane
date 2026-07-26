import { describe, it, expect } from 'vitest';
import { treeValueToSelection, shareStats } from '@/components/backup/shareSelection';
import type { Bookmark, Category, Workspace } from '@/shared/types';

const tree = [
  { key: 'ws-1', children: [{ key: 'cat-1a' }, { key: 'cat-1b' }] },
  { key: 'ws-2', children: [{ key: 'cat-2a' }] },
];

describe('treeValueToSelection — Semi Tree value[] 转 ShareSelection', () => {
  it('整选 workspace(autoMergeValue:value 只含 ws key)→ workspaceIds', () => {
    const sel = treeValueToSelection(['ws-1'], tree);
    expect(sel).toEqual({ workspaceIds: ['ws-1'], categoryIds: [] });
  });

  it('半选(只选 ws-1 的部分 category)→ workspaceIds 空,categoryIds 含选中', () => {
    const sel = treeValueToSelection(['cat-1a'], tree);
    expect(sel).toEqual({ workspaceIds: [], categoryIds: ['cat-1a'] });
  });

  it('混合:整选 ws-2 + 半选 ws-1 的 cat-1a', () => {
    const sel = treeValueToSelection(['ws-2', 'cat-1a'], tree);
    expect(sel).toEqual({ workspaceIds: ['ws-2'], categoryIds: ['cat-1a'] });
  });

  it('父+全子 key(autoMergeValue 未生效情形)→ 仍只 workspaceIds(else-if 兜底,组件不依赖 autoMergeValue)', () => {
    // autoMergeValue 生效时勾父只回父 key['ws-1'];未生效时回父+全子['ws-1','cat-1a','cat-1b']。
    // else-if 结构:父 key 命中走 if 分支进 workspaceIds,不再扫子,categoryIds 保持空。
    // 故两种 Semi 原始 value 产出相同 ShareSelection,组件正确性不依赖 autoMergeValue 是否生效。
    const sel = treeValueToSelection(['ws-1', 'cat-1a', 'cat-1b'], tree);
    expect(sel).toEqual({ workspaceIds: ['ws-1'], categoryIds: [] });
  });
});

const workspaces: Workspace[] = [
  { id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 },
  { id: 'ws-2', name: '个人', icon: '🏠', createdAt: 1, order: 1 },
];
const categories: Category[] = [
  { id: 'cat-1a', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 },
  { id: 'cat-1b', workspaceId: 'ws-1', name: '文档', icon: '📂', order: 1, createdAt: 1 },
  { id: 'cat-2a', workspaceId: 'ws-2', name: '私藏', icon: '🔒', order: 0, createdAt: 1 },
];
const bookmarks: Bookmark[] = [
  { id: 'bm-1a', workspaceId: 'ws-1', categoryId: 'cat-1a', name: 'A', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1, order: 0, tags: [] },
  { id: 'bm-1b', workspaceId: 'ws-1', categoryId: 'cat-1b', name: 'B', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1, order: 0, tags: [] },
  { id: 'bm-2a', workspaceId: 'ws-2', categoryId: 'cat-2a', name: 'C', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1, order: 0, tags: [] },
];

describe('shareStats — 选集数量统计(含整选 ws 连带分类)', () => {
  it('整选 ws-1 → ws=1, cat=2(连带), bm=2', () => {
    expect(shareStats(workspaces, categories, bookmarks, { workspaceIds: ['ws-1'], categoryIds: [] }))
      .toEqual({ ws: 1, cat: 2, bm: 2 });
  });

  it('单选 cat-2a(ws-2 未整选)→ ws=1(连带 ws-2), cat=1, bm=1', () => {
    expect(shareStats(workspaces, categories, bookmarks, { workspaceIds: [], categoryIds: ['cat-2a'] }))
      .toEqual({ ws: 1, cat: 1, bm: 1 });
  });

  it('空选 → 全 0', () => {
    expect(shareStats(workspaces, categories, bookmarks, { workspaceIds: [], categoryIds: [] }))
      .toEqual({ ws: 0, cat: 0, bm: 0 });
  });
});
