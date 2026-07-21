import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toast } from '@/components/ui/toast';

// 副作用边界 mock:service(DB) + favicon hook(DB) + Toast
vi.mock('@/services/PinnedTabService', () => ({
  listByWorkspace: vi.fn(async () => [] as never[]),
  createPinnedTab: vi.fn(async (_ws: string, data: { name: string; url: string }) =>
    ({ id: 'new-pin', workspaceId: _ws, name: data.name, url: data.url, order: 99, createdAt: 0 } as never),
  ),
  deletePinnedTab: vi.fn(async () => undefined),
  reorderPinnedTabs: vi.fn(async () => undefined),
  normalizePinnedTabUrl: vi.fn((raw: string) => raw),
  PINNED_TAB_CAP: 8,
}));
vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => ({ kind: 'third-party', src: 'blob:test', onError: vi.fn() })),
}));
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), close: vi.fn() },
}));

import { AddPinnedTabDialog } from '../index';
import * as PinnedTabService from '@/services/PinnedTabService';
import { usePinnedTabs } from '@/store/usePinnedTabs';

beforeEach(() => {
  vi.clearAllMocks();
  usePinnedTabs.setState({ pinnedTabs: [], loading: false });
});

describe('AddPinnedTabDialog', () => {
  it('open=true 且传 initialUrl/initialName → 输入框预填', () => {
    render(
      <AddPinnedTabDialog
        open onOpenChange={() => {}} workspaceId="ws-1"
        initialUrl="https://github.com" initialName="GitHub"
      />,
    );
    expect(screen.getByPlaceholderText(/url|链接/i)).toHaveValue('https://github.com');
    expect(screen.getByPlaceholderText(/名称/)).toHaveValue('GitHub');
  });

  it('填表点确定 → createPinnedTab(workspaceId, {name,url}) + Toast.success', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AddPinnedTabDialog
        open onOpenChange={onOpenChange} workspaceId="ws-1"
        initialUrl="https://chat.openai.com" initialName="ChatGPT" onCreated={onCreated}
      />,
    );
    await user.click(screen.getByRole('button', { name: /确定/i }));

    await waitFor(() => {
      expect(PinnedTabService.createPinnedTab).toHaveBeenCalledWith('ws-1', {
        name: 'ChatGPT', url: 'https://chat.openai.com',
      });
    });
    expect(Toast.success).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('createPinnedTab 失败 → Toast.warning 且不关闭', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    vi.mocked(PinnedTabService.createPinnedTab).mockRejectedValueOnce(new Error('该 URL 已是该工作区的常驻标签'));
    render(
      <AddPinnedTabDialog
        open onOpenChange={onOpenChange} workspaceId="ws-1"
        initialUrl="https://x.com" initialName="X"
      />,
    );
    await user.click(screen.getByRole('button', { name: /确定/i }));

    await waitFor(() => expect(Toast.warning).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('atCap(pinnedTabs.length>=8) → 确定按钮 disabled', () => {
    usePinnedTabs.setState({
      pinnedTabs: Array.from({ length: 8 }, (_, i) =>
        ({ id: `p${i}`, workspaceId: 'ws-1', name: `T${i}`, url: `https://t${i}.com`, order: i, createdAt: 0 })),
      loading: false,
    });
    render(<AddPinnedTabDialog open onOpenChange={() => {}} workspaceId="ws-1" />);
    expect(screen.getByRole('button', { name: /确定/i })).toBeDisabled();
  });

  it('open 由 false→true → 用最新 initialUrl/initialName 重置(防上次残留)', async () => {
    const { rerender } = render(
      <AddPinnedTabDialog open={false} onOpenChange={() => {}} workspaceId="ws-1"
        initialUrl="https://a.com" initialName="A" />,
    );
    // 打开时换成 B:输入框应为 B 而非 A
    rerender(
      <AddPinnedTabDialog open onOpenChange={() => {}} workspaceId="ws-1"
        initialUrl="https://b.com" initialName="B" />,
    );
    // 预填靠 useEffect([open]);effect 异步,用 waitFor 等待重置生效
    await waitFor(() => expect(screen.getByPlaceholderText(/url|链接/i)).toHaveValue('https://b.com'));
    expect(screen.getByPlaceholderText(/名称/)).toHaveValue('B');
  });
});
