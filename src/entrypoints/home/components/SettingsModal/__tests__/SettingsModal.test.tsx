import { describe, it, expect, vi, beforeEach } from 'vitest';
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
// 主密码分区依赖：可控 useCrypto + mock ChangePasswordModal（避免 CryptoService 链）
const { cryptoState } = vi.hoisted(() => ({
  cryptoState: {
    passwordSet: false,
    unlocked: false,
    openUnlockModal: () => {},
    lockSession: () => {},
  } as Record<string, unknown>,
}));
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (sel: (s: Record<string, unknown>) => unknown) => sel(cryptoState),
}));
vi.mock('../../ChangePasswordModal', () => ({
  ChangePasswordModal: ({ visible }: { visible: boolean }) =>
    visible ? ('修改主密码弹窗' as any) : (null as any),
}));
/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from '../index';

describe('SettingsModal（系统设置中心）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).chrome = {
      commands: {
        getAll: vi.fn(async () => [
          { name: 'open-home', description: '打开首页', shortcut: 'Alt+Shift+H' },
        ]),
      },
      tabs: { create: vi.fn(async () => undefined) },
    };
  });

  it('渲染「系统设置」标题 + 三 menu 项', () => {
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    expect(screen.getByText('系统设置')).toBeTruthy();
    expect(screen.getByText('快捷键')).toBeTruthy();
    expect(screen.getByText('数据备份和同步')).toBeTruthy();
    expect(screen.getByText('主密码')).toBeTruthy();
  });

  it('默认显示快捷键分区（「前往自定义」按钮可见）', async () => {
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    expect(await screen.findByRole('button', { name: /前往自定义/ })).toBeTruthy();
  });

  it('点击「数据备份和同步」→ 显示备份区（导出/导入）', async () => {
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    // 等快捷键分区渲染完（getAll 异步）
    await screen.findByRole('button', { name: /前往自定义/ });
    fireEvent.click(screen.getByText('数据备份和同步'));
    expect(await screen.findByText('导出数据')).toBeTruthy();
  });

  it('点击「主密码」→ 切换到主密码分区', async () => {
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    await screen.findByRole('button', { name: /前往自定义/ });
    fireEvent.click(screen.getByText('主密码'));
    // PasswordSection 默认未设 → 「设置主密码」按钮（验证主密码分区已接入）
    expect(screen.getByRole('button', { name: '设置主密码' })).toBeTruthy();
  });
});
