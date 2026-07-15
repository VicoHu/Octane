import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconPicker } from '@/components/IconPicker';

describe('IconPicker — emoji 图标选择器', () => {
  it('渲染预设图标按钮并标记当前选中项', () => {
    render(<IconPicker value="📁" onChange={vi.fn()} />);

    expect(screen.getByText('当前图标')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择图标 📁' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('点击预设图标按钮触发 onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IconPicker value="📁" onChange={onChange} />);

    const firstButton = screen.getAllByRole('button', { name: /选择图标/ })[0]!;
    await user.click(firstButton);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(typeof onChange.mock.calls[0]![0]).toBe('string');
  });

  it('输入合法 emoji 触发 onChange 并清空错误', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IconPicker value="📁" onChange={onChange} />);

    await user.type(screen.getByPlaceholderText('或粘贴 / 输入自定义 emoji'), '🚀');

    expect(onChange).toHaveBeenCalledWith('🚀');
    expect(screen.queryByText('仅支持单个 emoji 字符')).not.toBeInTheDocument();
  });

  it('输入非 emoji 不触发 onChange 且显示错误', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IconPicker value="📁" onChange={onChange} />);

    await user.type(screen.getByPlaceholderText('或粘贴 / 输入自定义 emoji'), 'abc');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('仅支持单个 emoji 字符')).toBeInTheDocument();
  });

  it('输入中文不触发 onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IconPicker value="📁" onChange={onChange} />);

    await user.type(screen.getByPlaceholderText('或粘贴 / 输入自定义 emoji'), '工作');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('仅支持单个 emoji 字符')).toBeInTheDocument();
  });

  it('清空输入不触发 onChange 也不报错（允许中间态空值）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IconPicker value="📁" onChange={onChange} />);

    const input = screen.getByPlaceholderText('或粘贴 / 输入自定义 emoji');
    await user.type(input, 'abc');
    await user.clear(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('仅支持单个 emoji 字符')).not.toBeInTheDocument();
  });
});
