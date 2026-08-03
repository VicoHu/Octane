import { beforeEach, describe, expect, it } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';
import {
  loadTodoUiPreferences,
  saveDetailSplitPercent,
  saveSortOverride,
} from '@/shared/todoUiPreferences';

beforeEach(() => {
  installChromeStorageLocal();
});

describe('todoUiPreferences — 正常读写', () => {
  it('读取已保存的分栏比例和视图排序偏好', async () => {
    installChromeStorageLocal({
      initial: {
        'todo.detailSplitPercent': 57,
        'todo.sortOverrides': { 'workspace-1:inbox': 'dueDate' },
      },
    });

    await expect(loadTodoUiPreferences()).resolves.toEqual({
      detailSplitPercent: 57,
      sortOverrides: { 'workspace-1:inbox': 'dueDate' },
    });
  });

  it('保存分栏比例和指定视图的排序偏好', async () => {
    const { store } = installChromeStorageLocal();

    await saveDetailSplitPercent(52);
    await saveSortOverride('workspace-1:today', 'priority');

    expect(store['todo.detailSplitPercent']).toBe(52);
    expect(store['todo.sortOverrides']).toEqual({ 'workspace-1:today': 'priority' });
  });
});

describe('todoUiPreferences — 损坏数据容错', () => {
  it('非法 JSON 字符串或非法值回退默认值', async () => {
    installChromeStorageLocal({
      initial: {
        'todo.detailSplitPercent': 'not-a-number',
        'todo.sortOverrides': '{not-json}',
      },
    });

    await expect(loadTodoUiPreferences()).resolves.toEqual({
      detailSplitPercent: null,
      sortOverrides: {},
    });
  });
});

describe('todoUiPreferences — storage 不可用', () => {
  it('storage 读写抛错时不阻塞页面', async () => {
    installChromeStorageLocal({
      getImpl: async () => {
        throw new Error('storage unavailable');
      },
      setImpl: async () => {
        throw new Error('storage unavailable');
      },
    });

    await expect(loadTodoUiPreferences()).resolves.toEqual({
      detailSplitPercent: null,
      sortOverrides: {},
    });
    await expect(saveDetailSplitPercent(null)).resolves.toBeUndefined();
    await expect(saveSortOverride('workspace-1:today', 'manual')).resolves.toBeUndefined();
  });
});
