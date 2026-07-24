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
  const requestUpdateCheck = vi.fn().mockResolvedValue({ status: 'update_available' });
  const reload = vi.fn();
  installChromeStorageLocal({
    initial: opts.pending ? { pendingUpdate: opts.pending } : {},
  });
  const chromeObj = (globalThis as { chrome?: Record<string, unknown> }).chrome!;
  chromeObj.runtime = {
    id: opts.id ?? 'unknownid',
    getManifest: () => ({ version: opts.version ?? '0.1.13.0' }),
    requestUpdateCheck,
    reload,
  };
  chromeObj.tabs = { create: tabsCreate };
  (chromeObj.storage as Record<string, unknown>).onChanged = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  return { tabsCreate, requestUpdateCheck, reload };
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

  it('CWS 渠道有 pending → 显示立即更新按钮 + 扩展管理页兜底链接', async () => {
    setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    render(<AboutSection />);
    expect(await screen.findByText(/新版本 v0\.1\.14\.0 可用/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即更新' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /扩展管理页/ })).toBeInTheDocument();
  });

  it('CWS 渠道点立即更新 → requestUpdateCheck 后 reload', async () => {
    const user = userEvent.setup();
    const { requestUpdateCheck, reload } = setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    render(<AboutSection />);
    await user.click(await screen.findByRole('button', { name: '立即更新' }));
    expect(requestUpdateCheck).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    // 先 check 后 reload（前面 toHaveBeenCalledTimes(1) 已保证 invocationCallOrder[0] 存在）
    expect(requestUpdateCheck.mock.invocationCallOrder[0]!).toBeLessThan(
      reload.mock.invocationCallOrder[0]!,
    );
  });

  it('requestUpdateCheck 抛异常仍 reload（pendingUpdate 已证明有更新）', async () => {
    const user = userEvent.setup();
    const { requestUpdateCheck, reload } = setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    requestUpdateCheck.mockRejectedValueOnce(new Error('boom'));
    render(<AboutSection />);
    await user.click(await screen.findByRole('button', { name: '立即更新' }));
    expect(requestUpdateCheck).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('点击立即更新期间按钮禁用并显示 Spinner', async () => {
    const user = userEvent.setup();
    setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    render(<AboutSection />);
    await user.click(await screen.findByRole('button', { name: '立即更新' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /更新中/ })).toBeDisabled();
  });

  it('CWS 渠道点扩展管理页链接 → tabs.create(chrome://extensions)', async () => {
    const user = userEvent.setup();
    const { tabsCreate } = setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    render(<AboutSection />);
    await user.click(await screen.findByRole('button', { name: /扩展管理页/ }));
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome://extensions' });
  });
});
