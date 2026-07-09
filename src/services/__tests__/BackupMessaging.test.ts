import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMessage } from '@/services/BackupMessaging';
import * as BackupService from '@/services/BackupService';
import type { BackupData, ShareSelection } from '@/shared/types';

const emptyData: BackupData = {
  workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null,
};
// 分享导入消息样本（含 selection + pinnedTabs）
const shareData: BackupData = {
  workspaces: [], categories: [], bookmarks: [], contexts: [], pinnedTabs: [], cryptoMetadata: null,
};
const sel: ShareSelection = { workspaceIds: ['ws-1'], categoryIds: [] };

describe('handleMessage', () => {
  // 防止 spy 跨用例泄漏：每个用例后还原所有 mock
  beforeEach(() => vi.restoreAllMocks());

  it('octane:apply-import → 调 applyImport 并返回 ok', async () => {
    const spy = vi.spyOn(BackupService, 'applyImport').mockResolvedValue(undefined);
    const r = await handleMessage({ type: 'octane:apply-import', data: emptyData });
    expect(spy).toHaveBeenCalledWith(emptyData);
    expect(r).toEqual({ ok: true });
    spy.mockRestore();
  });

  it('applyImport 抛错 → 返回 ok:false + error', async () => {
    vi.spyOn(BackupService, 'applyImport').mockRejectedValue(new Error('写入失败'));
    const r = await handleMessage({ type: 'octane:apply-import', data: emptyData });
    expect(r).toEqual({ ok: false, error: '写入失败' });
  });

  it('octane:apply-share-import → 调 applyShareImport(data, selection) + 返回 result', async () => {
    const spy = vi.spyOn(BackupService, 'applyShareImport').mockResolvedValue({ workspaces: 1, categories: 1, bookmarks: 1, skippedEncrypted: 0 });
    const r = await handleMessage({ type: 'octane:apply-share-import', data: shareData, selection: sel });
    expect(spy).toHaveBeenCalledWith(shareData, sel);
    expect(r).toEqual({ ok: true, result: { workspaces: 1, categories: 1, bookmarks: 1, skippedEncrypted: 0 } });
    spy.mockRestore();
  });

  it('applyShareImport 抛错 → 返回 ok:false + error', async () => {
    vi.spyOn(BackupService, 'applyShareImport').mockRejectedValue(new Error('事务失败'));
    const r = await handleMessage({ type: 'octane:apply-share-import', data: shareData, selection: sel });
    expect(r).toEqual({ ok: false, error: '事务失败' });
  });

  it('无关消息 → undefined（不处理）', async () => {
    expect(await handleMessage({ type: 'something-else' })).toBeUndefined();
    expect(await handleMessage(null)).toBeUndefined();
  });
});
