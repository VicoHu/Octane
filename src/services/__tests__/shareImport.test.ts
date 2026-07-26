import { describe, it, expect, beforeEach } from 'vitest';
import { remapShareIds, resolveNameConflicts, filterEncryptedBySalt, recomputeRedundancy, reorderForImport } from '@/services/shareImport';
import type { BackupData, Bookmark, Context, CryptoMetadata } from '@/shared/types';
import { ContextType } from '@/shared/types';

/**
 * 分享导入服务层纯函数单测(0.1.11.3 第4步)。
 * 纯函数 + 单测先行(TDD)。不碰 DB / chrome / 网络。
 */

// 确定性 ID 生成器(测试用,避免 crypto.randomUUID 非确定性 —— testing.md 白名单)
function makeGenId(): () => string {
  let n = 0;
  return () => `new-${++n}`;
}

let genId: () => string;
beforeEach(() => {
  genId = makeGenId();
});

// 最小分享包:含全部实体类型(ws/cat/bm/ctx/pin),ID 均带 -old 后缀便于残留检测
const shareData: BackupData = {
  workspaces: [{ id: 'ws-old', name: '工作', icon: '📁', createdAt: 1, order: 0 }],
  categories: [{ id: 'cat-old', workspaceId: 'ws-old', name: '工具', icon: '📂', order: 0, createdAt: 1 }],
  bookmarks: [
    {
      id: 'bm-old', workspaceId: 'ws-old', categoryId: 'cat-old', name: 'n', url: 'https://x.com',
      description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1, tags: [],
    },
  ],
  contexts: [
    {
      id: 'ctx-old', bookmarkId: 'bm-old', type: ContextType.NOTE, title: 't', content: '',
      isEncrypted: false, order: 0, createdAt: 1, updatedAt: 1,
    },
  ],
  pinnedTabs: [{ id: 'pin-old', workspaceId: 'ws-old', name: 'p', url: 'https://p.com', order: 0, createdAt: 1 }],
  cryptoMetadata: null,
};

describe('remapShareIds — 重映射分享包所有 ID(主键 + FK)', () => {
  it('所有主键被替换为新 ID(ws/cat/bm/ctx/pin)', () => {
    const r = remapShareIds(shareData, genId);
    expect(r.workspaces[0]!.id).toBe('new-1');
    expect(r.categories[0]!.id).toBe('new-2');
    expect(r.bookmarks[0]!.id).toBe('new-3');
    expect(r.contexts[0]!.id).toBe('new-4');
    expect(r.pinnedTabs![0]!.id).toBe('new-5');
  });

  it('FK 正确重映射:category.workspaceId → 新 ws id', () => {
    const r = remapShareIds(shareData, genId);
    expect(r.categories[0]!.workspaceId).toBe(r.workspaces[0]!.id);
  });

  it('FK 正确重映射:bookmark 双 FK(workspaceId + categoryId)都指向新 ID', () => {
    const r = remapShareIds(shareData, genId);
    expect(r.bookmarks[0]!.workspaceId).toBe(r.workspaces[0]!.id);
    expect(r.bookmarks[0]!.categoryId).toBe(r.categories[0]!.id);
  });

  it('FK 正确重映射:context.bookmarkId → 新 bm id', () => {
    const r = remapShareIds(shareData, genId);
    expect(r.contexts[0]!.bookmarkId).toBe(r.bookmarks[0]!.id);
  });

  it('pinnedTab 主键 id + FK workspaceId 都 remap(eng-review A1:主键不 remap 会撞接收方 ID)', () => {
    const r = remapShareIds(shareData, genId);
    expect(r.pinnedTabs![0]!.id).toBe('new-5'); // 主键 remap
    expect(r.pinnedTabs![0]!.workspaceId).toBe(r.workspaces[0]!.id); // FK remap
  });

  it('无任何 ID 残留发送方旧值(全表扫描 -old 后缀)', () => {
    const r = remapShareIds(shareData, genId);
    const json = JSON.stringify(r);
    expect(json).not.toContain('-old');
  });

  it('纯函数:不 mutate 输入(原 shareData 不变)', () => {
    remapShareIds(shareData, genId);
    expect(shareData.workspaces[0]!.id).toBe('ws-old');
    expect(shareData.bookmarks[0]!.categoryId).toBe('cat-old');
  });

  it('cryptoMetadata 原样透传(重映射不碰加密元数据)', () => {
    const withMeta: BackupData = {
      ...shareData,
      cryptoMetadata: { id: 'singleton', salt: 'S', iterations: 1, algorithm: 'AES-GCM-256', createdAt: 1 },
    };
    const r = remapShareIds(withMeta, genId);
    expect(r.cryptoMetadata?.salt).toBe('S');
  });

  it('缺 pinnedTabs(undefined)→ 输出 pinnedTabs 仍为 undefined', () => {
    const noPin: BackupData = { ...shareData, pinnedTabs: undefined };
    const r = remapShareIds(noPin, genId);
    expect(r.pinnedTabs).toBeUndefined();
  });
});

