import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installChromeStorageLocal } from '@/test/storageMock';
import { WorkspaceTabsSection } from '../WorkspaceTabsSection';

describe('WorkspaceTabsSection — 工作区标签隔离设置分区', () => {
  beforeEach(() => installChromeStorageLocal({}));

  it('渲染两选项文案', () => {
    render(<WorkspaceTabsSection />);
    expect(screen.getByText('不隔离（默认）')).toBeInTheDocument();
    expect(screen.getByText('自动关闭与恢复')).toBeInTheDocument();
  });

  it('storage 无 key（默认 off）→ 加载完成后「不隔离」选中', async () => {
    render(<WorkspaceTabsSection />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /不隔离（默认）/ })).toBeChecked();
      expect(screen.getByRole('radio', { name: /自动关闭与恢复/ })).not.toBeChecked();
    });
  });

  it('切换到「自动关闭与恢复」（本窗无存量 tab，N=0）→ 直接写入 storage close', async () => {
    const { store } = installChromeStorageLocal({});
    const user = userEvent.setup();
    render(<WorkspaceTabsSection />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /不隔离/ })).toBeChecked());

    await user.click(screen.getByRole('radio', { name: /自动关闭与恢复/ }));

    await waitFor(() => expect(store['tabIsolationSetting']).toBe('close'));
  });

  it('storage 已存 close → 加载后「自动关闭与恢复」选中', async () => {
    installChromeStorageLocal({ initial: { tabIsolationSetting: 'close' } });
    render(<WorkspaceTabsSection />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /自动关闭与恢复/ })).toBeChecked();
    });
  });

  // ===== T5：off→close 首启确认 Dialog（N>0 弹，避免静默归入存量 tab）=====
  function installWindowWithTabs(tabs: { url: string; id?: number; index?: number }[]) {
    const { store } = installChromeStorageLocal({ initial: {} });
    const chrome = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    chrome.tabs = { query: vi.fn(async () => tabs) };
    chrome.windows = { getCurrent: vi.fn(async () => ({ id: 5 })) };
    return { store };
  }

  it('off→close + 本窗有可归档 tab → 弹确认 Dialog（N=2）；取消则保留 off', async () => {
    installWindowWithTabs([
      { id: 1, url: 'https://a.com', index: 0 },
      { id: 2, url: 'https://b.com', index: 1 },
    ]);
    const user = userEvent.setup();
    render(<WorkspaceTabsSection />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /不隔离/ })).toBeChecked());

    await user.click(screen.getByRole('radio', { name: /自动关闭与恢复/ }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/2 个标签/);
    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    // 取消：setting 仍 off
    expect(screen.getByRole('radio', { name: /不隔离（默认）/ })).toBeChecked();
  });

  it('off→close + 确认「开启隔离」→ 写入 storage close', async () => {
    const { store } = installWindowWithTabs([{ id: 1, url: 'https://a.com', index: 0 }]);
    const user = userEvent.setup();
    render(<WorkspaceTabsSection />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /不隔离/ })).toBeChecked());

    await user.click(screen.getByRole('radio', { name: /自动关闭与恢复/ }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: '开启隔离' }));

    await waitFor(() => expect(store['tabIsolationSetting']).toBe('close'));
  });
});
