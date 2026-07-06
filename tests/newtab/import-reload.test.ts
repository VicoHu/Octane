import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { IMPORT_CHANNEL_NAME } from '@/shared/db/database';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useCrypto } from '@/store/useCrypto';

// 隔离渲染：子组件（含 lottie/canvas 等重依赖）不影响订阅逻辑，全部 mock 掉
vi.mock('@/newtab/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/newtab/components/Content', () => ({ Content: () => null }));
vi.mock('@/components/UnlockModal', () => ({ UnlockModal: () => null }));

// 还原 store：避免 spy 跨用例污染（与 I1 新增 loadBookmarks 兜底共用）
afterEach(() => {
  vi.restoreAllMocks();
});

describe('newtab import reload', () => {
  it('收到 octane-import 事件 → 触发 loadWorkspaces reload', async () => {
    // 直接替换 zustand store 内的 action 为 spy（hook 读取实时 store state）
    const loadSpy = vi.fn().mockResolvedValue(undefined);
    useWorkspace.setState({
      loadWorkspaces: loadSpy,
      currentCategoryId: 'cat-1',
    });
    useBookmarks.setState({ loadBookmarks: vi.fn() });
    useCrypto.setState({ checkStatus: vi.fn() });

    const { default: App } = await import('@/newtab/App');
    render(React.createElement(App));

    // 初始挂载已调一次 loadWorkspaces；清空后发 import 事件
    loadSpy.mockClear();
    const ch = new BroadcastChannel(IMPORT_CHANNEL_NAME);
    ch.postMessage({ type: 'imported' });
    // postMessage 非同步派发，先 flush 再 close，避免消息丢失（与 database.test.ts 范式一致）
    await new Promise((resolve) => setTimeout(resolve, 10));
    ch.close();
    await waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));
  });

  it('自备份自恢复场景：currentCategoryId 不变 → 仍兜底调用 loadBookmarks', async () => {
    // 复现 I1 缺陷：loadWorkspaces 内部把 currentCategoryId 重置为 categories[0]?.id，
    // 自备份场景下该值与导入前相同 → useEffect([currentCategoryId]) 不触发。
    // 验证 import 回调里的手动 loadBookmarks 兜底分支生效。
    const loadWsSpy = vi.fn().mockImplementation(async () => {
      // 模拟 loadWorkspaces 内部的 setState（保持 ID 不变）
      useWorkspace.setState({ currentCategoryId: 'cat-same' });
    });
    const loadBmSpy = vi.fn().mockResolvedValue(undefined);
    useWorkspace.setState({
      loadWorkspaces: loadWsSpy,
      currentCategoryId: 'cat-same', // 导入前后同值 → useEffect 不应触发
    });
    useBookmarks.setState({ loadBookmarks: loadBmSpy });
    useCrypto.setState({ checkStatus: vi.fn() });

    const { default: App } = await import('@/newtab/App');
    render(React.createElement(App));

    // 初始挂载会调一次 loadBookmarks（来自 useEffect([currentCategoryId])）；清空后发 import
    loadBmSpy.mockClear();
    const ch = new BroadcastChannel(IMPORT_CHANNEL_NAME);
    ch.postMessage({ type: 'imported' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    ch.close();
    // 兜底分支：loadBookmarks 应被再次调用，参数为 currentCategoryId
    await waitFor(() => expect(loadBmSpy).toHaveBeenCalledTimes(1));
    expect(loadBmSpy).toHaveBeenCalledWith('cat-same');
  });
});
