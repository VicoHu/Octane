import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTodoView } from '@/store/useTodoView';

beforeEach(() => {
  useTodoView.getState().reset();
});

describe('useTodoView — 默认页面状态', () => {
  it('新 New Tab 默认当前工作区、今天和 active', () => {
    const { result } = renderHook(() => useTodoView());

    expect(result.current.scopeMode).toBe('current');
    expect(result.current.view).toEqual({ kind: 'today' });
    expect(result.current.statusFilter).toBe('active');
  });
});

describe('useTodoView — 范围与视图规则', () => {
  it('切换所有工作区时具体清单视图回退到今天', () => {
    const { result } = renderHook(() => useTodoView());

    act(() => {
      result.current.setView({ kind: 'list', listId: 'list-1' });
      result.current.setScopeMode('all');
    });

    expect(result.current.scopeMode).toBe('all');
    expect(result.current.view).toEqual({ kind: 'today' });
  });

  it('切换所有工作区时具体标签视图回退到今天', () => {
    const { result } = renderHook(() => useTodoView());

    act(() => {
      result.current.setView({ kind: 'tag', tagId: 'tag-1' });
      result.current.setScopeMode('all');
    });

    expect(result.current.view).toEqual({ kind: 'today' });
  });

  it('App Rail 选择工作区时具体归档清单回退今天，系统视图保留', () => {
    const { result } = renderHook(() => useTodoView());

    act(() => {
      result.current.setScopeMode('all');
      result.current.setView({ kind: 'archivedList', listId: 'list-1' });
      result.current.onWorkspaceSelected('workspace-2');
    });

    expect(result.current.scopeMode).toBe('current');
    expect(result.current.view).toEqual({ kind: 'today' });

    act(() => {
      result.current.setView({ kind: 'inbox' });
      result.current.onWorkspaceSelected('workspace-2');
    });

    expect(result.current.view).toEqual({ kind: 'inbox' });
  });

  it('App Rail 选择工作区时清除不属于目标工作区的选中任务', () => {
    const { result } = renderHook(() => useTodoView());

    act(() => {
      result.current.selectTask('task-1');
      result.current.onWorkspaceSelected('workspace-2', 'workspace-1');
    });

    expect(result.current.selectedTaskId).toBeNull();
  });
});

describe('useTodoView — 状态筛选约束', () => {
  it('Today 与 Next7 始终重置为 active', () => {
    const { result } = renderHook(() => useTodoView());

    act(() => {
      result.current.setStatusFilter('completed');
      result.current.setView({ kind: 'today' });
    });
    expect(result.current.statusFilter).toBe('active');

    act(() => {
      result.current.setStatusFilter('all');
      result.current.setView({ kind: 'next7' });
    });
    expect(result.current.statusFilter).toBe('active');
  });

  it('Trash 保留三值筛选状态，由视图语义固定展示 deleted', () => {
    const { result } = renderHook(() => useTodoView());

    act(() => {
      result.current.setView({ kind: 'inbox' });
      result.current.setStatusFilter('completed');
      result.current.setView({ kind: 'trash' });
    });

    expect(result.current.statusFilter).toBe('completed');
    expect(result.current.view.kind).toBe('trash');
  });
});
