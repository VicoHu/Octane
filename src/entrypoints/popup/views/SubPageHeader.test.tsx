import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubPageHeader from './SubPageHeader';

describe('SubPageHeader', () => {
  it('渲染标题', () => {
    render(<SubPageHeader title="保存当前页面" onBack={vi.fn()} />);
    expect(screen.getByText('保存当前页面')).toBeInTheDocument();
  });

  it('点击返回按钮 → 调用 onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<SubPageHeader title="测试" onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
