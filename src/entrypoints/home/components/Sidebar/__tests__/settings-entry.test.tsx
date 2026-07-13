import { describe, it, expect, vi, beforeEach } from 'vitest';
// lottie-web 由 vitest.config.ts 全局 alias 处理（见 docs/standards/testing.md §4.4.1），无需 vi.mock
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
vi.mock('../../ChangePasswordModal', () => ({
  ChangePasswordModal: ({ visible }: { visible: boolean }) =>
    visible ? ('修改主密码弹窗' as any) : (null as any),
}));
// 备份分区复用 Local/CloudBackupSection，拉入 cloud 依赖，jsdom 下需 mock
vi.mock('@/services/cloud/providers', () => {
  const providers = {
    s3: { id: 's3', label: 'S3', configFields: [{ name: 'region', label: 'Region', type: 'text' as const, required: true }] },
    webdav: { id: 'webdav', label: 'WebDAV', configFields: [{ name: 'username', label: '账号', type: 'text' as const, required: true }] },
  };
  return {
    cloudProviders: providers,
    getCloudProvider: (id: 's3' | 'webdav') => providers[id],
  };
});
vi.mock('@/services/CloudStorageService', () => ({
  getLastBackupAt: () => Promise.resolve(null),
}));
// PinnedArea 子组件有专属测试；这里 mock 掉避免触发 IndexedDB（本测试无 fake-indexeddb）
vi.mock('../../PinnedArea', () => ({ PinnedArea: () => null }));
/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../../Sidebar';
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
    render(<Sidebar openTabs={[]} />);
    expect(screen.getByRole('button', { name: /设置/ })).toBeTruthy();
  });

  it('点击「设置」→ 弹出系统设置 Modal（标题「系统设置」可见）', async () => {
    render(<Sidebar openTabs={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /设置/ }));
    expect(await screen.findByText('系统设置')).toBeTruthy();
  });
});
