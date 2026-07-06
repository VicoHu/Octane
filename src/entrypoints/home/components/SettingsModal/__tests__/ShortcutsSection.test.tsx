import { describe, it, expect, vi, beforeEach } from 'vitest';
// Semi 加载动画依赖 lottie-web；jsdom 无 canvas，mock 掉（参考 settings-entry.test.tsx）
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutsSection } from '../sections/ShortcutsSection';

describe('ShortcutsSection（快捷键只读展示）', () => {
  let chromeMock: any;
  beforeEach(() => {
    vi.restoreAllMocks();
    chromeMock = {
      commands: { getAll: vi.fn(async () => [] as any[]) },
      tabs: { create: vi.fn(async () => undefined) },
    };
    (globalThis as any).chrome = chromeMock;
  });

  it('命令已设 → 渲染描述 + 拆分按键', async () => {
    chromeMock.commands.getAll.mockResolvedValue([
      { name: 'open-home', description: '打开首页', shortcut: 'Alt+Shift+H' },
      { name: '_execute_side_panel_action', description: '打开侧边栏', shortcut: 'Alt+Shift+S' },
    ]);
    render(<ShortcutsSection />);
    expect(await screen.findByText('打开首页')).toBeTruthy();
    expect(screen.getByText('打开侧边栏')).toBeTruthy();
    // 两命令都含 Alt+Shift → 各渲染一个 Alt；H/S 各自唯一
    expect(screen.getAllByText('Alt')).toHaveLength(2);
    expect(screen.getByText('H')).toBeTruthy();
    expect(screen.getByText('S')).toBeTruthy();
  });

  it('shortcut 未设 → 显示「未设置」', async () => {
    chromeMock.commands.getAll.mockResolvedValue([
      { name: '_execute_side_panel_action', description: '打开侧边栏', shortcut: '' },
    ]);
    render(<ShortcutsSection />);
    expect(await screen.findByText('未设置')).toBeTruthy();
  });

  it('点击「前往自定义」→ chrome.tabs.create 打开 shortcuts 页', async () => {
    chromeMock.commands.getAll.mockResolvedValue([
      { name: 'open-home', description: '打开首页', shortcut: 'Alt+Shift+H' },
    ]);
    render(<ShortcutsSection />);
    const btn = await screen.findByRole('button', { name: /前往自定义/ });
    fireEvent.click(btn);
    expect(chromeMock.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'chrome://extensions/shortcuts' }),
    );
  });
});