describe('resolveNameConflicts — 同名 workspace/category 追加后缀(Premise 4)', () => {
  it('workspace 与接收方同名 → 追加「 (导入)」', () => {
    const r = resolveNameConflicts(shareData, { workspaces: new Set(['工作']), categories: new Set() });
    expect(r.workspaces[0]!.name).toBe('工作 (导入)');
  });

  it('workspace 不同名 → 名称不变', () => {
    const r = resolveNameConflicts(shareData, { workspaces: new Set(['其他']), categories: new Set() });
    expect(r.workspaces[0]!.name).toBe('工作');
  });

  it('「(导入)」也被占用 → 循环到「 (导入 2)」', () => {
    const r = resolveNameConflicts(shareData, { workspaces: new Set(['工作', '工作 (导入)']), categories: new Set() });
    expect(r.workspaces[0]!.name).toBe('工作 (导入 2)');
  });

  it('category 同名 → 追加后缀;bookmark/pinnedTab 同名不处理(静默副本)', () => {
    const r = resolveNameConflicts(shareData, { workspaces: new Set(), categories: new Set(['工具']) });
    expect(r.categories[0]!.name).toBe('工具 (导入)');
    expect(r.bookmarks[0]!.name).toBe('n'); // 不改名
    expect(r.pinnedTabs![0]!.name).toBe('p'); // 不改名
  });

  it('纯函数:不 mutate 输入', () => {
    resolveNameConflicts(shareData, { workspaces: new Set(['工作']), categories: new Set() });
    expect(shareData.workspaces[0]!.name).toBe('工作');
  });
});

describe('filterEncryptedBySalt — 死密文过滤(N1)', () => {
  const plainCtx: Context = { id: 'c1', bookmarkId: 'b', type: ContextType.NOTE, title: 'p', content: '明文', isEncrypted: false, order: 0, createdAt: 1, updatedAt: 1 };
  const encCtx: Context = { id: 'c2', bookmarkId: 'b', type: ContextType.NOTE, title: 'e', content: '', isEncrypted: true, encryptedData: 'x', iv: 'y', order: 0, createdAt: 1, updatedAt: 1 };
  const meta = (salt: string): CryptoMetadata => ({ id: 'singleton', salt, iterations: 1, algorithm: 'AES-GCM-256', createdAt: 1 });

  it('接收方无 cryptoMetadata → 保留全部(含加密,将写 senderMeta)', () => {
    const r = filterEncryptedBySalt([plainCtx, encCtx], 'S1', null);
    expect(r.contexts).toHaveLength(2);
    expect(r.skippedEncrypted).toBe(0);
  });

  it('salt 相同 → 保留全部(可正常解密)', () => {
    const r = filterEncryptedBySalt([plainCtx, encCtx], 'S1', meta('S1'));
    expect(r.contexts).toHaveLength(2);
    expect(r.skippedEncrypted).toBe(0);
  });

  it('salt 不同 → 过滤加密 context(仅保留明文)+ skippedEncrypted 计数', () => {
    const r = filterEncryptedBySalt([plainCtx, encCtx], 'S1', meta('S2'));
    expect(r.contexts).toHaveLength(1);
    expect(r.contexts[0]!.isEncrypted).toBe(false);
    expect(r.skippedEncrypted).toBe(1);
  });

  it('senderSalt null(仅结构包,无加密)→ 保留全部', () => {
    const r = filterEncryptedBySalt([plainCtx], null, meta('S2'));
    expect(r.contexts).toHaveLength(1);
    expect(r.skippedEncrypted).toBe(0);
  });
});

