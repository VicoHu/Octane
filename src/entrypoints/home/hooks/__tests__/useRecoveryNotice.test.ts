import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const recovery = vi.hoisted(() => ({
  takeRecoveryNotice: vi.fn(),
  retryPendingRecovery: vi.fn(async () => {}),
}));
const toast = vi.hoisted(() => ({ warning: vi.fn() }));

vi.mock('@/shared/tabs/sessionContinuity', () => recovery);
vi.mock('@/components/ui/toast', () => ({ Toast: toast }));

import { useRecoveryNotice } from '../useRecoveryNotice';

type StorageListener = (changes: Record<string, unknown>, area: string) => void;

function setupStorageEvents() {
  let listener: StorageListener | undefined;
  const onChanged = {
    addListener: vi.fn((callback: StorageListener) => { listener = callback; }),
    removeListener: vi.fn((callback: StorageListener) => {
      if (listener === callback) listener = undefined;
    }),
  };
  (globalThis as { chrome?: unknown }).chrome = { storage: { onChanged } };
  return { onChanged, emit: (changes: Record<string, unknown>, area = 'local') => listener?.(changes, area) };
}

describe('useRecoveryNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupStorageEvents();
  });

  it('存在未恢复条目：显示仅含数量的提示，并提供可访问重试 action', async () => {
    recovery.takeRecoveryNotice.mockResolvedValue({ restoredCount: 7, failedCount: 1, shown: false });
    renderHook(() => useRecoveryNotice());

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.objectContaining({
      content: '已恢复 7 个标签页，1 个未恢复',
      action: expect.objectContaining({ label: '重试' }),
    })));
    const input = toast.warning.mock.calls[0]![0] as { action: { onClick: () => void } };
    input.action.onClick();
    await waitFor(() => expect(recovery.retryPendingRecovery).toHaveBeenCalledOnce());
  });

  it('初读 pending 时收到 recovery notice 变化：串行重读且只显示一次', async () => {
    const { emit } = setupStorageEvents();
    let releaseInitialRead: (() => void) | undefined;
    const initialRead = new Promise<null>((resolve) => { releaseInitialRead = () => resolve(null); });
    recovery.takeRecoveryNotice
      .mockImplementationOnce(() => initialRead)
      .mockResolvedValueOnce({ restoredCount: 2, failedCount: 1, shown: false });
    renderHook(() => useRecoveryNotice());

    await waitFor(() => expect(recovery.takeRecoveryNotice).toHaveBeenCalledOnce());
    emit({ 'sessionContinuity.recoveryNotice': { newValue: {} } });
    expect(recovery.takeRecoveryNotice).toHaveBeenCalledOnce();
    releaseInitialRead?.();

    await waitFor(() => expect(recovery.takeRecoveryNotice).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.objectContaining({
      content: '已恢复 2 个标签页，1 个未恢复',
      action: expect.objectContaining({ label: '重试' }),
    })));
    expect(toast.warning).toHaveBeenCalledOnce();
  });

  it('Home 已挂载后收到 recovery notice 变化：消费并显示一次，卸载时移除 listener', async () => {
    const { onChanged, emit } = setupStorageEvents();
    recovery.takeRecoveryNotice
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ restoredCount: 2, failedCount: 1, shown: false });
    const { unmount } = renderHook(() => useRecoveryNotice());

    await waitFor(() => expect(recovery.takeRecoveryNotice).toHaveBeenCalledOnce());
    emit({ 'sessionContinuity.recoveryNotice': { newValue: {} } });

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.objectContaining({
      content: '已恢复 2 个标签页，1 个未恢复',
      action: expect.objectContaining({ label: '重试' }),
    })));
    expect(toast.warning).toHaveBeenCalledOnce();
    const input = toast.warning.mock.calls[0]![0] as { action: { onClick: () => void } };
    input.action.onClick();
    await waitFor(() => expect(recovery.retryPendingRecovery).toHaveBeenCalledOnce());
    expect(onChanged.addListener).toHaveBeenCalledOnce();
    unmount();
    expect(onChanged.removeListener).toHaveBeenCalledOnce();
  });

  it('notice 已消费或不存在：不重复显示', async () => {
    recovery.takeRecoveryNotice.mockResolvedValue(null);
    renderHook(() => useRecoveryNotice());

    await Promise.resolve();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
