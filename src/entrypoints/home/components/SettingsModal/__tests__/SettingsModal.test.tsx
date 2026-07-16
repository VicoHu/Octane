import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
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

  it('打开弹窗 → 显示设置说明、四个分类和默认分区标题', async () => {
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    await screen.findByRole('button', { name: /前往自定义/ });

    expect(screen.getByRole('heading', { name: '系统设置' })).toBeInTheDocument();
    expect(screen.getByText('管理快捷键、数据与安全选项')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '快捷键' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '数据备份和同步' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '数据维护' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '主密码' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '快捷键', level: 2 })).toBeInTheDocument();
  });

  it('默认显示快捷键分区（「前往自定义」按钮可见）', async () => {
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    expect(await screen.findByRole('button', { name: /前往自定义/ })).toBeInTheDocument();
  });

  it('点击「数据备份和同步」→ 显示备份区（导出/导入）', async () => {
    const user = userEvent.setup();
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    // 等快捷键分区渲染完（getAll 异步）
    await screen.findByRole('button', { name: /前往自定义/ });
    await user.click(screen.getByRole('tab', { name: '数据备份和同步' }));
    expect(await screen.findByRole('button', { name: '导出数据' })).toBeInTheDocument();
  });

  it('点击「主密码」→ 切换到主密码分区', async () => {
    const user = userEvent.setup();
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    await screen.findByRole('button', { name: /前往自定义/ });
    await user.click(screen.getByRole('tab', { name: '主密码' }));
    // PasswordSection 默认未设 → 「设置主密码」按钮（验证主密码分区已接入）
    expect(screen.getByRole('button', { name: '设置主密码' })).toBeInTheDocument();
  });

  it('设置分类为纵向导航，备份方式为横向导航且密文说明是静态注记', async () => {
    const user = userEvent.setup();
    render(<SettingsModal visible={true} onCancel={() => {}} />);

    expect(screen.getByRole('tablist', { name: '设置分类' })).toHaveAttribute('aria-orientation', 'vertical');

    await user.click(screen.getByRole('tab', { name: '数据备份和同步' }));
    expect(screen.getByRole('tablist', { name: '备份方式' })).toHaveAttribute('aria-orientation', 'horizontal');
    expect(screen.getByRole('note')).toHaveTextContent('导出文件含加密笔记的密文');
  });

  it('「数据备份和同步」内含 3 个 card 子 tab,默认本地备份,可切到云端同步', async () => {
    const user = userEvent.setup();
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    // 等快捷键分区渲染完（chrome.commands.getAll 异步）
    await screen.findByRole('button', { name: /前往自定义/ });
    // 进入「数据备份和同步」外层 tab
    await user.click(screen.getByRole('tab', { name: '数据备份和同步' }));

    // 3 个子 tab 存在
    const localTab = screen.getByRole('tab', { name: '本地备份' });
    const cloudTab = screen.getByRole('tab', { name: '云端同步' });
    const shareTab = screen.getByRole('tab', { name: '分享' });
    expect(localTab).toBeInTheDocument();
    expect(cloudTab).toBeInTheDocument();
    expect(shareTab).toBeInTheDocument();
    // 默认激活「本地备份」
    expect(localTab).toHaveAttribute('aria-selected', 'true');
    // 本地备份区内容渲染（导出数据按钮）
    expect(screen.getByRole('button', { name: '导出数据' })).toBeInTheDocument();

    // 切到「云端同步」
    await user.click(cloudTab);
    expect(cloudTab).toHaveAttribute('aria-selected', 'true');
    expect(localTab).toHaveAttribute('aria-selected', 'false');
  });
});
