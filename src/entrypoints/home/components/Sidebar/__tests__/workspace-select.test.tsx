import { describe, it, expect, vi } from 'vitest';
vi.mock('@/store/useCrypto', () => ({
  useCrypto: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ passwordSet: false, unlocked: false, openUnlockModal: vi.fn(), lockSession: vi.fn() }),
}));
vi.mock('@/services/cloud/providers', () => {
  const providers = {
    s3: { id: 's3', label: 'S3', configFields: [] },
    webdav: { id: 'webdav', label: 'WebDAV', configFields: [] },
  };
  return { cloudProviders: providers, getCloudProvider: (id: 's3' | 'webdav') => providers[id] };
});
vi.mock('@/services/CloudStorageService', () => ({ getLastBackupAt: () => Promise.resolve(null) }));
vi.mock('../../PinnedArea', () => ({ PinnedArea: () => null }));

import { render, screen, act, within } from '@testing-library/react';
import { Sidebar } from '../../Sidebar';
import { useWorkspace } from '@/store/useWorkspace';

describe('Sidebar 工作区下拉框（Base UI Select.Value children function）', () => {
  it('currentWorkspaceId 有值时 trigger 显示工作区名（非 id / 非 placeholder）', () => {
    useWorkspace.setState({
      workspaces: [
        { id: 'w1', name: '主工作区', icon: '📁', createdAt: 0, order: 0 },
        { id: 'w2', name: '副工作区', icon: '📂', createdAt: 0, order: 1 },
      ] as never,
      currentWorkspaceId: 'w2',
      categories: [],
      currentCategoryId: null,
    });
    render(<Sidebar openTabs={[]} />);
    const trigger = screen.getByRole('combobox');
    // 应渲染当前工作区名「副工作区」
    expect(within(trigger).getByText('副工作区')).toBeInTheDocument();
    // 不应回退到 placeholder
    expect(screen.queryByText('选择工作区')).not.toBeInTheDocument();
  });

  it('currentWorkspaceId 为 null（加载中/无工作区）时显示 placeholder', () => {
    useWorkspace.setState({
      workspaces: [] as never,
      currentWorkspaceId: null,
      categories: [],
      currentCategoryId: null,
    });
    render(<Sidebar openTabs={[]} />);
    expect(screen.getByText('选择工作区')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '当前工作区' })).not.toBeInTheDocument();
  });

  it('currentWorkspaceId 由 null 变为有效值（模拟 loadWorkspaces 完成）时，trigger 更新为工作区名', async () => {
    useWorkspace.setState({
      workspaces: [{ id: 'w1', name: '主工作区', icon: '📁', createdAt: 0, order: 0 }] as never,
      currentWorkspaceId: null,
      categories: [],
      currentCategoryId: null,
    });
    render(<Sidebar openTabs={[]} />);
    const trigger = screen.getByRole('combobox');
    // 加载中：placeholder
    expect(screen.getByText('选择工作区')).toBeInTheDocument();
    // loadWorkspaces 完成：store 设置 currentWorkspaceId，订阅的 Sidebar 自动重渲染
    act(() => {
      useWorkspace.setState({ currentWorkspaceId: 'w1' });
    });
    expect(within(trigger).getByText('主工作区')).toBeInTheDocument();
    expect(screen.queryByText('选择工作区')).not.toBeInTheDocument();
  });

  it('切换工作区 → 只读信息区同步显示当前工作区图标和名称', () => {
    useWorkspace.setState({
      workspaces: [
        { id: 'w1', name: '主工作区', icon: '📁', createdAt: 0, order: 0 },
        { id: 'w2', name: '副工作区', icon: '📂', createdAt: 0, order: 1 },
      ] as never,
      currentWorkspaceId: 'w2',
      categories: [],
      currentCategoryId: null,
    });
    render(<Sidebar openTabs={[]} />);
    const currentWorkspace = screen.getByRole('region', { name: '当前工作区' });

    expect(within(currentWorkspace).getByText('📂')).toBeInTheDocument();
    expect(within(currentWorkspace).getByText('副工作区')).toBeInTheDocument();

    act(() => {
      useWorkspace.setState({ currentWorkspaceId: 'w1' });
    });
    expect(within(currentWorkspace).getByText('📁')).toBeInTheDocument();
    expect(within(currentWorkspace).getByText('主工作区')).toBeInTheDocument();
  });
});
