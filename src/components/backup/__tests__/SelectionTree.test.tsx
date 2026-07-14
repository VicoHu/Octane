import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectionTree } from '@/components/backup/SelectionTree';
import type { Bookmark, Category, Workspace } from '@/shared/types';

const workspaces: Workspace[] = [
  { id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 },
];
const categories: Category[] = [
  { id: 'cat-1a', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 },
  { id: 'cat-1b', workspaceId: 'ws-1', name: '文档', icon: '📂', order: 1, createdAt: 1 },
];
const bookmarks: Bookmark[] = [
  { id: 'bm-1a', workspaceId: 'ws-1', categoryId: 'cat-1a', name: 'A', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1, order: 0 },
  { id: 'bm-1b', workspaceId: 'ws-1', categoryId: 'cat-1a', name: 'B', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1, order: 0 },
];

describe('SelectionTree — Semi Tree 勾选产出 ShareSelection', () => {
  it('渲染工作区与分类节点(含书签数)', () => {
    render(
      <SelectionTree workspaces={workspaces} categories={categories} bookmarks={bookmarks}
        value={{ workspaceIds: [], categoryIds: [] }} onChange={() => {}} />,
    );
    expect(screen.getByText(/工作/)).toBeInTheDocument();
    expect(screen.getByText(/工具/)).toBeInTheDocument();
    // 分类书签数 (2)
    expect(screen.getByText(/工具.*2|2.*工具|\(2\)/)).toBeInTheDocument();
  });

  it('勾选工作区节点 → onChange 产 { workspaceIds:[ws-1], categoryIds:[] }（autoMergeValue 只回父 key）', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectionTree workspaces={workspaces} categories={categories} bookmarks={bookmarks}
        value={{ workspaceIds: [], categoryIds: [] }} onChange={onChange} />,
    );
    // 点工作区节点的 checkbox（Semi Tree treeitem 内含 checkbox）
    const wsCheckbox = screen.getAllByRole('checkbox')[0]!;
    await user.click(wsCheckbox);
    // autoMergeValue 默认 true：整选父 → onChange 只含父 key（不含子 cat key）
    expect(onChange).toHaveBeenCalledWith({ workspaceIds: ['ws-1'], categoryIds: [] });
  });

  it('勾选分类节点(父未选) → onChange 产 { workspaceIds:[], categoryIds:[cat-1a] }', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectionTree workspaces={workspaces} categories={categories} bookmarks={bookmarks}
        value={{ workspaceIds: [], categoryIds: [] }} onChange={onChange} />,
    );
    // checkbox 顺序：[0]=工作区, [1]=工具, [2]=文档
    const catCheckbox = screen.getAllByRole('checkbox')[1]!;
    await user.click(catCheckbox);
    expect(onChange).toHaveBeenCalledWith({ workspaceIds: [], categoryIds: ['cat-1a'] });
  });

  it('受控回显：value 含 workspaceIds 时对应 checkbox 为 checked', () => {
    render(
      <SelectionTree workspaces={workspaces} categories={categories} bookmarks={bookmarks}
        value={{ workspaceIds: ['ws-1'], categoryIds: [] }} onChange={() => {}} />,
    );
    const wsCheckbox = screen.getAllByRole('checkbox')[0]!;
    expect(wsCheckbox).toBeChecked();
  });
});
