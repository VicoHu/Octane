import { describe, it, expect, beforeEach } from 'vitest';
import { remapShareIds, resolveNameConflicts, filterEncryptedBySalt, recomputeRedundancy } from '@/services/shareImport';
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
      description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1,
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
      { id: 'b1', workspaceId: 'w', categoryId: 'c', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 99, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'b2', workspaceId: 'w', categoryId: 'c', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1 },
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
    const bms: Bookmark[] = [{ id: 'b1', workspaceId: 'w', categoryId: 'c', name: 'n', url: 'u', description: '', faviconUrl: '', contextCount: 99, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1 }];
    recomputeRedundancy(bms, []);
    expect(bms[0]!.contextCount).toBe(99);
  });
});
