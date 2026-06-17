import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { IMPORT_CHANNEL_NAME } from '@/shared/db/database';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useCrypto } from '@/store/useCrypto';

// 隔离渲染：子组件（含 lottie/canvas 等重依赖）不影响订阅逻辑，全部 mock 掉
vi.mock('@/newtab/components/Sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/newtab/components/Content', () => ({ Content: () => null }));
vi.mock('@/newtab/components/UnlockModal', () => ({ UnlockModal: () => null }));

// 最小化验证：导入事件 → loadWorkspaces 被再次调用
describe('newtab import reload', () => {
  it('收到 octane-import 事件 → 触发 loadWorkspaces reload', async () => {
    // 直接替换 zustand store 内的 action 为 spy（hook 读取实时 store state）
    const loadSpy = vi.fn().mockResolvedValue(undefined);
    useWorkspace.setState({ loadWorkspaces: loadSpy });
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
});
