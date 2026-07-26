import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabList } from '../index';
import type { OpenTab } from '../../../hooks/useOpenTabs';
import type { Bookmark, PinnedTab } from '@/shared/types';

function makeTab(over: Partial<OpenTab> & { tabId: number; url: string }): OpenTab {
  return { lastAccessed: 0, ...over } as OpenTab;
}
function makeBookmark(url: string, categoryId = 'cat-1'): Bookmark {
  return {
    id: url, workspaceId: 'ws-1', categoryId, name: url, url,
    description: '', faviconUrl: '', contextCount: 0,
    hasEncryptedContext: false, order: 0, createdAt: 0, updatedAt: 0, tags: [],
  };
}
function makePin(id: string, url: string): PinnedTab {
  return { id, workspaceId: 'ws-1', name: id, url, order: 0, createdAt: 0 };
}

describe('TabList — 紧凑列表 + 跨分类去重', () => {
  it.each(['{Enter}', ' '])('聚焦标签页主操作后按 %s 打开对应标签页', async (key) => {
    const user = userEvent.setup();
    const onTabClick = vi.fn();
    const tab = makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' });
    render(
      <TabList tabs={[tab]} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={onTabClick} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    const openButton = screen.getByRole('button', { name: '打开标签页 示例页' });

    openButton.focus();
    await user.keyboard(key);

    expect(onTabClick).toHaveBeenCalledWith(tab);
  });

  it('渲染每个 tab 的 title 与 host', () => {
    const tabs = [
      makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' }),
      makeTab({ tabId: 2, url: 'https://vicohu.com', title: '博客' }),
    ];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    expect(screen.getByText('示例页')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('博客')).toBeInTheDocument();
  });

  it('tabs 为空 → 空状态文案', () => {
    render(
      <TabList tabs={[]} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    expect(screen.getByText('当前窗口没有其他标签页')).toBeInTheDocument();
  });

  it('跨分类命中书签 → 显示「已收藏」且存为书签按钮禁用', () => {
    // 书签在 cat-2,当前分类 cat-1 → 跨分类去重仍应命中
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' })];
    const bookmarks = [makeBookmark('https://example.com', 'cat-2')];
    render(
      <TabList tabs={tabs} bookmarks={bookmarks} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    // 「已收藏」是 role=img 的 aria-label 角标
    expect(screen.getByRole('img', { name: '已收藏' })).toBeInTheDocument();
    // Semi Button 带 icon → accessible name 含图标,用 regex 匹配文本部分
    const saveBtn = screen.getByRole('button', { name: /存为书签/ });
    expect(saveBtn).toBeDisabled();
  });

  it('未命中 + 已选分类 → 存为书签按钮可用', () => {
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' })];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    const saveBtn = screen.getByRole('button', { name: /存为书签/ });
    expect(saveBtn).toBeEnabled();
  });

  it('未选分类 → 存为书签按钮禁用', () => {
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' })];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId={undefined}
        onTabClick={() => {}} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    const saveBtn = screen.getByRole('button', { name: /存为书签/ });
    expect(saveBtn).toBeDisabled();
  });

  it('点击存为书签 → 调用 onSaveTab,不触发行点击', async () => {
    const user = userEvent.setup();
    const onTabClick = vi.fn();
    const onSaveTab = vi.fn();
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com/page', title: '示例页' })];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={onTabClick} onSaveTab={onSaveTab} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: /存为书签/ }));
    expect(onSaveTab).toHaveBeenCalledTimes(1);
    expect(onTabClick).not.toHaveBeenCalled();
  });

  it('pinned tab 显示固定角标', () => {
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com', title: '钉', pinned: true })];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    expect(screen.getByLabelText('已固定')).toBeInTheDocument();
  });

  it('异常 scheme favIconUrl → 不渲染该 img(回退首字母)', () => {
    const tabs = [
      makeTab({ tabId: 1, url: 'https://example.com', title: '示例', favIconUrl: 'javascript:alert(1)' }),
    ];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    expect(screen.getByText('示')).toBeInTheDocument();
  });

  it('按传入顺序渲染(排序职责归 useOpenTabs,TabList 为纯展示)', () => {
    // TabList 不再自行排序;列表与浏览器 tab 栏顺序一致由 useOpenTabs 保证(见其用例)。
    const tabs = [
      makeTab({ tabId: 1, url: 'https://a.com', title: 'A', index: 0 }),
      makeTab({ tabId: 2, url: 'https://b.com', title: 'B', index: 1 }),
      makeTab({ tabId: 3, url: 'https://c.com', title: 'C', index: 2 }),
    ];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    const openButtons = screen.getAllByRole('button', { name: /打开标签页/ });
    expect(openButtons).toHaveLength(3);
    expect(openButtons[0]).toHaveAccessibleName('打开标签页 A');
    expect(openButtons[1]).toHaveAccessibleName('打开标签页 B');
    expect(openButtons[2]).toHaveAccessibleName('打开标签页 C');
  });

  it('点击第 N 项 → onTabClick 收到对应位置的 tab(tabId 绑定)', async () => {
    const user = userEvent.setup();
    const onTabClick = vi.fn();
    const tabs = [
      makeTab({ tabId: 10, url: 'https://a.com', title: 'A', index: 0 }),
      makeTab({ tabId: 20, url: 'https://b.com', title: 'B', index: 1 }),
    ];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={onTabClick} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: '打开标签页 B' }));
    expect(onTabClick).toHaveBeenCalledWith(expect.objectContaining({ tabId: 20, index: 1 }));
  });

  it('Cmd/Ctrl + 左键 → 将修饰键事件传给打开入口', async () => {
    const user = userEvent.setup();
    const onTabClick = vi.fn();
    const tab = makeTab({ tabId: 20, url: 'https://b.com', title: 'B' });
    render(
      <TabList tabs={[tab]} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={onTabClick} onSaveTab={() => {}} pinnedTabs={[]} onPinTab={() => {}} />,
    );

    const openButton = screen.getByRole('button', { name: '打开标签页 B' });
    await user.keyboard('[MetaLeft>]');
    await user.click(openButton);
    await user.keyboard('[/MetaLeft]');

    expect(onTabClick).toHaveBeenCalledWith(tab, expect.objectContaining({ metaKey: true }));
  });
});

