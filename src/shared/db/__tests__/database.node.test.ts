// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

describe('database 模块在 Node 工具链环境', () => {
  it('不创建会阻止 WXT build 退出的 BroadcastChannel', async () => {
    vi.resetModules();
    const BroadcastChannelMock = vi.fn(function BroadcastChannelMock() {});
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock);
    vi.stubGlobal('chrome', undefined);

    await import('@/shared/db/database');

    expect(BroadcastChannelMock).not.toHaveBeenCalled();
  });
});
