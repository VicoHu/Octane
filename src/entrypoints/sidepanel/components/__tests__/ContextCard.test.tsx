import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextCard } from '../ContextCard';
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
    // getByText 找不到会抛错 → 测试失败；找到则返回 element（truthy）
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
