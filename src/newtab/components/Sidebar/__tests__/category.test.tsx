import { describe, it, expect, vi, beforeEach } from 'vitest';
// Semi 加载动画依赖 lottie-web；jsdom 无 canvas，mock 掉
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
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ passwordSet: false, unlocked: false, openUnlockModal: vi.fn(), lockSession: vi.fn() }),
}));
vi.mock('@/services/cloud/providers', () => ({
  getCloudProvider: (id: string) => ({ id, label: id, configFields: [] }),
}));
vi.mock('@/services/CloudStorageService', () => ({ getLastBackupAt: () => Promise.resolve(null) }));

import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '@/newtab/components/Sidebar';
import { useWorkspace } from '@/store/useWorkspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }],
    categories: [],
    currentWorkspaceId: 'w1',
    currentCategoryId: null,
  });
});

describe('Sidebar 分类列表（Semi List 迁移）', () => {
  it('空分类显示「暂无分类」', () => {
    render(<Sidebar />);
    expect(screen.getByText('暂无分类')).toBeTruthy();
  });

  it('渲染分类项（List.Item main）', () => {
    useWorkspace.setState({
      categories: [{ id: 'c1', name: '工作', icon: '💼' }],
      currentCategoryId: 'c1',
      currentWorkspaceId: 'w1',
      workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }],
    });
    render(<Sidebar />);
    expect(screen.getByText('💼 工作')).toBeTruthy();
  });

  it('点击分类项联动 selectCategory', () => {
    useWorkspace.setState({
      categories: [{ id: 'c2', name: '生活', icon: '🏠' }],
      currentCategoryId: null,
      currentWorkspaceId: 'w1',
      workspaces: [{ id: 'w1', name: '主工作区', icon: '📁' }],
    });
    const selectCategory = vi.fn();
    useWorkspace.setState({ selectCategory });
    render(<Sidebar />);
    fireEvent.click(screen.getByText('🏠 生活'));
    expect(selectCategory).toHaveBeenCalledWith('c2');
  });
});
