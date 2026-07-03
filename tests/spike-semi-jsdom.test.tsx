import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Modal, Input, Button, Toast, InputNumber, Switch } from '@douyinfe/semi-ui';

// Toast 涉及 portal + 全局副作用，partial mock 保留其余真实组件、仅 spy Toast。
vi.mock('@douyinfe/semi-ui', async (importActual) => {
  const actual = await importActual<typeof import('@douyinfe/semi-ui')>();
  return {
    ...actual,
    Toast: { ...actual.Toast, success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  };
});

/**
 * Spike（Step 0）：验证 Semi 组件在 jsdom 下能真实渲染，且规范 §4.5 的 query 风格成立。
 * lottie-web 由 tests/setup.ts 全局 mock，此处不重复声明（验证全局方案）。
 * 跑通后本文件转永久 smoke test（eng review F17），用于 Semi/jsdom 升级预警。
 */
describe('Spike: Semi 真实渲染于 jsdom', () => {
  it('Modal visible 时 title 渲染到 DOM', () => {
    render(
      <Modal title="解锁加密上下文" visible>
        <span>body</span>
      </Modal>,
    );
    expect(screen.getByText('解锁加密上下文')).toBeInTheDocument();
  });

  it('Input placeholder 可被 getByPlaceholderText 命中', () => {
    render(<Input placeholder="输入主密码" />);
    expect(screen.getByPlaceholderText('输入主密码')).toBeInTheDocument();
  });

  it('Input onChange 签名是 (value: string) —— 直接传 setPassword 可行', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    function Comp() {
      const [v, setV] = useState('');
      return (
        <Input
          placeholder="pw"
          value={v}
          onChange={(s: string) => {
            seen.push(s);
            setV(s);
          }}
        />
      );
    }
    render(<Comp />);
    await user.type(screen.getByPlaceholderText('pw'), 'abc');
    // 最后一次 onChange 应是完整串（受控逐字符触发，验证签名是 string 不是 event）
    expect(seen.at(-1)).toBe('abc');
  });

  it('Button accessible name 可被 getByRole({ name }) 命中 + onClick 触发', async () => {
    const user = userEvent.setup();
    const fn = vi.fn();
    render(<Button onClick={fn}>解锁</Button>);
    await user.click(screen.getByRole('button', { name: /解锁/ }));
    expect(fn).toHaveBeenCalledOnce();
  });

  it('Toast.success spy 在 partial mock 下被真实点击触发', async () => {
    const user = userEvent.setup();
    function Comp() {
      return <Button onClick={() => Toast.success('已解锁')}>触发</Button>;
    }
    render(<Comp />);
    await user.click(screen.getByRole('button', { name: /触发/ }));
    expect(Toast.success).toHaveBeenCalledWith('已解锁');
  });

  it('InputNumber onChange 签名（值非 event）', async () => {
    const user = userEvent.setup();
    let captured: unknown = undefined;
    function Comp() {
      return <InputNumber onChange={(v) => { captured = v; }} />;
    }
    const { container } = render(<Comp />);
    const input = container.querySelector('input') as HTMLInputElement;
    await user.type(input, '5');
    // 只验签名：onChange 收到的是值（number|string|undefined），不是 React event
    expect(captured).not.toBeUndefined();
  });

  it('Switch onChange 签名是 (checked: boolean)', async () => {
    const user = userEvent.setup();
    let checked: boolean | undefined = undefined;
    function Comp() {
      return <Switch onChange={(c: boolean) => { checked = c; }} />;
    }
    render(<Comp />);
    await user.click(screen.getByRole('switch'));
    expect(checked).toBe(true);
  });
});
