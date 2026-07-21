import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { installChromeStorageLocal } from '@/test/storageMock';
import { usePendingUpdate } from '../usePendingUpdate';

// installChromeStorageLocal 设 chrome = { storage: { local } }，缺 onChanged / runtime。
// 此辅助一次性补齐：onChanged（no-op listener）+ runtime.getManifest 版本。
function setupChrome(opts: { initial?: Record<string, unknown>; version?: string }) {
  installChromeStorageLocal({ initial: opts.initial ?? {} });
  const chromeObj = (globalThis as { chrome?: Record<string, unknown> }).chrome!;
  chromeObj.runtime = { getManifest: () => ({ version: opts.version ?? '0.1.13.0' }) };
  (chromeObj.storage as Record<string, unknown>).onChanged = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
}

describe('usePendingUpdate', () => {
  it('pending 超前 → 返回版本', async () => {
    setupChrome({ initial: { pendingUpdate: { version: '0.1.14.0' } } });
    const { result } = renderHook(() => usePendingUpdate());
    await waitFor(() => expect(result.current.version).toBe('0.1.14.0'));
  });

  it('无 pending → null', async () => {
    setupChrome({});
    const { result } = renderHook(() => usePendingUpdate());
    await waitFor(() => expect(result.current.version).toBeNull());
  });

  it('pending 残留（不超前）→ null', async () => {
    setupChrome({ initial: { pendingUpdate: { version: '0.1.12.0' } }, version: '0.1.13.0' });
    const { result } = renderHook(() => usePendingUpdate());
    await waitFor(() => expect(result.current.version).toBeNull());
  });

  it('注册 storage.onChanged listener（卸载时移除）', () => {
    setupChrome({});
    const { unmount } = renderHook(() => usePendingUpdate());
    const onChanged = ((globalThis as { chrome?: { storage?: Record<string, unknown> } }).chrome!
      .storage! as Record<string, unknown>).onChanged as {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    expect(onChanged.addListener).toHaveBeenCalledOnce();
    unmount();
    expect(onChanged.removeListener).toHaveBeenCalledOnce();
  });
});
