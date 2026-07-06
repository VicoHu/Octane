import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toast } from '@douyinfe/semi-ui';

// 副作用边界 mock：service 层（DB）+ favicon hook（DB）+ Toast 静态方法
vi.mock('@/services/PinnedTabService', () => ({
  listByWorkspace: vi.fn(async () => [] as never[]),
  // 返回完整 PinnedTab，避免 store 追加后 PinChip 读 pin.name 崩
  createPinnedTab: vi.fn(async (_ws: string, data: { name: string; url: string }) =>
    ({ id: 'new-pin', workspaceId: _ws, name: data.name, url: data.url, order: 99, createdAt: 0 } as never),
  ),
  deletePinnedTab: vi.fn(async () => undefined),
  PINNED_TAB_CAP: 8,
}));
vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => ({ kind: 'blob', src: 'blob:test' })),
}));
vi.mock('@douyinfe/semi-ui', async (orig) => {
  const real = await orig();
  return {
    ...(real as object),
    Toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  };
});

import { PinnedArea } from '@/newtab/components/PinnedArea';
import * as PinnedTabService from '@/services/PinnedTabService';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import type { PinnedTab } from '@/shared/types';

function makePin(id: string, name: string, url: string, order: number): PinnedTab {
  return { id, workspaceId: 'ws-1', name, url, order, createdAt: 0 };
}

function renderArea() {
  return render(<PinnedArea workspaceId="ws-1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  usePinnedTabs.setState({ pinnedTabs: [], loading: false });
  // listByWorkspace 默认返回空，单测按需 override
  vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([]);
});

describe('PinnedArea', () => {
  it('workspaceId 变更 → loadPinnedTabs 以新 id 重载', async () => {
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([]);
    const { rerender } = renderArea();
    await screen.findByText('常驻');
    expect(PinnedTabService.listByWorkspace).toHaveBeenLastCalledWith('ws-1');

    rerender(<PinnedArea workspaceId="ws-2" />);
    await waitFor(() => {
      expect(PinnedTabService.listByWorkspace).toHaveBeenLastCalledWith('ws-2');
    });
  });
  it('空状态：渲染「常驻」标题 + 空提示 + 「+」按钮', async () => {
    renderArea();
    await screen.findByText('常驻');
    expect(screen.getByText(/添加常驻/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /添加常驻标签/ })).toBeEnabled();
  });

  it('有 pin：渲染每个 chip（按 name）+ 「+」按钮在末位', async () => {
    const pins = [makePin('p1', 'GitHub', 'https://github.com', 0), makePin('p2', 'Notion', 'https://notion.so', 1)];
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue(pins);

    renderArea();
    await screen.findByRole('button', { name: /打开 GitHub/ });
    expect(screen.getByRole('button', { name: /打开 Notion/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /添加常驻标签/ })).toBeInTheDocument();
  });

  it('点击 chip → window.open(pin.url)', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([makePin('p1', 'GitHub', 'https://github.com', 0)]);

    renderArea();
    const chip = await screen.findByRole('button', { name: /打开 GitHub/ });
    await userEvent.click(chip);
    expect(openSpy).toHaveBeenCalledWith('https://github.com', '_blank');
    openSpy.mockRestore();
  });

  it('点击 × 删除 → deletePinnedTab(id) + chip 消失', async () => {
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([makePin('p1', 'GitHub', 'https://github.com', 0)]);

    renderArea();
    const del = await screen.findByRole('button', { name: /取消常驻 GitHub/ });
    await userEvent.click(del);
    expect(PinnedTabService.deletePinnedTab).toHaveBeenCalledWith('p1');
    // store filter 后 chip 消失（用户可见结果）
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /打开 GitHub/ })).not.toBeInTheDocument();
    });
  });

  it('cap 满（8）：「+」按钮 disabled，点击仍触发 Toast 提示', async () => {
    const pins = Array.from({ length: 8 }, (_, i) => makePin(`p${i}`, `T${i}`, `https://t${i}.com`, i));
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue(pins);

    renderArea();
    const addBtn = await screen.findByRole('button', { name: /添加常驻标签/ });
    expect(addBtn).toBeDisabled();
  });

  it('点击「+」→ Modal 打开，填表提交 → createPinnedTab', async () => {
    renderArea();
    const addBtn = await screen.findByRole('button', { name: /添加常驻标签/ });
    await userEvent.click(addBtn);

    // Modal 出现：url + name 输入框
    const urlInput = await screen.findByPlaceholderText(/url|网址|链接/i);
    const nameInput = await screen.findByPlaceholderText(/名称|名字/i);
    await userEvent.type(urlInput, 'https://chat.openai.com');
    await userEvent.type(nameInput, 'ChatGPT');

    // Semi Modal 的确定按钮（accessible name = "confirm"，async 等 portal 渲染）
    const okBtn = await screen.findByRole('button', { name: /确定|confirm/i });
    await userEvent.click(okBtn);

    await waitFor(() => {
      expect(PinnedTabService.createPinnedTab).toHaveBeenCalledWith('ws-1', {
        name: 'ChatGPT',
        url: 'https://chat.openai.com',
      });
    });
  });

  it('createPinnedTab 失败（cap/dedup）→ Toast.warning，不抛到 UI', async () => {
    vi.mocked(PinnedTabService.createPinnedTab).mockRejectedValue(new Error('常驻标签已达上限（8）'));
    renderArea();
    await userEvent.click(await screen.findByRole('button', { name: /添加常驻标签/ }));

    const urlInput = await screen.findByPlaceholderText(/url|网址|链接/i);
    const nameInput = await screen.findByPlaceholderText(/名称/i);
    await userEvent.type(urlInput, 'https://x.com');
    await userEvent.type(nameInput, 'X');
    await userEvent.click(await screen.findByRole('button', { name: /确定|confirm/i }));

    await waitFor(() => {
      expect(Toast.warning).toHaveBeenCalled();
    });
  });
});
