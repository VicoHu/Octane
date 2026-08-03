import { create } from 'zustand';
import type { TodoView } from '@/services/TodoQueryService';
import type { TaskPriority } from '@/shared/types';

type ScopeMode = 'current' | 'all';
type StatusFilter = 'active' | 'completed' | 'all';
type SortMode = 'manual' | 'dueDate' | 'priority' | 'createdAt';

interface TodoViewState {
  scopeMode: ScopeMode;
  view: TodoView;
  selectedTaskId: string | null;
  statusFilter: StatusFilter;
  priorityFilter: TaskPriority | 'all';
  searchQuery: string;
  sortMode: SortMode;
  mobileDetailOpen: boolean;
  todoNavOpen: boolean;
  detailSplitPercent: number | null;

  setScopeMode: (scopeMode: ScopeMode) => void;
  setView: (view: TodoView) => void;
  selectTask: (taskId: string | null) => void;
  setStatusFilter: (statusFilter: StatusFilter) => void;
  setPriorityFilter: (priorityFilter: TaskPriority | 'all') => void;
  setSearchQuery: (searchQuery: string) => void;
  setSortMode: (sortMode: SortMode) => void;
  setMobileDetailOpen: (mobileDetailOpen: boolean) => void;
  setTodoNavOpen: (todoNavOpen: boolean) => void;
  setDetailSplitPercent: (detailSplitPercent: number | null) => void;
  onWorkspaceSelected: (workspaceId: string, selectedTaskWorkspaceId?: string) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  scopeMode: 'current' as ScopeMode,
  view: { kind: 'today' } as TodoView,
  selectedTaskId: null,
  statusFilter: 'active' as StatusFilter,
  priorityFilter: 'all' as TaskPriority | 'all',
  searchQuery: '',
  sortMode: 'manual' as SortMode,
  mobileDetailOpen: false,
  todoNavOpen: false,
  detailSplitPercent: null,
};

function isSpecificView(view: TodoView): boolean {
  return view.kind === 'list' || view.kind === 'tag' || view.kind === 'archivedList';
}

function isActiveOnlyView(view: TodoView): boolean {
  return view.kind === 'today' || view.kind === 'next7';
}

export const useTodoView = create<TodoViewState>((set, get) => ({
  ...INITIAL_STATE,

  setScopeMode: (scopeMode) => {
    const view = scopeMode === 'all' && isSpecificView(get().view)
      ? { kind: 'today' } as TodoView
      : get().view;
    set({ scopeMode, view, ...(isActiveOnlyView(view) ? { statusFilter: 'active' } : {}) });
  },

  setView: (view) => {
    set({ view, ...(isActiveOnlyView(view) ? { statusFilter: 'active' } : {}) });
  },

  selectTask: (taskId) => set({ selectedTaskId: taskId }),

  setStatusFilter: (statusFilter) => {
    if (isActiveOnlyView(get().view)) {
      set({ statusFilter: 'active' });
      return;
    }
    set({ statusFilter });
  },

  setPriorityFilter: (priorityFilter) => set({ priorityFilter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSortMode: (sortMode) => set({ sortMode }),
  setMobileDetailOpen: (mobileDetailOpen) => set({ mobileDetailOpen }),
  setTodoNavOpen: (todoNavOpen) => set({ todoNavOpen }),
  setDetailSplitPercent: (detailSplitPercent) => set({ detailSplitPercent }),

  onWorkspaceSelected: (workspaceId, selectedTaskWorkspaceId) => {
    const view = isSpecificView(get().view) ? { kind: 'today' } as TodoView : get().view;
    set({
      scopeMode: 'current',
      view,
      ...(isActiveOnlyView(view) ? { statusFilter: 'active' } : {}),
      ...(selectedTaskWorkspaceId !== undefined && selectedTaskWorkspaceId !== workspaceId
        ? { selectedTaskId: null }
        : {}),
    });
  },

  reset: () => set(INITIAL_STATE),
}));
