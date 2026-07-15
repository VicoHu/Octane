import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toast } from '@/components/ui/toast';

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
  useFavicon: vi.fn(() => ({ kind: 'third-party', src: 'blob:test', onError: vi.fn() })),
}));
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), close: vi.fn() },
}));

import { PinnedArea } from '../../PinnedArea';
import * as PinnedTabService from '@/services/PinnedTabService';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { useFavicon } from '@/hooks/useFavicon';
import type { PinnedTab } from '@/shared/types';
import type { OpenTab } from '../../../hooks/useOpenTabs';

function makePin(id: string, name: string, url: string, order: number): PinnedTab {
  return { id, workspaceId: 'ws-1', name, url, order, createdAt: 0 };
}

function renderArea(openTabs: OpenTab[] = []) {
  return render(<PinnedArea workspaceId="ws-1" openTabs={openTabs} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useFavicon).mockReturnValue({ kind: 'third-party', src: 'blob:test', onError: vi.fn() });
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

    rerender(<PinnedArea workspaceId="ws-2" openTabs={[]} />);
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


  it('favicon 加载失败交给 hook，hook 返回 null 后显示首字母', async () => {
    const onError = vi.fn();
    vi.mocked(useFavicon).mockReturnValue({ kind: 'tab', src: 'runtime-icon', onError });
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([
      makePin('p1', 'GitHub', 'https://github.com', 0),
    ]);

    const view = renderArea();
    const chip = await screen.findByRole('button', { name: /打开 GitHub/ });
    fireEvent.error(chip.querySelector('img')!);
    expect(onError).toHaveBeenCalledTimes(1);

    vi.mocked(useFavicon).mockReturnValue(null);
    view.rerender(<PinnedArea workspaceId="ws-1" openTabs={[]} />);
    expect(screen.getByText('G')).toBeInTheDocument();
  });


  it('匹配打开 Tab 后把 runtime favicon 传给 PinChip hook', async () => {
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([
      makePin('p1', 'GitHub', 'https://github.com', 0),
    ]);
    renderArea([{
      url: 'https://github.com/settings', tabId: 9, lastAccessed: 200,
      favIconUrl: 'https://github.com/runtime.svg',
    }]);

    await screen.findByRole('button', { name: /打开 GitHub/ });
    expect(useFavicon).toHaveBeenCalledWith(
      'https://github.com',
      'https://github.com/runtime.svg',
    );
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

describe('PinnedArea chip 拖拽(T7)', () => {
  const gripButtons = () =>
    screen.getAllByRole('button').filter((b) => b.getAttribute('aria-roledescription') === '可拖拽项');

  it('>1 chip:每 chip 渲染 grip 手柄', async () => {
    const pins = [makePin('p1', 'GitHub', 'https://github.com', 0), makePin('p2', 'Notion', 'https://notion.so', 1)];
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue(pins);
    renderArea();
    await screen.findByRole('button', { name: /打开 GitHub/ });
    expect(gripButtons()).toHaveLength(2);
  });

  it('≤1 chip:不渲染 grip(纯 PinChip 无 Sortable)', async () => {
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([makePin('p1', 'GitHub', 'https://github.com', 0)]);
    renderArea();
    await screen.findByRole('button', { name: /打开 GitHub/ });
    expect(gripButtons()).toHaveLength(0);
  });

  it('IconClose × 带 data-no-dnd(防拖拽冒泡)', async () => {
    const pins = [makePin('p1', 'GitHub', 'https://github.com', 0), makePin('p2', 'Notion', 'https://notion.so', 1)];
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue(pins);
    renderArea();
    await screen.findByRole('button', { name: /打开 GitHub/ });
    const del = screen.getByRole('button', { name: /取消常驻 GitHub/ });
    expect(del.hasAttribute('data-no-dnd')).toBe(true);
  });
});
