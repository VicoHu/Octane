import { create } from 'zustand';
import * as TodoQueryService from '@/services/TodoQueryService';
import * as TaskService from '@/services/TaskService';
import type {
  TaskDetail,
  TaskQuery,
  TaskQueryResult,
  TodoNavigationSnapshot,
  WorkspaceScope,
} from '@/services/TodoQueryService';
import type {
  CreateTaskInput,
  MoveTaskInput,
  PatchTaskInput,
  TaskCompletionResult,
} from '@/services/TaskService';
import type { Task } from '@/shared/types';

type Mutation = { kind: string; entityId?: string } | null;
type RefreshSlice = 'navigation' | 'query' | 'detail';

interface TodoDataState {
  navigation: TodoNavigationSnapshot | null;
  queryResult: TaskQueryResult | null;
  detail: TaskDetail | null;
  navigationLoading: boolean;
  queryLoading: boolean;
  detailLoading: boolean;
  mutation: Mutation;
  invalidated: boolean;

  loadNavigation: (scope: WorkspaceScope, today: string) => Promise<void>;
  loadQuery: (query: TaskQuery) => Promise<void>;
  loadDetail: (taskId: string) => Promise<void>;
  invalidate: () => void;
  createTask: (input: CreateTaskInput) => Promise<Task>;
  patchTask: (taskId: string, patch: PatchTaskInput) => Promise<Task>;
  setTaskCompletion: (
    taskId: string,
    completed: boolean,
    options?: { allowIncompleteChecklist?: boolean },
  ) => Promise<TaskCompletionResult>;
  replaceTaskTags: (taskId: string, tagIds: string[]) => Promise<void>;
  moveTask: (input: MoveTaskInput) => Promise<Task>;
  softDeleteTask: (taskId: string) => Promise<void>;
  restoreTask: (taskId: string) => Promise<Task>;
  deleteTaskPermanently: (taskId: string) => Promise<void>;
  emptyTrash: (scope: WorkspaceScope) => Promise<number>;
  reorderTasks: (workspaceId: string, listId: string | null, orderedIds: string[]) => Promise<void>;
  reset: () => void;
}

const INITIAL_STATE = {
  navigation: null,
  queryResult: null,
  detail: null,
  navigationLoading: false,
  queryLoading: false,
  detailLoading: false,
  mutation: null,
  invalidated: false,
};

let navigationSequence = 0;
let querySequence = 0;
let detailSequence = 0;
let lastNavigation: { scope: WorkspaceScope; today: string } | null = null;
let lastQuery: TaskQuery | null = null;
let lastDetailTaskId: string | null = null;

function resetRequestCache(): void {
  navigationSequence = 0;
  querySequence = 0;
  detailSequence = 0;
  lastNavigation = null;
  lastQuery = null;
  lastDetailTaskId = null;
}

