import { describe, it, expect, vi } from 'vitest';
// Semi 加载动画依赖 lottie-web；jsdom 无 canvas，mock 掉
vi.mock('lottie-web', () => ({ default: vi.fn() }));
import { render, screen, fireEvent } from '@testing-library/react';
import { TabList } from '../index';
import type { OpenTab } from '../../../hooks/useOpenTabs';
import type { Bookmark } from '@/shared/types';

function makeTab(over: Partial<OpenTab> & { tabId: number; url: string }): OpenTab {
  return { lastAccessed: 0, ...over } as OpenTab;
}
function makeBookmark(url: string, categoryId = 'cat-1'): Bookmark {
  return {
    id: url, workspaceId: 'ws-1', categoryId, name: url, url,
    description: '', faviconUrl: '', contextCount: 0,
    hasEncryptedContext: false, createdAt: 0, updatedAt: 0,
  };
}

describe('TabList — 紧凑列表 + 跨分类去重', () => {
  it('渲染每个 tab 的 title 与 host', () => {
    const tabs = [
      makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' }),
      makeTab({ tabId: 2, url: 'https://vicohu.com', title: '博客' }),
    ];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} />,
    );
    expect(screen.getByText('示例页')).toBeTruthy();
    expect(screen.getByText('example.com')).toBeTruthy();
    expect(screen.getByText('博客')).toBeTruthy();
  });

  it('tabs 为空 → 空状态文案', () => {
    render(
      <TabList tabs={[]} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} />,
    );
    expect(screen.getByText('当前窗口没有其他标签页')).toBeTruthy();
  });

  it('跨分类命中书签 → 显示「已收藏」且存为书签按钮禁用', () => {
    // 书签在 cat-2,当前分类 cat-1 → 跨分类去重仍应命中
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' })];
    const bookmarks = [makeBookmark('https://example.com', 'cat-2')];
    render(
      <TabList tabs={tabs} bookmarks={bookmarks} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} />,
    );
    // 「已收藏」是 role=img 的 aria-label 角标
    expect(screen.getByRole('img', { name: '已收藏' })).toBeTruthy();
    // Semi Button 带 icon → accessible name 含图标,用 regex 匹配文本部分
    const saveBtn = screen.getByRole('button', { name: /存为书签/ });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('未命中 + 已选分类 → 存为书签按钮可用', () => {
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' })];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} />,
    );
    const saveBtn = screen.getByRole('button', { name: /存为书签/ });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('未选分类 → 存为书签按钮禁用', () => {
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' })];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId={undefined}
        onTabClick={() => {}} onSaveTab={() => {}} />,
    );
    const saveBtn = screen.getByRole('button', { name: /存为书签/ });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('点击存为书签 → 调用 onSaveTab,不触发行点击', () => {
    const onTabClick = vi.fn();
    const onSaveTab = vi.fn();
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' })];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={onTabClick} onSaveTab={onSaveTab} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /存为书签/ }));
    expect(onSaveTab).toHaveBeenCalledTimes(1);
    expect(onTabClick).not.toHaveBeenCalled();
  });

  it('pinned tab 显示固定角标', () => {
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com', title: '钉', pinned: true })];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} />,
    );
    expect(screen.getByLabelText('已固定')).toBeTruthy();
  });

  it('异常 scheme favIconUrl → 不渲染该 img(回退首字母)', () => {
    const tabs = [
      makeTab({ tabId: 1, url: 'https://example.com', title: '示例', favIconUrl: 'javascript:alert(1)' }),
    ];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} />,
    );
    // 不应有 src 为 javascript: 的 img
    const unsafe = document.querySelector('img[src="javascript:alert(1)"]');
    expect(unsafe).toBeNull();
    // 回退首字母
    expect(screen.getByText('示')).toBeTruthy();
  });

  it('按传入顺序渲染(排序职责归 useOpenTabs,TabList 为纯展示)', () => {
    // TabList 不再自行排序;列表与浏览器 tab 栏顺序一致由 useOpenTabs 保证(见其用例)。
    const tabs = [
      makeTab({ tabId: 1, url: 'https://a.com', title: 'A', index: 0 }),
      makeTab({ tabId: 2, url: 'https://b.com', title: 'B', index: 1 }),
      makeTab({ tabId: 3, url: 'https://c.com', title: 'C', index: 2 }),
    ];
    const { container } = render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} />,
    );
    const items = container.querySelectorAll('[role="listitem"]');
    expect(items.length).toBe(3);
    expect(items[0]?.getAttribute('aria-label')).toBe('A');
    expect(items[1]?.getAttribute('aria-label')).toBe('B');
    expect(items[2]?.getAttribute('aria-label')).toBe('C');
  });

  it('点击第 N 项 → onTabClick 收到对应位置的 tab(tabId 绑定)', () => {
    const onTabClick = vi.fn();
    const tabs = [
      makeTab({ tabId: 10, url: 'https://a.com', title: 'A', index: 0 }),
      makeTab({ tabId: 20, url: 'https://b.com', title: 'B', index: 1 }),
    ];
    const { container } = render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={onTabClick} onSaveTab={() => {}} />,
    );
    const items = container.querySelectorAll('[role="listitem"]');
    fireEvent.click(items[1]!); // 点第二项(B,index1,tabId20)
    expect(onTabClick).toHaveBeenCalledWith(expect.objectContaining({ tabId: 20, index: 1 }));
  });
});
