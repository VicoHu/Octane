import { describe, it, expect } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';
import {
  getTagFilterMemoryScope,
  setTagFilterMemoryScope,
  DEFAULT_TAG_FILTER_MEMORY_SCOPE,
} from '../tagFilterMemorySetting';

// tagFilterMemorySetting：Tag 筛选记忆范围 storage.local key。
// 用 installChromeStorageLocal 装真实 in-memory storage.local 往返（规范 §6）。

describe('tagFilterMemorySetting — 记忆范围 storage.local CRUD', () => {
  it('默认 category（未设置 → 仅当前分类）', async () => {
    installChromeStorageLocal({});
    expect(await getTagFilterMemoryScope()).toBe('category');
  });

  it('默认值常量为 category', () => {
    expect(DEFAULT_TAG_FILTER_MEMORY_SCOPE).toBe('category');
  });

  it('set workspace → get workspace', async () => {
    const { store } = installChromeStorageLocal({});
    await setTagFilterMemoryScope('workspace');
    expect(await getTagFilterMemoryScope()).toBe('workspace');
    expect(store.tagFilterMemoryScope).toBe('workspace');
  });

  it('set session → get session', async () => {
    installChromeStorageLocal({});
    await setTagFilterMemoryScope('session');
    expect(await getTagFilterMemoryScope()).toBe('session');
  });

  it('set category → get category（显式设回默认）', async () => {
    installChromeStorageLocal({});
    await setTagFilterMemoryScope('category');
    expect(await getTagFilterMemoryScope()).toBe('category');
  });

  it('非法值（手动篡改）→ 回退 category', async () => {
    installChromeStorageLocal({ initial: { tagFilterMemoryScope: 'bogus' } });
    expect(await getTagFilterMemoryScope()).toBe('category');
  });
});
