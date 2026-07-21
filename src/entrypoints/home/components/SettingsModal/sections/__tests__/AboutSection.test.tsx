import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installChromeStorageLocal } from '@/test/storageMock';
import { AboutSection } from '../AboutSection';
import { CWS_EXTENSION_ID, UPDATE_URL } from '@/shared/distribution';

// 一次性设好 chrome：runtime.id（定渠道）+ getManifest.version + tabs.create（外链）+
// storage.local（installChromeStorageLocal）+ storage.onChanged（usePendingUpdate 需要）。
function setupChrome(opts: { id?: string; version?: string; pending?: { version: string } }) {
  const tabsCreate = vi.fn();
  installChromeStorageLocal({
    initial: opts.pending ? { pendingUpdate: opts.pending } : {},
  });
  const chromeObj = (globalThis as { chrome?: Record<string, unknown> }).chrome!;
  chromeObj.runtime = {
    id: opts.id ?? 'unknownid',
    getManifest: () => ({ version: opts.version ?? '0.1.13.0' }),
  };
  chromeObj.tabs = { create: tabsCreate };
  (chromeObj.storage as Record<string, unknown>).onChanged = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  return { tabsCreate };
}

describe('AboutSection', () => {
  it('显示版本号 + 作者 + 仓库', () => {
    setupChrome({ id: CWS_EXTENSION_ID });
    render(<AboutSection />);
    expect(screen.getByText(/v0\.1\.13\.0/)).toBeInTheDocument();
    // Button variant="link" 渲染为 <button>，非 <a>，role 为 button
    expect(screen.getByRole('button', { name: 'VicoHu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'VicoHu/Octane' })).toBeInTheDocument();
  });

  it('CWS 渠道显示「Chrome 商店版」+ 已是最新（无 pending）', () => {
    setupChrome({ id: CWS_EXTENSION_ID });
    render(<AboutSection />);
    expect(screen.getByText('Chrome 商店版')).toBeInTheDocument();
    expect(screen.getByText(/已是最新版本/)).toBeInTheDocument();
  });

  it('manual 渠道显示「手动安装」+ 前往 GitHub Releases', () => {
    setupChrome({ id: 'unknownid' });
    render(<AboutSection />);
    expect(screen.getByText('手动安装')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /前往 GitHub Releases/ })).toBeInTheDocument();
  });

  it('manual 渠道点「前往 GitHub Releases」→ tabs.create(Releases URL)', async () => {
    const user = userEvent.setup();
    const { tabsCreate } = setupChrome({ id: 'unknownid' });
    render(<AboutSection />);
    await user.click(screen.getByRole('button', { name: /前往 GitHub Releases/ }));
    expect(tabsCreate).toHaveBeenCalledWith({ url: UPDATE_URL.manual });
  });

  it('CWS 渠道有 pending → 显示新版本提示 + 前往商店按钮', async () => {
    const user = userEvent.setup();
    const { tabsCreate } = setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    render(<AboutSection />);
    expect(await screen.findByText(/新版本 v0\.1\.14\.0 可用/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '前往商店' }));
    expect(tabsCreate).toHaveBeenCalledWith({ url: UPDATE_URL.cws });
  });
});