describe('TabList — 存为常驻标签', () => {
  it('命中常驻标签(同规范 URL) → 按钮禁用', () => {
    const tabs = [makeTab({ tabId: 1, url: 'HTTPS://GitHub.com/foo?a=1#top', title: '示例' })];
    const pinnedTabs = [makePin('p1', 'https://github.com/foo?a=1')];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}}
        pinnedTabs={pinnedTabs} onPinTab={() => {}} />,
    );
    // 按钮用 aria-label=pinHint 提供 accessible name(icon-only)
    expect(screen.getByRole('button', { name: '已常驻' })).toBeDisabled();
  });

  it('未命中且未满 → 按钮可用', () => {
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com', title: '示例' })];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}}
        pinnedTabs={[]} onPinTab={() => {}} />,
    );
    expect(screen.getByRole('button', { name: '存为常驻标签' })).toBeEnabled();
  });

  it('cap 满(8) → 按钮禁用', () => {
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com', title: '示例' })];
    const pinnedTabs = Array.from({ length: 8 }, (_, i) => makePin(`p${i}`, `https://t${i}.com`));
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}}
        pinnedTabs={pinnedTabs} onPinTab={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /常驻已满/ })).toBeDisabled();
  });

  it('点击启用按钮 → 调用 onPinTab(对应 tab)', async () => {
    const user = userEvent.setup();
    const onPinTab = vi.fn();
    const tab = makeTab({ tabId: 7, url: 'https://example.com', title: '示例' });
    render(
      <TabList tabs={[tab]} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}}
        pinnedTabs={[]} onPinTab={onPinTab} />,
    );
    await user.click(screen.getByRole('button', { name: '存为常驻标签' }));
    expect(onPinTab).toHaveBeenCalledWith(tab);
  });
});
