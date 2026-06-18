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
// Sidebar 现读 useCrypto（主密码项自适应）；默认未设置、未解锁
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ passwordSet: false, unlocked: false, openUnlockModal: vi.fn(), lockSession: vi.fn() }),
}));
// CloudBackupSection 拉入 cloud 依赖，jsdom 下需 mock
vi.mock('@/services/cloud/providers', () => ({
  getCloudProvider: (id: string) => ({
    id,
    label: id === 'oss' ? '阿里云 OSS' : '腾讯云 COS',
    configFields: [{ name: 'region', label: 'Region', type: 'text' as const, required: true }],
  }),
}));
vi.mock('@/services/CloudStorageService', () => ({ getLastBackupAt: () => Promise.resolve(null) }));

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

describe('Sidebar 设置入口（前置选项）', () => {
  it('渲染「设置」按钮', () => {
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /设置/ })).toBeTruthy();
  });

  it('点击「设置」→ 展开前置菜单（设置主密码 / 数据备份和同步）', async () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: /设置/ }));
    expect(await screen.findByText('设置主密码')).toBeTruthy();
    expect(screen.getByText('数据备份和同步')).toBeTruthy();
  });

  it('点击「数据备份和同步」→ 抽屉显示备份区（导出/导入）', async () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: /设置/ }));
    fireEvent.click(await screen.findByText('数据备份和同步'));
    expect(await screen.findByText('导出数据')).toBeTruthy();
    expect(await screen.findByText('导入数据')).toBeTruthy();
  });
});