export const useTodoData = create<TodoDataState>((set, get) => {
  const refresh = async (...slices: RefreshSlice[]): Promise<void> => {
    await Promise.all(slices.map((slice) => {
      if (slice === 'navigation' && lastNavigation) {
        return get().loadNavigation(lastNavigation.scope, lastNavigation.today);
      }
      if (slice === 'query' && lastQuery) return get().loadQuery(lastQuery);
      if (slice === 'detail' && lastDetailTaskId) return get().loadDetail(lastDetailTaskId);
      return undefined;
    }));
  };

  const runMutation = async <T>(
    kind: string,
    entityId: string | undefined,
    command: () => Promise<T>,
    refreshSlices: RefreshSlice[],
  ): Promise<T> => {
    const mutation = entityId === undefined ? { kind } : { kind, entityId };
    set({ mutation });
    try {
      const result = await command();
      await refresh(...refreshSlices);
      return result;
    } finally {
      if (get().mutation === mutation) set({ mutation: null });
    }
  };

  return {
    ...INITIAL_STATE,

    loadNavigation: async (scope, today) => {
      const sequence = ++navigationSequence;
      lastNavigation = { scope, today };
      set({ navigationLoading: true });
      try {
        const navigation = await TodoQueryService.loadNavigation(scope, today);
        if (sequence === navigationSequence) {
          set({ navigation, navigationLoading: false, invalidated: false });
        }
      } catch (error) {
        if (sequence === navigationSequence) set({ navigationLoading: false });
        throw error;
      }
    },

    loadQuery: async (query) => {
      const sequence = ++querySequence;
      lastQuery = query;
      set({ queryLoading: true });
      try {
        const queryResult = await TodoQueryService.queryTasks(query);
        if (sequence === querySequence) {
          set({ queryResult, queryLoading: false, invalidated: false });
        }
      } catch (error) {
        if (sequence === querySequence) set({ queryLoading: false });
        throw error;
      }
    },

    loadDetail: async (taskId) => {
      const sequence = ++detailSequence;
      lastDetailTaskId = taskId;
      set({ detailLoading: true });
      try {
        const detail = await TodoQueryService.getTaskDetail(taskId);
        if (sequence === detailSequence) {
          set({ detail, detailLoading: false, invalidated: false });
        }
      } catch (error) {
        if (sequence === detailSequence) set({ detailLoading: false });
        throw error;
      }
    },

    invalidate: () => set({ invalidated: true }),

    createTask: (input) => runMutation('createTask', undefined, () => TaskService.createTask(input), ['navigation', 'query']),
    patchTask: (taskId, patch) => runMutation('patchTask', taskId, () => TaskService.patchTask(taskId, patch), ['query', 'detail']),
    setTaskCompletion: async (taskId, completed, options) => {
      const mutation = { kind: 'setTaskCompletion', entityId: taskId };
      set({ mutation });
      try {
        const result = await TaskService.setTaskCompletion(taskId, completed, options);
        if (result.status === 'updated') await refresh('navigation', 'query', 'detail');
        return result;
      } finally {
        if (get().mutation === mutation) set({ mutation: null });
      }
    },
    replaceTaskTags: (taskId, tagIds) =>
      runMutation('replaceTaskTags', taskId, () => TaskService.replaceTaskTags(taskId, tagIds), ['navigation', 'query', 'detail']),
    moveTask: (input) => runMutation('moveTask', input.taskId, () => TaskService.moveTask(input), ['navigation', 'query', 'detail']),
    softDeleteTask: (taskId) =>
      runMutation('softDeleteTask', taskId, () => TaskService.softDeleteTask(taskId), ['navigation', 'query', 'detail']),
    restoreTask: (taskId) =>
      runMutation('restoreTask', taskId, () => TaskService.restoreTask(taskId), ['navigation', 'query', 'detail']),
    deleteTaskPermanently: (taskId) =>
      runMutation('deleteTaskPermanently', taskId, () => TaskService.deleteTaskPermanently(taskId), ['navigation', 'query', 'detail']),
    emptyTrash: (scope) => runMutation('emptyTrash', undefined, () => TaskService.emptyTrash(scope), ['navigation', 'query', 'detail']),

    reorderTasks: async (workspaceId, listId, orderedIds) => {
      const previousQueryResult = get().queryResult;
      const active = previousQueryResult?.active ?? [];
      const rowsById = new Map(active.map((row) => [row.id, row]));
      if (active.length === orderedIds.length && orderedIds.every((id) => rowsById.has(id))) {
        set({
          queryResult: {
            ...previousQueryResult!,
            active: orderedIds.map((id, order) => {
              const row = rowsById.get(id)!;
              return { ...row, task: { ...row.task, order } };
            }),
          },
        });
      }

      const mutation = { kind: 'reorderTasks', entityId: workspaceId };
      set({ mutation });
      try {
        await TaskService.reorderTasks(workspaceId, listId, orderedIds);
      } catch (error) {
        set({ queryResult: previousQueryResult });
        throw error;
      } finally {
        if (get().mutation === mutation) set({ mutation: null });
      }
      await refresh('query');
    },

    reset: () => {
      resetRequestCache();
      set(INITIAL_STATE);
    },
  };
});
