import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BackupData } from '@/shared/types';

// 打桩 applyImport 的全部副作用边界：DB 写入、crypto lock、context 元数据重算
vi.mock('@/shared/db/database', () => ({
  replaceAllDataRaw: vi.fn(async () => undefined),
  broadcastChange: vi.fn(),
  broadcastImport: vi.fn(),
}));
vi.mock('@/services/ContextService', () => ({ syncContextMeta: vi.fn(async () => undefined) }));
vi.mock('@/services/CryptoService', () => ({ lock: vi.fn(async () => undefined) }));

import { applyImport } from '@/services/BackupService';
import { broadcastChange, broadcastImport, replaceAllDataRaw } from '@/shared/db/database';

const data: BackupData = {
  workspaces: [],
  categories: [],
  bookmarks: [],
  contexts: [],
  pinnedTabs: [],
  cryptoMetadata: null,
  taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [],
};

describe('applyImport — 广播 pinnedTabs（T3）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('导入完成后对全部业务 store（书签 5 表 + 待办 5 表）触发 broadcastChange put', async () => {
    await applyImport(data);

    // 写入 + 全量广播都被调用
    expect(replaceAllDataRaw).toHaveBeenCalledWith(data);
    expect(broadcastImport).toHaveBeenCalledTimes(1);

    // 全部业务 store 各触发一次 put（含待办 5 表）
    const calls = vi.mocked(broadcastChange).mock.calls;
    for (const store of [
      'workspaces', 'categories', 'bookmarks', 'contexts', 'pinnedTabs',
      'taskLists', 'tasks', 'checklistItems', 'taskTags', 'taskTagAssignments',
    ]) {
      expect(calls.some((c) => c[0] === store && c[1] === 'put')).toBe(true);
    }
  });
});