describe('recomputeRedundancy — 冗余字段预修正(F1)', () => {
  it('按实际 context 数重算 contextCount + hasEncryptedContext(发送方冗余值失效)', () => {
    const bms: Bookmark[] = [
      { id: 'b1', workspaceId: 'w', categoryId: 'c', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 99, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1, tags: [] },
      { id: 'b2', workspaceId: 'w', categoryId: 'c', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1, tags: [] },
    ];
    const ctxs: Context[] = [
      { id: 'x1', bookmarkId: 'b1', type: ContextType.NOTE, title: 'p', content: '', isEncrypted: false, order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'x2', bookmarkId: 'b1', type: ContextType.NOTE, title: 'e', content: '', isEncrypted: true, encryptedData: 'x', iv: 'y', order: 0, createdAt: 1, updatedAt: 1 },
    ];
    const r = recomputeRedundancy(bms, ctxs);
    expect(r[0]!.contextCount).toBe(2);
    expect(r[0]!.hasEncryptedContext).toBe(true);
    expect(r[1]!.contextCount).toBe(0);
    expect(r[1]!.hasEncryptedContext).toBe(false);
  });

  it('纯函数:不 mutate 输入 bookmark', () => {
    const bms: Bookmark[] = [{ id: 'b1', workspaceId: 'w', categoryId: 'c', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 99, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1, tags: [] }];
    recomputeRedundancy(bms, []);
    expect(bms[0]!.contextCount).toBe(99);
  });
});

// ── T2:分享导入 order 重映射(0.1.12 波2)──
// 纯函数,不碰 DB。maxOrder 由编排层(applyShareImport)注入。

function bm(id: string, workspaceId: string, categoryId: string, order: number, createdAt: number): Bookmark {
  return {
    id, workspaceId, categoryId, name: 'n', url: 'u', description: '', faviconUrl: '',
    contextCount: 0, hasEncryptedContext: false, order, createdAt, updatedAt: createdAt, tags: [],
  };
}

// 2 ws × 2 category × 2 bookmark + 2 ws 各自 pinnedTab。发送方 order 故意跨容器重叠 + 乱序,
// 用以验证「不同父容器子组各自独立从 0 起,非全局连续」(outside voice P1 修正点)。
const multiWsData: BackupData = {
  workspaces: [
    { id: 'ws-x', name: 'X', icon: '📁', createdAt: 100, order: 5 },
    { id: 'ws-y', name: 'Y', icon: '📁', createdAt: 50, order: 2 },
  ],
  categories: [
    { id: 'cat-a1', workspaceId: 'ws-x', name: 'A1', icon: '📂', order: 3, createdAt: 1 },
    { id: 'cat-a2', workspaceId: 'ws-x', name: 'A2', icon: '📂', order: 1, createdAt: 2 },
    { id: 'cat-b1', workspaceId: 'ws-y', name: 'B1', icon: '📂', order: 0, createdAt: 3 },
    { id: 'cat-b2', workspaceId: 'ws-y', name: 'B2', icon: '📂', order: 4, createdAt: 4 },
  ],
  bookmarks: [
    bm('bm-a1-1', 'ws-x', 'cat-a1', 10, 1),
    bm('bm-a1-2', 'ws-x', 'cat-a1', 8, 2),
    bm('bm-a2-1', 'ws-x', 'cat-a2', 0, 3),
    bm('bm-b1-1', 'ws-y', 'cat-b1', 5, 4),
    bm('bm-b1-2', 'ws-y', 'cat-b1', 3, 5),
    bm('bm-b2-1', 'ws-y', 'cat-b2', 1, 6),
  ],
  contexts: [],
  pinnedTabs: [
    { id: 'pin-x1', workspaceId: 'ws-x', name: 'p', url: 'u', order: 2, createdAt: 1 },
    { id: 'pin-x2', workspaceId: 'ws-x', name: 'p', url: 'u', order: 0, createdAt: 2 },
    { id: 'pin-y1', workspaceId: 'ws-y', name: 'p', url: 'u', order: 7, createdAt: 3 },
  ],
  cryptoMetadata: null,
};

