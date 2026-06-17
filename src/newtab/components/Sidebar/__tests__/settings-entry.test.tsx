import { describe, it, expect, vi, beforeEach } from 'vitest';
// Semi 加载动画依赖 lottie-web；jsdom 无 canvas，mock 掉
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
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '@/newtab/components/Sidebar';
import { useWorkspace } from '@/store/useWorkspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaces: [],
    categories: [],
    currentWorkspaceId: null,
    currentCategoryId: null,
  });
});

describe('Sidebar 设置入口（newtab 备份功能可达性）', () => {
  it('渲染「设置」按钮', () => {
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /设置/ })).toBeTruthy();
  });

  it('点击「设置」→ Drawer 显示备份区（导出/导入）', async () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: /设置/ }));
    expect(await screen.findByText('导出数据')).toBeTruthy();
    expect(await screen.findByText('导入数据')).toBeTruthy();
  });
});
