import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDB, getDB } from '@/shared/db/database';
import { createWorkspace } from '@/services/WorkspaceService';
import { createCategory } from '@/services/CategoryService';
import { createBookmark, listBookmarksByWorkspace } from '@/services/BookmarkService';
import { clearAllStores, mockChrome } from '../testUtils';
import SaveBookmarkView from './SaveBookmarkView';

describe('SaveBookmarkView', () => {
  beforeEach(async () => {
    resetDB();
    await getDB();
    await clearAllStores();
    vi.spyOn(window, 'close').mockImplementation(() => {});
    mockChrome({ url: 'https://github.com', title: 'GitHub' });
  });

  it('点击返回调用 onBack', async () => {
    const onBack = vi.fn();
    render(<SaveBookmarkView onBack={onBack} />);
    await screen.findByDisplayValue('https://github.com');
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('保存有效书签 → 写入 DB 并关闭 popup', async () => {
    const ws = await createWorkspace('工作', '📁');
    await createCategory(ws.id, '工具', '🔧');

    render(<SaveBookmarkView onBack={vi.fn()} />);

    // 等待当前 tab url 自动填充（验证 chrome.tabs.query + 数据加载）
    await screen.findByDisplayValue('https://github.com');

    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    const bms = await waitFor(async () => {
      const list = await listBookmarksByWorkspace(ws.id);
      expect(list).toHaveLength(1);
      return list;
    });
    expect(bms[0]!.url).toBe('https://github.com');
    // 保存成功后显示反馈
    await screen.findByText(/已保存/);
    // 反馈短暂显示后关闭
    await waitFor(() => expect(window.close).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('URL 非法（chrome://）时保存按钮禁用', async () => {
    const ws = await createWorkspace('工作', '📁');
    await createCategory(ws.id, '工具', '🔧');

    render(<SaveBookmarkView onBack={vi.fn()} />);
    await screen.findByDisplayValue('https://github.com');

    fireEvent.change(screen.getByDisplayValue('https://github.com'), {
      target: { value: 'chrome://newtab' },
    });

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it('同分类已有相同 URL → 提示重复，确认后仍可保存', async () => {
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '工具', '🔧');
    await createBookmark(ws.id, cat.id, { name: '已有', url: 'https://github.com' });

    render(<SaveBookmarkView onBack={vi.fn()} />);
    await screen.findByDisplayValue('https://github.com');

    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    // 出现重复提示 + 「仍然保存」按钮
    const forceBtn = await screen.findByRole('button', { name: /仍然保存/ });
    fireEvent.click(forceBtn);

    const bms = await waitFor(async () => {
      const list = await listBookmarksByWorkspace(ws.id);
      expect(list).toHaveLength(2);
      return list;
    });
    expect(bms.filter((b) => b.url === 'https://github.com')).toHaveLength(2);
    await waitFor(() => expect(window.close).toHaveBeenCalled(), { timeout: 2000 });
  });

  // === Issue #50: Popup 快速保存时录入 Tag ===

  it('提供 Tag 多选输入：输入合法 Tag + 回车 → 添加为 Badge', async () => {
    const user = userEvent.setup();
    const ws = await createWorkspace('工作', '📁');
    await createCategory(ws.id, '工具', '🔧');

    render(<SaveBookmarkView onBack={vi.fn()} />);
    await screen.findByDisplayValue('https://github.com');

    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加/), 'React{Enter}');
    expect(screen.getByText('React')).toBeInTheDocument();
  });

  it('当前 Workspace 已有书签的 Tag 出现在建议中', async () => {
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '工具', '🔧');
    await createBookmark(ws.id, cat.id, {
      name: '已有',
      url: 'https://old.example.com',
      tags: ['Vue'],
    });

    render(<SaveBookmarkView onBack={vi.fn()} />);
    await screen.findByDisplayValue('https://github.com');

    // Vue 来自已有书签，出现在建议列表
    expect(await screen.findByRole('button', { name: 'Vue' })).toBeInTheDocument();
  });

  it('切换 Workspace 后更新 Tag 建议源', async () => {
    const user = userEvent.setup();
    const ws1 = await createWorkspace('工作', '📁');
    const cat1 = await createCategory(ws1.id, '工具', '🔧');
    await createBookmark(ws1.id, cat1.id, {
      name: 'A',
      url: 'https://a.example.com',
      tags: ['React'],
    });
    const ws2 = await createWorkspace('生活', '🏠');
    const cat2 = await createCategory(ws2.id, '日常', '☕');
    await createBookmark(ws2.id, cat2.id, {
      name: 'B',
      url: 'https://b.example.com',
      tags: ['Go'],
    });

    render(<SaveBookmarkView onBack={vi.fn()} />);
    await screen.findByDisplayValue('https://github.com');

    // ws1 自动选中（第一个）→ React 建议出现，Go 不在
    expect(await screen.findByRole('button', { name: 'React' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go' })).not.toBeInTheDocument();

    // 切换到 ws2
    await user.click(screen.getByRole('combobox', { name: '工作区' }));
    await user.click(screen.getByText('🏠 生活'));

    // Go 建议出现，React 消失
    expect(await screen.findByRole('button', { name: 'Go' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'React' })).not.toBeInTheDocument();
  });

  it('非法 Tag（含空格）显示错误，保存时不静默写入', async () => {
    const user = userEvent.setup();
    const ws = await createWorkspace('工作', '📁');
    await createCategory(ws.id, '工具', '🔧');

    render(<SaveBookmarkView onBack={vi.fn()} />);
    await screen.findByDisplayValue('https://github.com');

    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加/), 'has space{Enter}');
    expect(screen.getByText(/不能包含空白字符/)).toBeInTheDocument();

    // 非法 Tag 未被添加 → 保存的书签 tags 为空
    await user.click(screen.getByRole('button', { name: /保存/ }));
    const bms = await waitFor(async () => {
      const list = await listBookmarksByWorkspace(ws.id);
      expect(list).toHaveLength(1);
      return list;
    });
    expect(bms[0]!.tags).toEqual([]);
  });

  it('正常保存持久化选中的 Tag（真实 DB 路径）', async () => {
    const user = userEvent.setup();
    const ws = await createWorkspace('工作', '📁');
    await createCategory(ws.id, '工具', '🔧');

    render(<SaveBookmarkView onBack={vi.fn()} />);
    await screen.findByDisplayValue('https://github.com');

    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加/), 'React{Enter}');
    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加/), 'Vue{Enter}');

    await user.click(screen.getByRole('button', { name: /保存/ }));
    const bms = await waitFor(async () => {
      const list = await listBookmarksByWorkspace(ws.id);
      expect(list).toHaveLength(1);
      return list;
    });
    expect(bms[0]!.tags).toEqual(['React', 'Vue']);
  });

  it('确认重复 URL 后强制保存也持久化 Tag', async () => {
    const user = userEvent.setup();
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '工具', '🔧');
    await createBookmark(ws.id, cat.id, { name: '已有', url: 'https://github.com' });

    render(<SaveBookmarkView onBack={vi.fn()} />);
    await screen.findByDisplayValue('https://github.com');

    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag|添加/), 'TypeScript{Enter}');

    await user.click(screen.getByRole('button', { name: /保存/ }));
    const forceBtn = await screen.findByRole('button', { name: /仍然保存/ });
    await user.click(forceBtn);

    const bms = await waitFor(async () => {
      const list = await listBookmarksByWorkspace(ws.id);
      expect(list).toHaveLength(2);
      return list;
    });
    // 新保存的书签带 Tag（已有书签无 Tag）
    const newBm = bms.find((b) => b.name !== '已有');
    expect(newBm!.tags).toEqual(['TypeScript']);
  });
});
