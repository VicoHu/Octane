import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../hooks/useEncryptedContexts', () => ({
  useEncryptedContexts: vi.fn(),
}));
// InlineContextEditor 引 semi-ui barrel（jsdom 崩 lottie）；BookmarkGroup 测试只关注入口
vi.mock('../InlineContextEditor', () => ({
  InlineContextEditor: () => <div>editor-stub</div>,
}));

import { BookmarkGroup } from '../BookmarkGroup';
import { useEncryptedContexts } from '../../hooks/useEncryptedContexts';
import type { Bookmark, Context } from '@/shared/types';
import { ContextType } from '@/shared/types';

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'b1', workspaceId: 'w1', categoryId: 'c1', name: 'Google',
    url: 'https://google.com', description: '', faviconUrl: '',
    contextCount: 2, hasEncryptedContext: false, order: 0, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}
function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    id: 'c1', bookmarkId: 'b1', type: ContextType.NOTE, title: '笔记A',
    content: '内容', isEncrypted: false, order: 0, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}
const mock = useEncryptedContexts as ReturnType<typeof vi.fn>;

describe('BookmarkGroup — 单书签内容区', () => {
  beforeEach(() => vi.clearAllMocks());

  it('header 显示书签名 + 命中数', () => {
    mock.mockReturnValue({ contexts: [], error: null, loading: true });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.getByText('Google')).toBeTruthy();
    expect(screen.getByText(/2 条上下文/)).toBeTruthy();
  });

  it('传入 categoryName → header 渲染分类 chip（R1 来源辨识）', () => {
    mock.mockReturnValue({ contexts: [], error: null, loading: true });
    render(<BookmarkGroup bookmark={makeBookmark()} categoryName="开发工具" categoryIcon="📁" />);
    expect(screen.getByText(/开发工具/)).toBeTruthy();
  });

  it('未传 categoryName → 不渲染 chip（向后兼容）', () => {
    mock.mockReturnValue({ contexts: [], error: null, loading: true });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.queryByText('开发工具')).toBeNull();
  });

  it('loading（无数据）→ 显示加载中', () => {
    mock.mockReturnValue({ contexts: [], error: null, loading: true });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.getByText('加载中…')).toBeTruthy();
  });

  it('error 态 → 显示错误信息', () => {
    mock.mockReturnValue({ contexts: [], error: '解密失败', loading: false });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.getByText('解密失败')).toBeTruthy();
  });

  it('contexts 态 → 渲染 ContextCard 列表（明文 + 密文占位都渲染）', () => {
    mock.mockReturnValue({
      contexts: [
        makeContext({ id: 'c1', title: '笔记A' }),
        makeContext({ id: 'c2', title: '密文', content: '', isEncrypted: true }),
      ],
      error: null,
      loading: false,
    });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.getByText('笔记A')).toBeTruthy();
    // 密文占位由 ContextCard 渲染为「点击解锁」提示
    expect(screen.getByText(/加密上下文，点击解锁/)).toBeTruthy();
  });

  it('点击「+ 上下文」→ 展开就地创建编辑器', () => {
    mock.mockReturnValue({ contexts: [], error: null, loading: false });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.queryByText('editor-stub')).toBeNull();
    fireEvent.click(screen.getByLabelText('添加上下文'));
    expect(screen.getByText('editor-stub')).toBeTruthy();
  });
});
