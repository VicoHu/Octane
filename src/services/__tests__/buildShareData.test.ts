import { describe, it, expect } from 'vitest';
import { buildShareData } from '@/services/BackupService';
import type { BackupData, Bookmark, Category, Context, PinnedTab, Workspace, CryptoMetadata } from '@/shared/types';
import { ContextType } from '@/shared/types';

// 构造两工作区、跨边界分类、加密 context 的全量样本
const ws1: Workspace = { id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 };
const ws2: Workspace = { id: 'ws-2', name: '个人', icon: '🏠', createdAt: 1, order: 1 };
const cat1a: Category = { id: 'cat-1a', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 };
const cat1b: Category = { id: 'cat-1b', workspaceId: 'ws-1', name: '文档', icon: '📂', order: 1, createdAt: 1 };
const cat2a: Category = { id: 'cat-2a', workspaceId: 'ws-2', name: '私藏', icon: '🔒', order: 0, createdAt: 1 };
const bm1a: Bookmark = { id: 'bm-1a', workspaceId: 'ws-1', categoryId: 'cat-1a', name: 'A', url: 'https://a.com', description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: true, order: 0, createdAt: 1, updatedAt: 1, tags: [] };
const bm1b: Bookmark = { id: 'bm-1b', workspaceId: 'ws-1', categoryId: 'cat-1b', name: 'B', url: 'https://b.com', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1, tags: [] };
const bm2a: Bookmark = { id: 'bm-2a', workspaceId: 'ws-2', categoryId: 'cat-2a', name: 'C', url: 'https://c.com', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, order: 0, createdAt: 1, updatedAt: 1, tags: [] };
const encCtx: Context = { id: 'ctx-1', bookmarkId: 'bm-1a', type: ContextType.NOTE, title: '密钥', content: '', isEncrypted: true, encryptedData: 'CIPHER', iv: 'IV', order: 0, createdAt: 1, updatedAt: 1 };
const pin1: PinnedTab = { id: 'pin-1', workspaceId: 'ws-1', name: '邮箱', url: 'https://mail.com', order: 0, createdAt: 1 };
const pin2: PinnedTab = { id: 'pin-2', workspaceId: 'ws-2', name: '私密', url: 'https://x.com', order: 0, createdAt: 1 };
const meta: CryptoMetadata = { id: 'singleton', salt: 'S1', iterations: 600000, algorithm: 'AES-GCM-256', createdAt: 1 };

const all: BackupData = {
  workspaces: [ws1, ws2], categories: [cat1a, cat1b, cat2a], bookmarks: [bm1a, bm1b, bm2a],
  contexts: [encCtx], pinnedTabs: [pin1, pin2], cryptoMetadata: meta,
};

describe('buildShareData — 分享包精确取数', () => {
  it('整选一个工作区 → 含其全部分类 + 书签 + pinnedTabs,上下文不带', () => {
    const out = buildShareData(all, { workspaceIds: ['ws-1'], categoryIds: [] }, false);
    expect(out.workspaces.map((w) => w.id)).toEqual(['ws-1']);
    expect(out.categories.map((c) => c.id).sort()).toEqual(['cat-1a', 'cat-1b']);
    expect(out.bookmarks.map((b) => b.id).sort()).toEqual(['bm-1a', 'bm-1b']);
    expect(out.pinnedTabs?.map((p) => p.id)).toEqual(['pin-1']); // ws-2 的 pin 不带
    expect(out.contexts).toEqual([]); // 不含上下文
    expect(out.cryptoMetadata).toBeNull();
  });

  it('跨边界:整选 ws-1 + 单选 ws-2 的 cat-2a → 含 ws-1 全部分类、ws-2(自洽连带)与 cat-2a 书签', () => {
    const out = buildShareData(all, { workspaceIds: ['ws-1'], categoryIds: ['cat-2a'] }, false);
    expect(out.workspaces.map((w) => w.id).sort()).toEqual(['ws-1', 'ws-2']); // ws-2 因 cat-2a 自洽连带
    // ws-1 整选(含 cat1a/cat1b),ws-2 未整选但单选 cat-2a
    expect(out.categories.map((c) => c.id).sort()).toEqual(['cat-1a', 'cat-1b', 'cat-2a']);
    expect(out.bookmarks.map((b) => b.id).sort()).toEqual(['bm-1a', 'bm-1b', 'bm-2a']);
    // pinnedTabs 只跟整选 ws-1;ws-2 单选连带但其 pin 不带(决策 B)
    expect(out.pinnedTabs?.map((p) => p.id)).toEqual(['pin-1']);
  });

  it('includeContexts=true → 选中书签的全部上下文(含加密密文) + 发送方 cryptoMetadata', () => {
    const out = buildShareData(all, { workspaceIds: ['ws-1'], categoryIds: [] }, true);
    expect(out.contexts).toHaveLength(1);
    expect(out.contexts[0]!.encryptedData).toBe('CIPHER');
    expect(out.cryptoMetadata).toEqual(meta);
  });

  it('单选一个分类(其 workspace 未整选)→ 连带 parent workspace(自洽),但不连带 pinnedTabs(决策 B)', () => {
    const out = buildShareData(all, { workspaceIds: [], categoryIds: ['cat-2a'] }, false);
    expect(out.workspaces.map((w) => w.id)).toEqual(['ws-2']); // ws-2 自洽连带(防孤儿 category)
    expect(out.categories.map((c) => c.id)).toEqual(['cat-2a']);
    expect(out.bookmarks.map((b) => b.id)).toEqual(['bm-2a']);
    expect(out.pinnedTabs).toEqual([]); // 单选分类不连带 ws-2 的常驻标签(隐私克制)
  });

  it('空 selection(workspaceIds 与 categoryIds 都空)→ 空包(调用方 buildBackupBlob 会走全量分支,不调此函数)', () => {
    const out = buildShareData(all, { workspaceIds: [], categoryIds: [] }, false);
    expect(out.workspaces).toEqual([]);
    expect(out.categories).toEqual([]);
    expect(out.bookmarks).toEqual([]);
    expect(out.pinnedTabs).toEqual([]);
  });
});