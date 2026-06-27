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
// Sidebar 不再直接读 useCrypto（主密码移入 SettingsModal/PasswordSection），
// 但 SettingsModal 渲染会拉 PasswordSection → 需可控 useCrypto + mock ChangePasswordModal。
const { cryptoState } = vi.hoisted(() => ({
  cryptoState: {
    passwordSet: false,
    unlocked: false,
    openUnlockModal: vi.fn(),
    lockSession: vi.fn(),
  } as Record<string, unknown>,
}));
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (sel: (s: Record<string, unknown>) => unknown) => sel(cryptoState),
}));
vi.mock('@/newtab/components/ChangePasswordModal', () => ({
  ChangePasswordModal: ({ visible }: { visible: boolean }) =>
    visible ? ('修改主密码弹窗' as any) : (null as any),
}));
// 备份分区复用 Local/CloudBackupSection，拉入 cloud 依赖，jsdom 下需 mock
vi.mock('@/services/cloud/providers', () => ({
  getCloudProvider: (id: string) => ({
    id,
    label: id === 'oss' ? '阿里云 OSS' : '腾讯云 COS',
    configFields: [{ name: 'region', label: 'Region', type: 'text' as const, required: true }],
  }),
}));
vi.mock('@/services/CloudStorageService', () => ({
  getLastBackupAt: () => Promise.resolve(null),
}));
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  // ShortcutsSection 读 chrome.commands.getAll
  (globalThis as any).chrome = {
    commands: { getAll: vi.fn(async () => [] as any[]) },
    tabs: { create: vi.fn(async () => undefined) },
  };
});

describe('Sidebar 设置入口（统一设置中心）', () => {
  it('渲染「设置」按钮', () => {
    render(<Sidebar />);
    expect(screen.getByRole('button', { name: /设置/ })).toBeTruthy();
  });

  it('点击「设置」→ 弹出系统设置 Modal（标题「系统设置」可见）', async () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: /设置/ }));
    expect(await screen.findByText('系统设置')).toBeTruthy();
  });
});
