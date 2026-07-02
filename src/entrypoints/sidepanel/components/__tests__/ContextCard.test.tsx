import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    expect(screen.getByText('我的笔记')).toBeTruthy();
  });

  it('content 渲染为 markdown（**粗体** → <strong>）', () => {
    render(<ContextCard context={makeContext()} />);
    expect(document.querySelector('strong')?.textContent).toBe('粗体');
  });

  it('标题为空时显示"无标题"', () => {
    render(<ContextCard context={makeContext({ title: '' })} />);
    expect(screen.getByText('无标题')).toBeTruthy();
  });
});

describe('ContextCard — 密文未解锁锁占位', () => {
  it('密文未解锁（content 空）→ 渲染锁占位，不泄露明文', () => {
    render(<ContextCard context={makeContext({ content: '', isEncrypted: true })} />);
    expect(screen.getByText(/加密上下文，点击解锁/)).toBeTruthy();
  });

  it('密文已解锁（content 有值）→ 正常渲染内容', () => {
    render(<ContextCard context={makeContext({ isEncrypted: true })} />);
    expect(screen.queryByText(/加密上下文，点击解锁/)).toBeNull();
    expect(document.querySelector('strong')?.textContent).toBe('粗体');
  });

  it('点击锁占位 → 调 requestUnlock 发起解锁', () => {
    const requestUnlock = vi.fn();
    render(
      <UnlockContext.Provider value={{ requestUnlock }}>
        <ContextCard context={makeContext({ content: '', isEncrypted: true })} />
      </UnlockContext.Provider>,
    );
    fireEvent.click(screen.getByText(/加密上下文，点击解锁/));
    expect(requestUnlock).toHaveBeenCalledTimes(1);
  });

  it('键盘 Enter/Space → 触发 requestUnlock（可访问性）', () => {
    const requestUnlock = vi.fn();
    render(
      <UnlockContext.Provider value={{ requestUnlock }}>
        <ContextCard context={makeContext({ content: '', isEncrypted: true })} />
      </UnlockContext.Provider>,
    );
    const target = screen.getByLabelText('加密上下文，点击解锁');
    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.keyDown(target, { key: ' ' });
    expect(requestUnlock).toHaveBeenCalledTimes(2);
  });
});
