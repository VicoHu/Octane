import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextEditor } from '../index';
import type { Context } from '@/shared/types';

vi.mock('@/store/useCrypto', () => ({
  useCrypto: (selector: (state: { unlocked: boolean }) => unknown) => selector({ unlocked: true }),
}));
vi.mock('@/store/useBookmarks', () => ({
  useBookmarks: (selector: (state: { refreshBookmark: () => Promise<void> }) => unknown) =>
    selector({ refreshBookmark: vi.fn().mockResolvedValue(undefined) }),
}));

const context = {
  id: 'ctx-1',
  bookmarkId: 'bookmark-1',
  type: 'note',
  title: '测试上下文',
  content: '正文',
  isEncrypted: false,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
} as Context;

describe('ContextEditor — 上下文编辑', () => {
  it('返回按钮可点击且正文可通过无障碍名称查询', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<ContextEditor context={context} onBack={onBack} />);

    expect(screen.getByRole('textbox', { name: '上下文内容' })).toHaveValue('正文');
    await user.click(screen.getByRole('button', { name: '返回' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
