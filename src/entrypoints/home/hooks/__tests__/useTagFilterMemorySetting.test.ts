import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installChromeStorageLocal } from '@/test/storageMock';
import { useTagFilterMemorySetting } from '../useTagFilterMemorySetting';

describe('useTagFilterMemorySetting — Tag 筛选记忆范围设置 hook', () => {
  beforeEach(() => installChromeStorageLocal({}));

  it('storage 无 key（默认）→ scope 为 category，status 为 ready', async () => {
    const { result } = renderHook(() => useTagFilterMemorySetting());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.scope).toBe('category');
  });

  it('storage 已存 workspace → 加载后 scope 为 workspace', async () => {
    installChromeStorageLocal({ initial: { tagFilterMemoryScope: 'workspace' } });
    const { result } = renderHook(() => useTagFilterMemorySetting());

    await waitFor(() => expect(result.current.scope).toBe('workspace'));
  });

  it('storage 已存 session → 加载后 scope 为 session', async () => {
    installChromeStorageLocal({ initial: { tagFilterMemoryScope: 'session' } });
    const { result } = renderHook(() => useTagFilterMemorySetting());

    await waitFor(() => expect(result.current.scope).toBe('session'));
  });

  it('非法存储值 → 回退 category', async () => {
    installChromeStorageLocal({ initial: { tagFilterMemoryScope: 'bogus' } });
    const { result } = renderHook(() => useTagFilterMemorySetting());

    await waitFor(() => expect(result.current.scope).toBe('category'));
  });

  it('updateScope 写入 storage + 同步 React state', async () => {
    const { store } = installChromeStorageLocal({});
    const { result } = renderHook(() => useTagFilterMemorySetting());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await result.current.updateScope('workspace');

    await waitFor(() => expect(result.current.scope).toBe('workspace'));
    expect(store.tagFilterMemoryScope).toBe('workspace');
  });
});
