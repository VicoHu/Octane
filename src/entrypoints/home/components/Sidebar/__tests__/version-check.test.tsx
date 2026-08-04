import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CWS_EXTENSION_ID, UPDATE_URL } from '@/shared/distribution';
import { Toast } from '@/components/ui/toast';
import { useWorkspace } from '@/store/useWorkspace';

vi.mock('@/components/ui/toast', () => ({
  Toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('../../PinnedArea', () => ({ PinnedArea: () => null }));
vi.mock('../../ManagePanel', () => ({ ManagePanel: () => null }));
vi.mock('../../SettingsModal', () => ({ SettingsModal: () => null }));

import { Sidebar } from '../../Sidebar';

function setupChrome(id: string) {
  const requestUpdateCheck = vi.fn().mockResolvedValue({ status: 'no_update' });
  const tabsCreate = vi.fn();
  const store: Record<string, unknown> = {};
  const listeners = new Set<(changes: unknown, area: string) => void>();
  (globalThis as { chrome?: Record<string, unknown> }).chrome = {
    runtime: {
      id,
      getManifest: () => ({ version: '0.1.13.0' }),
      requestUpdateCheck,
    },
    tabs: { create: tabsCreate },
    storage: {
      onChanged: {
        addListener: vi.fn((listener: (changes: unknown, area: string) => void) => listeners.add(listener)),
        removeListener: vi.fn((listener: (changes: unknown, area: string) => void) => listeners.delete(listener)),
      },
      local: {
        get: vi.fn(async (keys: string[]) => {
          const result: Record<string, unknown> = {};
          for (const key of keys) if (key in store) result[key] = store[key];
          return result;
        }),
        remove: vi.fn(),
      },
    },
  };
  const triggerPendingUpdate = (version: string) => {
    store.pendingUpdate = { version };
    for (const listener of listeners) listener({ pendingUpdate: { newValue: { version } } }, 'local');
  };
  return { requestUpdateCheck, tabsCreate, triggerPendingUpdate };
}

beforeEach(() => {
  useWorkspace.setState({
    workspaces: [],
    categories: [],
    currentWorkspaceId: null,
    currentCategoryId: null,
  });
  vi.clearAllMocks();
});

describe('Sidebar 版本检测入口', () => {
  it('商店渠道点击版本号后显示 loading，并在五秒后提示已是最新版本', async () => {
    const user = userEvent.setup();
    const { requestUpdateCheck } = setupChrome(CWS_EXTENSION_ID);
    render(<Sidebar openTabs={[]} />);

    await user.click(screen.getByRole('button', { name: /检测更新/ }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(requestUpdateCheck).toHaveBeenCalledOnce();

    await waitFor(
      () => expect(Toast.info).toHaveBeenCalledWith('已是最新版本'),
      { timeout: 6_000 },
    );
  });

  it('商店渠道收到待装版本后提示发现新版本', async () => {
    const user = userEvent.setup();
    const { triggerPendingUpdate } = setupChrome(CWS_EXTENSION_ID);
    render(<Sidebar openTabs={[]} />);

    await user.click(screen.getByRole('button', { name: /检测更新/ }));
    triggerPendingUpdate('0.1.14.0');

    await waitFor(
      () => expect(Toast.info).toHaveBeenCalledWith('发现新版本 v0.1.14.0'),
      { timeout: 6_000 },
    );
  });

  it('manual 渠道点击版本号显示 Releases 引导且不请求商店检查', async () => {
    const user = userEvent.setup();
    const { requestUpdateCheck, tabsCreate } = setupChrome('manual-extension-id');
    render(<Sidebar openTabs={[]} />);

    await user.click(screen.getByRole('button', { name: /检测更新/ }));

    expect(requestUpdateCheck).not.toHaveBeenCalled();
    expect(Toast.info).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('GitHub Releases'),
    }));
    const toastInput = vi.mocked(Toast.info).mock.calls[0]![0] as {
      action: { onClick: () => void };
    };
    toastInput.action.onClick();
    expect(tabsCreate).toHaveBeenCalledWith({ url: UPDATE_URL.manual });
  });
});
