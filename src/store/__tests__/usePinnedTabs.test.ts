import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PinnedTab } from '@/shared/types';

// 打桩 service 层：仅验证 store 状态机，不触真实 IndexedDB
vi.mock('@/services/PinnedTabService', () => ({
  listByWorkspace: vi.fn(async () => [] as PinnedTab[]),
  createPinnedTab: vi.fn(async (_ws: string, data: { name: string; url: string }) =>
    makePin('new-1', _ws, data.name, data.url, 0),
  ),
  deletePinnedTab: vi.fn(async () => undefined),
  PINNED_TAB_CAP: 8,
}));

import { usePinnedTabs } from '../usePinnedTabs';
import * as PinnedTabService from '@/services/PinnedTabService';

function makePin(id: string, workspaceId: string, name: string, url: string, order: number): PinnedTab {
  return { id, workspaceId, name, url, order, createdAt: 0 };
}

describe('usePinnedTabs', () => {
  beforeEach(() => {
    usePinnedTabs.setState({ pinnedTabs: [], loading: false });
    vi.clearAllMocks();
  });

  it('loadPinnedTabs 调用 listByWorkspace 并按序填充 pinnedTabs', async () => {
    const pins = [
      makePin('a', 'ws-1', 'A', 'https://a.com', 0),
      makePin('b', 'ws-1', 'B', 'https://b.com', 1),
    ];
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue(pins);

    await usePinnedTabs.getState().loadPinnedTabs('ws-1');

    expect(PinnedTabService.listByWorkspace).toHaveBeenCalledWith('ws-1');
    expect(usePinnedTabs.getState().pinnedTabs).toEqual(pins);
    expect(usePinnedTabs.getState().loading).toBe(false);
  });

  it('loadPinnedTabs 期间 loading=true（加载前置状态）', async () => {
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([]);
    expect(usePinnedTabs.getState().loading).toBe(false);
    const p = usePinnedTabs.getState().loadPinnedTabs('ws-1');
    expect(usePinnedTabs.getState().loading).toBe(true);
    await p;
    expect(usePinnedTabs.getState().loading).toBe(false);
  });

  it('loadPinnedTabs 失败时 loading 复位为 false（不卡永久 spinner）', async () => {
    vi.mocked(PinnedTabService.listByWorkspace).mockRejectedValue(new Error('DB down'));
    await expect(usePinnedTabs.getState().loadPinnedTabs('ws-1')).rejects.toThrow('DB down');
    expect(usePinnedTabs.getState().loading).toBe(false);
  });

  it('createPinnedTab 调用 service 并追加到切片', async () => {
    usePinnedTabs.setState({ pinnedTabs: [makePin('a', 'ws-1', 'A', 'https://a.com', 0)] });
    const created = makePin('b', 'ws-1', 'B', 'https://b.com', 1);
    vi.mocked(PinnedTabService.createPinnedTab).mockResolvedValue(created);

    const result = await usePinnedTabs.getState().createPinnedTab('ws-1', { name: 'B', url: 'https://b.com' });

    expect(PinnedTabService.createPinnedTab).toHaveBeenCalledWith('ws-1', { name: 'B', url: 'https://b.com' });
    expect(result).toEqual(created);
    expect(usePinnedTabs.getState().pinnedTabs).toHaveLength(2);
    expect(usePinnedTabs.getState().pinnedTabs[1]).toEqual(created);
  });

  it('createPinnedTab 失败时切片不变（cap/dedup 错误向上抛，UI 层 Toast）', async () => {
    const before = [makePin('a', 'ws-1', 'A', 'https://a.com', 0)];
    usePinnedTabs.setState({ pinnedTabs: before });
    vi.mocked(PinnedTabService.createPinnedTab).mockRejectedValue(new Error('常驻标签已达上限'));

    await expect(
      usePinnedTabs.getState().createPinnedTab('ws-1', { name: 'B', url: 'https://b.com' }),
    ).rejects.toThrow('常驻标签已达上限');
    expect(usePinnedTabs.getState().pinnedTabs).toEqual(before);
  });

  it('deletePinnedTab 调用 service 并从切片移除', async () => {
    usePinnedTabs.setState({
      pinnedTabs: [
        makePin('a', 'ws-1', 'A', 'https://a.com', 0),
        makePin('b', 'ws-1', 'B', 'https://b.com', 1),
      ],
    });

    await usePinnedTabs.getState().deletePinnedTab('a');

    expect(PinnedTabService.deletePinnedTab).toHaveBeenCalledWith('a');
    expect(usePinnedTabs.getState().pinnedTabs.map((p) => p.id)).toEqual(['b']);
  });

  it('deletePinnedTab 失败时切片不变（service 抛错向上抛，UI 层 Toast）', async () => {
    const before = [makePin('a', 'ws-1', 'A', 'https://a.com', 0)];
    usePinnedTabs.setState({ pinnedTabs: before });
    vi.mocked(PinnedTabService.deletePinnedTab).mockRejectedValue(new Error('删除失败'));

    await expect(usePinnedTabs.getState().deletePinnedTab('a')).rejects.toThrow('删除失败');
    expect(usePinnedTabs.getState().pinnedTabs).toEqual(before);
  });
});