describe('reorderForImport — 分享导入 order 重映射(T2 纯函数)', () => {
  it('workspaces 按发送方(order,createdAt,id)稳定排序,追加 receiverMax+1,+2...', () => {
    // receiverMaxWorkspaceOrder=1(接收方现有最大 ws order)
    const r = reorderForImport(multiWsData, 1);
    // 发送方 order 升序:ws-y(2) < ws-x(5) → 赋 2, 3
    const byId = new Map(r.workspaces.map((w) => [w.id, w.order]));
    expect(byId.get('ws-y')).toBe(2);
    expect(byId.get('ws-x')).toBe(3);
  });

  it('receiverMaxWorkspaceOrder=-1(空接收方)→ 新 ws 从 0 起', () => {
    const r = reorderForImport(multiWsData, -1);
    const byId = new Map(r.workspaces.map((w) => [w.id, w.order]));
    expect(byId.get('ws-y')).toBe(0); // order=2 升序第一 → 0
    expect(byId.get('ws-x')).toBe(1);
  });

  it('categories 按 workspaceId 分子组,每组各自从 0 起(非全局连续)', () => {
    const r = reorderForImport(multiWsData, 1);
    const byId = new Map(r.categories.map((c) => [c.id, c.order]));
    // ws-x 组:cat-a2(order=1) < cat-a1(order=3) → 0, 1
    expect(byId.get('cat-a2')).toBe(0);
    expect(byId.get('cat-a1')).toBe(1);
    // ws-y 组:cat-b1(order=0) < cat-b2(order=4) → 0, 1(非 2,3 —— P1 修正点)
    expect(byId.get('cat-b1')).toBe(0);
    expect(byId.get('cat-b2')).toBe(1);
  });

  it('bookmarks 按 categoryId 分子组,每组各自从 0 起(非全局连续)', () => {
    const r = reorderForImport(multiWsData, 1);
    const byId = new Map(r.bookmarks.map((b) => [b.id, b.order]));
    // cat-a1 组:bm-a1-2(order=8) < bm-a1-1(order=10) → 0, 1
    expect(byId.get('bm-a1-2')).toBe(0);
    expect(byId.get('bm-a1-1')).toBe(1);
    // cat-a2 组:bm-a2-1(order=0) → 0(独立从 0 起,非全局连续)
    expect(byId.get('bm-a2-1')).toBe(0);
    // cat-b1 组:bm-b1-2(order=3) < bm-b1-1(order=5) → 0, 1
    expect(byId.get('bm-b1-2')).toBe(0);
    expect(byId.get('bm-b1-1')).toBe(1);
    // cat-b2 组:bm-b2-1(order=1) → 0
    expect(byId.get('bm-b2-1')).toBe(0);
  });

  it('pinnedTabs 按 workspaceId 分子组,每组各自从 0 起(非全局连续)', () => {
    const r = reorderForImport(multiWsData, 1);
    const byId = new Map(r.pinnedTabs!.map((p) => [p.id, p.order]));
    // ws-x 组:pin-x2(order=0) < pin-x1(order=2) → 0, 1
    expect(byId.get('pin-x2')).toBe(0);
    expect(byId.get('pin-x1')).toBe(1);
    // ws-y 组:pin-y1(order=7) → 0(独立从 0 起)
    expect(byId.get('pin-y1')).toBe(0);
  });

  it('纯函数:不 mutate 输入(原数据 order 不变)', () => {
    reorderForImport(multiWsData, 1);
    expect(multiWsData.workspaces[0]!.order).toBe(5);
    expect(multiWsData.categories[0]!.order).toBe(3);
    expect(multiWsData.bookmarks[0]!.order).toBe(10);
    expect(multiWsData.pinnedTabs![0]!.order).toBe(2);
  });

  it('ID 不变(只重排 order;ID remap 由 remapShareIds 另行处理)', () => {
    const r = reorderForImport(multiWsData, 1);
    expect(r.workspaces.map((w) => w.id)).toEqual(['ws-x', 'ws-y']);
    expect(r.categories.map((c) => c.id)).toEqual(['cat-a1', 'cat-a2', 'cat-b1', 'cat-b2']);
  });

  it('cryptoMetadata 原样透传', () => {
    const r = reorderForImport(multiWsData, 1);
    expect(r.cryptoMetadata).toBeNull();
  });

  it('缺 pinnedTabs(undefined)→ 输出仍为 undefined', () => {
    const noPin: BackupData = { ...multiWsData, pinnedTabs: undefined };
    const r = reorderForImport(noPin, 1);
    expect(r.pinnedTabs).toBeUndefined();
  });

  it('同 order tie-break:createdAt 升序,再 id 字符串升序', () => {
    // 三个 ws 同 order=0,验证 (createdAt, id) tie-break
    const tieData: BackupData = {
      ...multiWsData,
      workspaces: [
        { id: 'ws-c', name: 'C', icon: '📁', createdAt: 50, order: 0 },
        { id: 'ws-a', name: 'A', icon: '📁', createdAt: 50, order: 0 },
        { id: 'ws-b', name: 'B', icon: '📁', createdAt: 30, order: 0 },
      ],
    };
    const r = reorderForImport(tieData, 0);
    // 排序:ws-b(createdAt=30) < ws-a(50,id=a) < ws-c(50,id=c) → 赋 1, 2, 3(receiverMax=0)
    const byId = new Map(r.workspaces.map((w) => [w.id, w.order]));
    expect(byId.get('ws-b')).toBe(1);
    expect(byId.get('ws-a')).toBe(2);
    expect(byId.get('ws-c')).toBe(3);
  });
});

