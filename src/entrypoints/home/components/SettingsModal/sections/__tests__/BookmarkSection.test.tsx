import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installChromeStorageLocal } from '@/test/storageMock';
import { BookmarkSection } from '../BookmarkSection';

describe('BookmarkSection — 书签设置分区（Tag 筛选记忆范围）', () => {
  beforeEach(() => installChromeStorageLocal({}));

  it('渲染三档选项文案与说明', () => {
    render(<BookmarkSection />);
    expect(screen.getByText('仅当前分类')).toBeInTheDocument();
    expect(screen.getByText('当前工作区')).toBeInTheDocument();
    expect(screen.getByText('当前会话')).toBeInTheDocument();
  });

  it('storage 无 key（默认）→ 加载完成后「仅当前分类」选中', async () => {
    render(<BookmarkSection />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /仅当前分类/ })).toBeChecked();
    });
  });

  it('展示各档说明文案', () => {
    render(<BookmarkSection />);
    expect(screen.getByText(/离开当前分类时清除该分类的筛选/)).toBeInTheDocument();
    expect(screen.getByText(/同一工作区内分别记忆各分类的筛选/)).toBeInTheDocument();
    expect(screen.getByText(/页面生命周期内记忆所有分类的筛选/)).toBeInTheDocument();
  });

  it('切换到「当前工作区」→ 写入 storage workspace', async () => {
    const { store } = installChromeStorageLocal({});
    const user = userEvent.setup();
    render(<BookmarkSection />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /仅当前分类/ })).toBeChecked());

    await user.click(screen.getByRole('radio', { name: /当前工作区/ }));

    await waitFor(() => expect(store.tagFilterMemoryScope).toBe('workspace'));
  });

  it('切换到「当前会话」→ 写入 storage session', async () => {
    const { store } = installChromeStorageLocal({});
    const user = userEvent.setup();
    render(<BookmarkSection />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /仅当前分类/ })).toBeChecked());

    await user.click(screen.getByRole('radio', { name: /当前会话/ }));

    await waitFor(() => expect(store.tagFilterMemoryScope).toBe('session'));
  });

  it('storage 已存 workspace → 加载后「当前工作区」选中', async () => {
    installChromeStorageLocal({ initial: { tagFilterMemoryScope: 'workspace' } });
    render(<BookmarkSection />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /当前工作区/ })).toBeChecked();
    });
  });

  it('非法存储值 → 回退「仅当前分类」选中', async () => {
    installChromeStorageLocal({ initial: { tagFilterMemoryScope: 'bogus' } });
    render(<BookmarkSection />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /仅当前分类/ })).toBeChecked();
    });
  });
});
