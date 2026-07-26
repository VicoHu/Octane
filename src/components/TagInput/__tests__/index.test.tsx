import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagInput } from '../index';

describe('TagInput — Tag 多选输入组件', () => {
  it('空输入 + 回车 → 不添加标签', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput value={[]} onChange={onChange} suggestions={[]} />);

    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加/), '{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('合法输入 + 回车 → 添加标签并清空输入框', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput value={[]} onChange={onChange} suggestions={[]} />);

    const input = screen.getByPlaceholderText(/输入.*[Tt]ag|添加/);
    await user.type(input, 'React{Enter}');

    expect(onChange).toHaveBeenCalledWith(['React']);
    expect(input).toHaveValue('');
  });

  it('输入含内部空格 → 显示错误，不添加', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput value={[]} onChange={onChange} suggestions={[]} />);

    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加/), 'has space{Enter}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/不能包含空白字符/)).toBeInTheDocument();
  });

  it('输入超长（>32 字符）→ 显示错误，不添加', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const long = 'a'.repeat(33);
    render(<TagInput value={[]} onChange={onChange} suggestions={[]} />);

    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加/), `${long}{Enter}`);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/长度|超过|最多.*32/)).toBeInTheDocument();
  });

  it('已添加标签以 Badge 形式显示，点 × 可移除', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput value={['React', 'Vue']} onChange={onChange} suggestions={[]} />);

    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Vue')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /移除.*React|删除.*React|React.*移除/ }));
    expect(onChange).toHaveBeenCalledWith(['Vue']);
  });

  it('大小写不敏感去重：输入与已有仅大小写不同 → 复用已有展示形式', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput value={['React']} onChange={onChange} suggestions={[]} />);

    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加/), 'REACT{Enter}');

    // 复用已有展示形式 React，不新增 REACT
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('REACT')).not.toBeInTheDocument();
  });

  it('建议列表按传入顺序展示，点击建议可添加', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagInput value={[]} onChange={onChange} suggestions={['JavaScript', 'TypeScript']} />);

    const suggestionButton = screen.getByRole('button', { name: 'JavaScript' });
    await user.click(suggestionButton);

    expect(onChange).toHaveBeenCalledWith(['JavaScript']);
  });

  it('已达上限（20）时再输入 → 显示超量错误，不添加', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const full = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    render(<TagInput value={full} onChange={onChange} suggestions={[]} />);

    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加/), 'overflow{Enter}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/最多.*20|数量|上限/)).toBeInTheDocument();
  });

  it('已添加的标签不出现在建议列表中', () => {
    render(<TagInput value={['React']} onChange={vi.fn()} suggestions={['React', 'Vue']} />);

    // React 已选中，建议里不重复显示
    expect(screen.queryByRole('button', { name: 'React' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vue' })).toBeInTheDocument();
  });
});