// ── Issue #55: 分享链路 Tag 原样保留 ──
// 分享数据的选择构建、ID 重映射、冲突处理、顺序重排和冗余字段重算均保持 Tag 原样。

function bmWithTags(id: string, tags: string[]): Bookmark {
  return {
    id, workspaceId: 'ws-old', categoryId: 'cat-old', name: 'n', url: 'https://x.com',
    description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false,
    order: 0, createdAt: 1, updatedAt: 1, tags,
  };
}

const tagShareData: BackupData = {
  workspaces: [{ id: 'ws-old', name: '工作', icon: '📁', createdAt: 1, order: 0 }],
  categories: [{ id: 'cat-old', workspaceId: 'ws-old', name: '工具', icon: '📂', order: 0, createdAt: 1 }],
  bookmarks: [
    bmWithTags('bm-tags', ['前端', 'React', '重要']),
    bmWithTags('bm-empty', []),
  ],
  contexts: [],
  pinnedTabs: [],
  cryptoMetadata: null,
};

describe('remapShareIds — Tag 原样保留（#55）', () => {
  it('ID 重映射后 bookmark tags 原样保留，不被清空或修改', () => {
    const r = remapShareIds(tagShareData, genId);
    const withTags = r.bookmarks.find((b) => b.name === 'n' && b.tags.length > 0)!;
    expect(withTags.tags).toEqual(['前端', 'React', '重要']);
  });

  it('空 tags 的 bookmark 重映射后仍为空数组', () => {
    const r = remapShareIds(tagShareData, genId);
    const empty = r.bookmarks.find((b) => b.name === 'n' && b.tags.length === 0)!;
    expect(empty.tags).toEqual([]);
  });
});

describe('recomputeRedundancy — Tag 原样保留（#55）', () => {
  it('冗余字段重算（contextCount/hasEncryptedContext）不改变 tags', () => {
    const r = recomputeRedundancy(tagShareData.bookmarks, []);
    expect(r[0]!.tags).toEqual(['前端', 'React', '重要']);
    expect(r[1]!.tags).toEqual([]);
  });
});

describe('reorderForImport — Tag 原样保留（#55）', () => {
  it('order 重排后 bookmark tags 原样保留', () => {
    const r = reorderForImport(tagShareData, 0);
    const withTags = r.bookmarks.find((b) => b.tags.length > 0)!;
    expect(withTags.tags).toEqual(['前端', 'React', '重要']);
  });
});

describe('resolveNameConflicts — Tag 原样保留（#55）', () => {
  it('同名后缀处理不改变 bookmark tags', () => {
    const r = resolveNameConflicts(tagShareData, { workspaces: new Set(['工作']), categories: new Set() });
    expect(r.bookmarks[0]!.tags).toEqual(['前端', 'React', '重要']);
  });
});
