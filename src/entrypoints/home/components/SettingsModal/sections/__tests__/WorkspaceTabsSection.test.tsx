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

  it('切换到「自动关闭与恢复」→ 写入 storage.local tabIsolationSetting=close', async () => {
    const { store } = installChromeStorageLocal({});
    const user = userEvent.setup();
    render(<WorkspaceTabsSection />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /不隔离/ })).toBeChecked());

    await user.click(screen.getByRole('radio', { name: /自动关闭与恢复/ }));

    expect(store['tabIsolationSetting']).toBe('close');
  });

  it('storage 已存 close → 加载后「自动关闭与恢复」选中', async () => {
    installChromeStorageLocal({ initial: { tabIsolationSetting: 'close' } });
    render(<WorkspaceTabsSection />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /自动关闭与恢复/ })).toBeChecked();
    });
  });
});
