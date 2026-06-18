import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Semi UI 间接拉入 lottie-web，jsdom 无 canvas 实现会崩，统一 mock。
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

// mocks
const store = vi.hoisted(() => ({
  testCloudConnection: vi.fn(),
  saveCloudConfig: vi.fn(),
  clearCloudConfig: vi.fn(),
  uploadCloudBackup: vi.fn(),
  restoreFromCloud: vi.fn(),
  applyCloudRestore: vi.fn(),
}));
vi.mock('@/store/useBackup', () => ({
  useBackup: { getState: () => store },
}));

// CloudBackupSection 读 useCrypto（主密码状态 + 解锁入口）
const cryptoState = vi.hoisted(() => ({
  unlocked: false,
  passwordSet: false,
  openUnlockModal: vi.fn(),
}));
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (sel: (s: Record<string, unknown>) => unknown) => sel(cryptoState),
}));

const cloudSvc = vi.hoisted(() => ({ getLastBackupAt: vi.fn() }));
vi.mock('@/services/CloudStorageService', () => ({ getLastBackupAt: cloudSvc.getLastBackupAt }));

const providers = vi.hoisted(() => ({
  oss: {
    id: 'oss',
    label: '阿里云 OSS',
    configFields: [
      { name: 'region', label: 'Region', type: 'text' as const, required: true },
      { name: 'accessKeySecret', label: 'AccessKeySecret', type: 'password' as const, required: true },
    ],
  },
  cos: {
    id: 'cos',
    label: '腾讯云 COS',
    configFields: [{ name: 'region', label: 'Region', type: 'text' as const, required: true }],
  },
}));
vi.mock('@/services/cloud/providers', () => ({
  getCloudProvider: (id: 'oss' | 'cos') => providers[id],
}));

import { CloudBackupSection } from '../CloudBackupSection';
import type { BackupData } from '@/shared/types';

const okData: BackupData = { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null };

const btn = (text: string): HTMLButtonElement => screen.getByText(text).closest('button') as HTMLButtonElement;

beforeEach(() => {
  Object.values(store).forEach((m) => (m as ReturnType<typeof vi.fn>).mockReset());
  cloudSvc.getLastBackupAt.mockReset();
  // 默认已解锁、已设密码、无历史备份
  cryptoState.unlocked = true;
  cryptoState.passwordSet = true;
  cryptoState.openUnlockModal = vi.fn();
  cloudSvc.getLastBackupAt.mockResolvedValue(null);
});

describe('CloudBackupSection', () => {
  it('渲染两个服务商 Tab + 当前 provider 的字段 label', async () => {
    render(<CloudBackupSection />);
    await waitFor(() => expect(screen.getByText('阿里云 OSS')).toBeTruthy());
    expect(screen.getByText('腾讯云 COS')).toBeTruthy();
    expect(screen.getByText('Region')).toBeTruthy();
    expect(screen.getByText('AccessKeySecret')).toBeTruthy();
  });

  it('未解锁 → 显示 Banner + 内联解锁入口 + 操作按钮 disabled', async () => {
    cryptoState.unlocked = false;
    render(<CloudBackupSection />);
    await waitFor(() => expect(screen.getByText(/请先解锁/)).toBeTruthy());
    expect(btn('解锁主密码')).toBeTruthy(); // 内联解锁按钮
    expect(btn('测试连接').disabled).toBe(true);
    expect(btn('上传备份').disabled).toBe(true);
  });

  it('未设置主密码 → Banner 文案为「请先设置」+ 内联「设置主密码」按钮', async () => {
    cryptoState.unlocked = false;
    cryptoState.passwordSet = false;
    render(<CloudBackupSection />);
    await waitFor(() => expect(screen.getByText(/请先设置/)).toBeTruthy());
    expect(btn('设置主密码')).toBeTruthy();
  });

  it('点击「从云恢复」→ 下载解析成功 → 弹破坏性确认 Modal（未勾选时确认禁用）', async () => {
    store.restoreFromCloud.mockResolvedValue(okData);
    render(<CloudBackupSection />);
    await waitFor(() => expect(screen.getByText('上传备份')).toBeTruthy());
    fireEvent.click(btn('从云恢复'));
    await waitFor(() => expect(store.restoreFromCloud).toHaveBeenCalledWith('oss'));
    await waitFor(() => expect(screen.getByText('确认覆盖全部数据')).toBeTruthy());
    const confirmBtn = btn('确认覆盖');
    expect(confirmBtn.disabled).toBe(true); // 未勾选 Checkbox
    fireEvent.click(screen.getByText('我了解此操作不可撤销'));
    await waitFor(() => expect(confirmBtn.disabled).toBe(false));
  });

  it('确认覆盖 → applyCloudRestore', async () => {
    store.restoreFromCloud.mockResolvedValue(okData);
    store.applyCloudRestore.mockResolvedValue(undefined);
    render(<CloudBackupSection />);
    await waitFor(() => expect(screen.getByText('上传备份')).toBeTruthy());
    fireEvent.click(btn('从云恢复'));
    await waitFor(() => expect(screen.getByText('确认覆盖')).toBeTruthy());
    fireEvent.click(screen.getByText('我了解此操作不可撤销'));
    fireEvent.click(btn('确认覆盖'));
    await waitFor(() => expect(store.applyCloudRestore).toHaveBeenCalledWith(okData));
  });
});
