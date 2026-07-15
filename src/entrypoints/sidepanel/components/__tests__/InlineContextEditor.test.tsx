import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Toast 涉及 portal + 全局副作用，mock 为副作用边界。
vi.mock('@/components/ui/toast', () => ({
  Toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), close: vi.fn() },
}));
// 副作用边界：createContext（IDB 写）、isUnlocked（派生 key 校验）
vi.mock('@/services/ContextService', () => ({ createContext: vi.fn() }));
vi.mock('@/services/UnlockSession', () => ({ isUnlocked: vi.fn() }));
vi.mock('@/services/CryptoService', () => ({}));

import { InlineContextEditor } from '../InlineContextEditor';
import { createContext } from '@/services/ContextService';
import { isUnlocked } from '@/services/UnlockSession';
import { Toast } from '@/components/ui/toast';

const createContextMock = createContext as unknown as ReturnType<typeof vi.fn>;
const isUnlockedMock = isUnlocked as unknown as ReturnType<typeof vi.fn>;

describe('InlineContextEditor — 就地创建上下文', () => {
  beforeEach(() => vi.clearAllMocks());

  it('保存普通上下文 → createContext(bookmarkId, NOTE, title, content, false) → onDone 收起', async () => {
    const user = userEvent.setup();
    isUnlockedMock.mockResolvedValue(true);
    createContextMock.mockResolvedValue({});
    const onDone = vi.fn();
    render(<InlineContextEditor bookmarkId="bm-1" onDone={onDone} />);

    await user.type(screen.getByLabelText('title'), '标题');
    await user.type(screen.getByLabelText('content'), '从页面粘贴的内容');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(createContextMock).toHaveBeenCalledTimes(1));
    expect(createContextMock).toHaveBeenCalledWith('bm-1', 'note', '标题', '从页面粘贴的内容', false);
    // saved → 1.5s 后 onDone（waitFor 须 > 1500ms）
    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 2500 });
  });

  it('防双击重复创建（R7 saving 态按钮禁用）', async () => {
    const user = userEvent.setup();
    isUnlockedMock.mockResolvedValue(true);
    let resolveSave!: (v: unknown) => void;
    createContextMock.mockReturnValue(new Promise((r) => { resolveSave = r; }));
    const onDone = vi.fn();
    render(<InlineContextEditor bookmarkId="bm-1" onDone={onDone} />);

    await user.type(screen.getByLabelText('content'), 'x');
    await user.click(screen.getByRole('button', { name: '保存' }));
    // saving 中再点（按钮应禁用，不再触发第二次）
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(createContextMock).toHaveBeenCalledTimes(1);
    resolveSave({});
    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 2500 });
  });

  it('R2 加密 Switch + 未解锁 → Toast.warning，encrypted 保持 false', async () => {
    const user = userEvent.setup();
    isUnlockedMock.mockResolvedValue(false);
    createContextMock.mockResolvedValue({});
    render(<InlineContextEditor bookmarkId="bm-1" onDone={vi.fn()} />);

    // Switch 可访问性 role=switch（spike 验证）
    await user.click(screen.getByRole('switch'));
    await waitFor(() => expect(Toast.warning).toHaveBeenCalledWith('请先解锁加密上下文'));
    // switch 回滚（encrypted 仍 false）→ 保存时 sensitive=false
    await user.type(screen.getByLabelText('content'), 'x');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(createContextMock).toHaveBeenCalled());
    expect(createContextMock).toHaveBeenCalledWith('bm-1', 'note', '', 'x', false);
  });

  it('R2 加密 Switch + 已解锁 → encrypted=true，保存 sensitive=true', async () => {
    const user = userEvent.setup();
    isUnlockedMock.mockResolvedValue(true);
    createContextMock.mockResolvedValue({});
    render(<InlineContextEditor bookmarkId="bm-1" onDone={vi.fn()} />);

    await user.click(screen.getByRole('switch'));
    // 加密 toggle 异步（await isUnlocked）→ 等其生效后再保存
    await waitFor(() => expect(screen.getByText('🔒 加密')).toBeInTheDocument());
    await user.type(screen.getByLabelText('content'), 'secret');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(createContextMock).toHaveBeenCalled());
    expect(createContextMock).toHaveBeenCalledWith('bm-1', 'note', '', 'secret', true);
  });

  it('error 态 → createContext reject → Toast.error，保留输入不收起', async () => {
    const user = userEvent.setup();
    isUnlockedMock.mockResolvedValue(true);
    createContextMock.mockRejectedValue(new Error('IDB 写失败'));
    const onDone = vi.fn();
    render(<InlineContextEditor bookmarkId="bm-1" onDone={onDone} />);

    await user.type(screen.getByLabelText('content'), '保留我');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(createContextMock).toHaveBeenCalled());
    await waitFor(() => expect(Toast.error).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
    // 输入保留
    expect((screen.getByLabelText('content') as HTMLTextAreaElement).value).toBe('保留我');
  });

  it('取消 → onDone，不调 createContext', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<InlineContextEditor bookmarkId="bm-1" onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onDone).toHaveBeenCalled();
    expect(createContextMock).not.toHaveBeenCalled();
  });
});
