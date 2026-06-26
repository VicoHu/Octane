import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock WorkspaceService / CategoryService
const ws = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  updateWorkspace: vi.fn(),
}));
vi.mock('@/services/WorkspaceService', () => ws);

const cat = vi.hoisted(() => ({
  listCategories: vi.fn(),
  updateCategory: vi.fn(),
}));
vi.mock('@/services/CategoryService', () => cat);

import { useWorkspace } from '@/store/useWorkspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaces: [],
    currentWorkspaceId: null,
    categories: [],
    currentCategoryId: null,
    loading: false,
  });
  ws.listWorkspaces.mockReset();
  ws.updateWorkspace.mockReset();
  cat.listCategories.mockReset();
  cat.updateCategory.mockReset();
});

describe('useWorkspace — updateWorkspace', () => {
  it('调用 Service 并同步本地 workspaces', async () => {
    useWorkspace.setState({
      workspaces: [
        { id: 'w1', name: '旧名', icon: '📁', createdAt: 1, order: 0 },
      ],
      currentWorkspaceId: 'w1',
    });

    const { updateWorkspace } = useWorkspace.getState();
    await updateWorkspace('w1', { name: '新名', icon: '🚀' });

    expect(ws.updateWorkspace).toHaveBeenCalledWith('w1', { name: '新名', icon: '🚀' });
    const updated = useWorkspace.getState().workspaces.find((w) => w.id === 'w1');
    expect(updated?.name).toBe('新名');
    expect(updated?.icon).toBe('🚀');
  });

  it('保留未更新字段（createdAt / order）', async () => {
    useWorkspace.setState({
      workspaces: [
        { id: 'w1', name: '旧名', icon: '📁', createdAt: 99, order: 2 },
      ],
      currentWorkspaceId: 'w1',
    });

    await useWorkspace.getState().updateWorkspace('w1', { icon: '📚' });

    const updated = useWorkspace.getState().workspaces.find((w) => w.id === 'w1');
    expect(updated?.createdAt).toBe(99);
    expect(updated?.order).toBe(2);
    expect(updated?.name).toBe('旧名');
  });
});

describe('useWorkspace — updateCategory', () => {
  it('调用 Service 并同步本地 categories', async () => {
    useWorkspace.setState({
      currentWorkspaceId: 'w1',
      categories: [
        { id: 'c1', workspaceId: 'w1', name: '旧', icon: '📂', order: 0, createdAt: 1 },
      ],
      currentCategoryId: 'c1',
    });

    const { updateCategory } = useWorkspace.getState();
    await updateCategory('c1', { name: '新', icon: '🎯' });

    expect(cat.updateCategory).toHaveBeenCalledWith('c1', { name: '新', icon: '🎯' });
    const updated = useWorkspace.getState().categories.find((c) => c.id === 'c1');
    expect(updated?.name).toBe('新');
    expect(updated?.icon).toBe('🎯');
  });
});
