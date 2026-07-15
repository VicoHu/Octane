import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextCard } from '../ContextCard';
import { UnlockContext } from '../../unlockContext';
import { ContextType } from '@/shared/types';
import type { Context } from '@/shared/types';

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    id: 'c1', bookmarkId: 'b1', type: ContextType.NOTE,
    title: '我的笔记', content: '**粗体**', isEncrypted: false,
    order: 0, createdAt: 0, updatedAt: 0, ...overrides,
  };
}

describe('ContextCard — 纯展示', () => {
  it('渲染标题', () => {
    render(<ContextCard context={makeContext()} />);
    expect(screen.getByText('我的笔记')).toBeInTheDocument();
  });

  it('content 渲染为 markdown（**粗体** → <strong>）', () => {
    render(<ContextCard context={makeContext()} />);
    expect(screen.getByText('粗体', { selector: 'strong' })).toBeInTheDocument();
  });

  it('标题为空时显示"无标题"', () => {
    render(<ContextCard context={makeContext({ title: '' })} />);
    expect(screen.getByText('无标题')).toBeInTheDocument();
  });
});

describe('ContextCard — 密文未解锁锁占位', () => {
  it('密文未解锁（content 空）→ 渲染锁占位，不泄露明文', () => {
    render(<ContextCard context={makeContext({ content: '', isEncrypted: true })} />);
    expect(screen.getByText(/加密上下文，点击解锁/)).toBeInTheDocument();
  });

  it('密文已解锁（content 有值）→ 正常渲染内容', () => {
    render(<ContextCard context={makeContext({ isEncrypted: true })} />);
    expect(screen.queryByText(/加密上下文，点击解锁/)).not.toBeInTheDocument();
    expect(screen.getByText('粗体', { selector: 'strong' })).toBeInTheDocument();
  });

  it('点击书签主操作按钮 → 调 requestUnlock 发起解锁', async () => {
    const user = userEvent.setup();
    const requestUnlock = vi.fn();
    render(
      <UnlockContext.Provider value={{ requestUnlock }}>
        <ContextCard context={makeContext({ content: '', isEncrypted: true })} />
      </UnlockContext.Provider>,
    );
    const unlockButton = screen.getByRole('button', { name: '加密上下文，点击解锁' });
    expect(unlockButton).toBeInstanceOf(HTMLButtonElement);
    await user.click(unlockButton);
    expect(requestUnlock).toHaveBeenCalledTimes(1);
  });

  it('键盘激活书签主操作按钮 → 触发 requestUnlock', async () => {
    const user = userEvent.setup();
    const requestUnlock = vi.fn();
    render(
      <UnlockContext.Provider value={{ requestUnlock }}>
        <ContextCard context={makeContext({ content: '', isEncrypted: true })} />
      </UnlockContext.Provider>,
    );
    const target = screen.getByRole('button', { name: '加密上下文，点击解锁' });
    expect(target).toBeInstanceOf(HTMLButtonElement);
    target.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(requestUnlock).toHaveBeenCalledTimes(2);
  });
});
