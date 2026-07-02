import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Semi 组件桩（避 semi-ui barrel 拉入 lottie-web 在 jsdom 崩；只测编辑器逻辑）
vi.mock('@douyinfe/semi-ui', () => ({
  Input: (props: any) => <input aria-label="title" value={props.value ?? ''} onChange={(e) => props.onChange?.(e.target.value)} />,
  TextArea: (props: any) => <textarea aria-label="content" value={props.value ?? ''} onChange={(e) => props.onChange?.(e.target.value)} />,
  Switch: (props: any) => (
    <input type="checkbox" aria-label="encrypt" checked={!!props.checked} onChange={(e) => props.onChange?.(e.target.checked, e)} />
  ),
  Button: (props: any) => (
    <button
      aria-label={typeof props.children === 'string' ? props.children : undefined}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.loading ? 'saving' : props.children}
    </button>
  ),
  Toast: { warning: vi.fn(), error: vi.fn() },
}));
vi.mock('@/services/ContextService', () => ({ createContext: vi.fn() }));
vi.mock('@/services/UnlockSession', () => ({ isUnlocked: vi.fn() })); vi.mock('@/services/CryptoService', () => ({}));

import { InlineContextEditor } from '../InlineContextEditor';
import { createContext } from '@/services/ContextService';
import { isUnlocked } from '@/services/UnlockSession';
import { Toast } from '@douyinfe/semi-ui';

const createContextMock = createContext as ReturnType<typeof vi.fn>;
const isUnlockedMock = isUnlocked as ReturnType<typeof vi.fn>;

describe('InlineContextEditor — 就地创建上下文', () => {
  beforeEach(() => vi.clearAllMocks());

  it('保存普通上下文 → createContext(bookmarkId, NOTE, title, content, false) → onDone 收起', async () => {
    isUnlockedMock.mockResolvedValue(true);
    createContextMock.mockResolvedValue({});
    const onDone = vi.fn();
    render(<InlineContextEditor bookmarkId="bm-1" onDone={onDone} />);

    fireEvent.change(screen.getByLabelText('title'), { target: { value: '标题' } });
    fireEvent.change(screen.getByLabelText('content'), { target: { value: '从页面粘贴的内容' } });
    fireEvent.click(screen.getByLabelText('保存'));

    await waitFor(() => expect(createContextMock).toHaveBeenCalledTimes(1));
    expect(createContextMock).toHaveBeenCalledWith('bm-1', 'note', '标题', '从页面粘贴的内容', false);
    // saved → 1.5s 后 onDone（waitFor 须 > 1500ms）
    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 2500 });
  });

  it('防双击重复创建（R7 saving 态按钮禁用）', async () => {
    isUnlockedMock.mockResolvedValue(true);
    let resolveSave!: (v: unknown) => void;
    createContextMock.mockReturnValue(new Promise((r) => { resolveSave = r; }));
    const onDone = vi.fn();
    render(<InlineContextEditor bookmarkId="bm-1" onDone={onDone} />);

    fireEvent.change(screen.getByLabelText('content'), { target: { value: 'x' } });
    fireEvent.click(screen.getByLabelText('保存'));
    // saving 中再点（按钮应禁用，不再触发第二次）
    fireEvent.click(screen.getByLabelText('保存'));
    expect(createContextMock).toHaveBeenCalledTimes(1);
    resolveSave({});
    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 2500 });
  });

  it('R2 加密 Switch + 未解锁 → Toast.warning，encrypted 保持 false', async () => {
    isUnlockedMock.mockResolvedValue(false);
    createContextMock.mockResolvedValue({});
    render(<InlineContextEditor bookmarkId="bm-1" onDone={vi.fn()} />);

    const sw = screen.getByLabelText('encrypt') as HTMLInputElement;
    fireEvent.click(sw); // 尝试开启加密
    await waitFor(() => expect(Toast.warning).toHaveBeenCalledWith('请先解锁加密上下文'));
    // switch 回滚（encrypted 仍 false）→ 保存时 sensitive=false
    fireEvent.change(screen.getByLabelText('content'), { target: { value: 'x' } });
    fireEvent.click(screen.getByLabelText('保存'));
    await waitFor(() => expect(createContextMock).toHaveBeenCalled());
    expect(createContextMock).toHaveBeenCalledWith('bm-1', 'note', '', 'x', false);
  });

  it('R2 加密 Switch + 已解锁 → encrypted=true，保存 sensitive=true', async () => {
    isUnlockedMock.mockResolvedValue(true);
    createContextMock.mockResolvedValue({});
    render(<InlineContextEditor bookmarkId="bm-1" onDone={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('encrypt'));
    // 加密 toggle 异步（await isUnlocked）→ 等其生效后再保存
    await waitFor(() => expect(screen.getByText('🔒 加密')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('content'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByLabelText('保存'));
    await waitFor(() => expect(createContextMock).toHaveBeenCalled());
    expect(createContextMock).toHaveBeenCalledWith('bm-1', 'note', '', 'secret', true);
  });

  it('error 态 → createContext reject → Toast.error，保留输入不收起', async () => {
    isUnlockedMock.mockResolvedValue(true);
    createContextMock.mockRejectedValue(new Error('IDB 写失败'));
    const onDone = vi.fn();
    render(<InlineContextEditor bookmarkId="bm-1" onDone={onDone} />);

    fireEvent.change(screen.getByLabelText('content'), { target: { value: '保留我' } });
    fireEvent.click(screen.getByLabelText('保存'));
    await waitFor(() => expect(createContextMock).toHaveBeenCalled());
    await waitFor(() => expect(Toast.error).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
    // 输入保留
    expect((screen.getByLabelText('content') as HTMLTextAreaElement).value).toBe('保留我');
  });

  it('取消 → onDone，不调 createContext', () => {
    const onDone = vi.fn();
    render(<InlineContextEditor bookmarkId="bm-1" onDone={onDone} />);
    fireEvent.click(screen.getByLabelText('取消'));
    expect(onDone).toHaveBeenCalled();
    expect(createContextMock).not.toHaveBeenCalled();
  });
});
