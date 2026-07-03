import { describe, it, expect, vi } from 'vitest';
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

// CloudBackupSection 拉入 cloud 依赖，jsdom 下需 mock（避免真实 SDK / IndexedDB）。
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
vi.mock('@/services/CryptoService', () => ({ isUnlocked: () => Promise.resolve(true) }));
vi.mock('@/services/CloudStorageService', () => ({ getLastBackupAt: () => Promise.resolve(null) }));

import { render, screen, fireEvent } from '@testing-library/react';
import SettingsView from './SettingsView';

describe('SettingsView', () => {
  it('渲染本地备份区（导入/导出按钮）', () => {
    render(<SettingsView onBack={vi.fn()} />);
    expect(screen.getByText('导出数据')).toBeTruthy();
    expect(screen.getByText('导入数据')).toBeTruthy();
  });

  it('渲染云备份区（上传/恢复按钮）', async () => {
    render(<SettingsView onBack={vi.fn()} />);
    expect(await screen.findByText('上传备份')).toBeTruthy();
    expect(screen.getByText('从云恢复')).toBeTruthy();
  });

  it('点击返回调用 onBack', () => {
    const onBack = vi.fn();
    render(<SettingsView onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
