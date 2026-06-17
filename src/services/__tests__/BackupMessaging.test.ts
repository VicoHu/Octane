import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMessage } from '@/services/BackupMessaging';
import * as BackupService from '@/services/BackupService';
import type { BackupData } from '@/shared/types';

const emptyData: BackupData = {
  workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null,
};

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

  it('无关消息 → undefined（不处理）', async () => {
    expect(await handleMessage({ type: 'something-else' })).toBeUndefined();
    expect(await handleMessage(null)).toBeUndefined();
  });
});
