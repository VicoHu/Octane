import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Semi UI 加载动画依赖 lottie-web；jsdom 无 canvas 支持，
// mock 模块避免 TypeError: Cannot set properties of null (setting 'fillStyle')
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { resetDB, getDB } from '@/shared/db/database';
import { createWorkspace } from '@/services/WorkspaceService';
import { createCategory } from '@/services/CategoryService';
import { createBookmark, listBookmarksByWorkspace } from '@/services/BookmarkService';
import App from './App';

/** 清空所有 object store，保证测试隔离 */
async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const names = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) await tx.objectStore(n).clear();
  await tx.done;
}

/** 覆盖 chrome 全局为可控 mock（覆盖 WxtVitest 的 fakeBrowser，使返回值确定） */
function mockChrome(activeTab: { url: string; title: string }): void {
  const storage: Record<string, unknown> = {};
  (globalThis as { chrome: unknown }).chrome = {
    tabs: { query: vi.fn().mockResolvedValue([activeTab]) },
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in storage) out[k] = storage[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storage, items);
        }),
      },
    },
    runtime: { getURL: vi.fn().mockReturnValue('chrome-extension://x/newtab.html') },
  };
}

describe('Popup App', () => {
  beforeEach(async () => {
    resetDB();
    await getDB();
    await clearAllStores();
    vi.spyOn(window, 'close').mockImplementation(() => {});
    mockChrome({ url: 'https://github.com', title: 'GitHub' });
  });

  it('保存有效书签 → 写入 DB（含 favicon）并关闭 popup', async () => {
    const ws = await createWorkspace('工作', '📁');
    await createCategory(ws.id, '工具', '🔧');

    render(<App />);

    // 等待当前 tab url 自动填充（验证 chrome.tabs.query + 数据加载）
    await screen.findByDisplayValue('https://github.com');

    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    const bms = await waitFor(async () => {
      const list = await listBookmarksByWorkspace(ws.id);
      expect(list).toHaveLength(1);
      return list;
    });
    expect(bms[0]!.url).toBe('https://github.com');
    expect(bms[0]!.faviconUrl).toContain('google.com/s2/favicons');
    // 保存成功后显示反馈
    await screen.findByText(/已保存/);
    // 反馈短暂显示后关闭
    await waitFor(() => expect(window.close).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('URL 非法（chrome://）时保存按钮禁用', async () => {
    const ws = await createWorkspace('工作', '📁');
    await createCategory(ws.id, '工具', '🔧');

    render(<App />);
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

    render(<App />);
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
});
