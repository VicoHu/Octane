import { create } from 'zustand';
import * as TodoQueryService from '@/services/TodoQueryService';
import * as TaskService from '@/services/TaskService';
import * as TaskListService from '@/services/TaskListService';
import * as TaskTagService from '@/services/TaskTagService';
import * as ChecklistItemService from '@/services/ChecklistItemService';
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
import type {
  TaskListArchiveResult,
  TaskListInput,
  TaskListPatch,
} from '@/services/TaskListService';
import type { TaskTagInput, TaskTagPatch } from '@/services/TaskTagService';
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
  invalidationEpoch: number;

  loadNavigation: (scope: WorkspaceScope, today: string) => Promise<TodoNavigationSnapshot | undefined>;
  loadQuery: (query: TaskQuery) => Promise<TaskQueryResult | undefined>;
  loadDetail: (taskId: string) => Promise<TaskDetail | null | undefined>;
  loadMoveOptions: (today: string) => Promise<TodoNavigationSnapshot>;
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
  createChecklistItem: (taskId: string, text: string) => Promise<void>;
  updateChecklistItem: (itemId: string, text: string) => Promise<void>;
  setChecklistItemCompletion: (itemId: string, completed: boolean) => Promise<void>;
  reorderChecklistItems: (taskId: string, orderedIds: string[]) => Promise<void>;
  deleteChecklistItem: (itemId: string) => Promise<void>;
  createTaskList: (workspaceId: string, input: TaskListInput) => Promise<void>;
  updateTaskList: (taskListId: string, patch: TaskListPatch) => Promise<void>;
  archiveTaskList: (taskListId: string, options?: { allowIncompleteTasks?: boolean }) => Promise<TaskListArchiveResult>;
  restoreTaskList: (taskListId: string) => Promise<void>;
  getTaskListDeleteImpact: (taskListId: string) => Promise<{ undeletedTaskCount: number; deletedTaskCount: number }>;
  deleteTaskListPermanently: (taskListId: string) => Promise<void>;
  reorderTaskLists: (workspaceId: string, orderedIds: string[]) => Promise<void>;
  createTaskTag: (workspaceId: string, input: TaskTagInput) => Promise<void>;
  updateTaskTag: (taskTagId: string, patch: TaskTagPatch) => Promise<void>;
  getTaskTagDeleteImpact: (taskTagId: string) => Promise<{ affectedTaskCount: number }>;
  deleteTaskTag: (taskTagId: string) => Promise<void>;
  reorderTaskTags: (workspaceId: string, orderedIds: string[]) => Promise<void>;
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
  invalidationEpoch: 0,
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
      const epoch = get().invalidationEpoch;
      lastNavigation = { scope, today };
      set({ navigationLoading: true });
      try {
        const navigation = await TodoQueryService.loadNavigation(scope, today);
        if (sequence !== navigationSequence || epoch !== get().invalidationEpoch) return undefined;
        set({ navigation, navigationLoading: false });
        return navigation;
      } catch (error) {
        if (sequence === navigationSequence && epoch === get().invalidationEpoch) {
          set({ navigationLoading: false });
        }
        throw error;
      }
    },

    loadQuery: async (query) => {
      const sequence = ++querySequence;
      const epoch = get().invalidationEpoch;
      lastQuery = query;
      set({ queryLoading: true });
      try {
        const queryResult = await TodoQueryService.queryTasks(query);
        if (sequence !== querySequence || epoch !== get().invalidationEpoch) return undefined;
        set({ queryResult, queryLoading: false });
        return queryResult;
      } catch (error) {
        if (sequence === querySequence && epoch === get().invalidationEpoch) {
          set({ queryLoading: false });
        }
        throw error;
      }
    },

    loadDetail: async (taskId) => {
      const sequence = ++detailSequence;
      const epoch = get().invalidationEpoch;
      lastDetailTaskId = taskId;
      set({ detailLoading: true });
      try {
        const detail = await TodoQueryService.getTaskDetail(taskId);
        if (sequence !== detailSequence || epoch !== get().invalidationEpoch) return undefined;
        set({ detail, detailLoading: false });
        return detail;
      } catch (error) {
        if (sequence === detailSequence && epoch === get().invalidationEpoch) {
          set({ detailLoading: false });
        }
        throw error;
      }
    },

    // Move 选项始终从 all-scope 读取，不能覆盖当前页面的导航/查询快照。
    loadMoveOptions: (today) => TodoQueryService.loadNavigation({ kind: 'all' }, today),

    invalidate: () => set((state) => ({ invalidationEpoch: state.invalidationEpoch + 1 })),

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

    createTaskList: async (workspaceId, input) => {
      await runMutation('createTaskList', workspaceId, () => TaskListService.createTaskList(workspaceId, input), ['navigation', 'query']);
    },
    updateTaskList: async (taskListId, patch) => {
      await runMutation('updateTaskList', taskListId, () => TaskListService.updateTaskList(taskListId, patch), ['navigation', 'query']);
    },
    archiveTaskList: async (taskListId, options) => {
      const mutation = { kind: 'archiveTaskList', entityId: taskListId };
      set({ mutation });
      try {
        const result = await TaskListService.archiveTaskList(taskListId, options);
        if (result.status === 'archived') await refresh('navigation', 'query');
        return result;
      } finally {
        if (get().mutation === mutation) set({ mutation: null });
      }
    },
    restoreTaskList: async (taskListId) => {
      await runMutation('restoreTaskList', taskListId, () => TaskListService.restoreTaskList(taskListId), ['navigation', 'query', 'detail']);
    },
    getTaskListDeleteImpact: (taskListId) => TaskListService.getTaskListDeleteImpact(taskListId),
    deleteTaskListPermanently: (taskListId) =>
      runMutation('deleteTaskListPermanently', taskListId, () => TaskListService.deleteTaskListPermanently(taskListId), ['navigation', 'query']),
    reorderTaskLists: (workspaceId, orderedIds) =>
      runMutation('reorderTaskLists', workspaceId, () => TaskListService.reorderTaskLists(workspaceId, orderedIds), ['navigation', 'query']),
    createTaskTag: async (workspaceId, input) => {
      await runMutation('createTaskTag', workspaceId, () => TaskTagService.createTaskTag(workspaceId, input), ['navigation', 'query']);
    },
    updateTaskTag: async (taskTagId, patch) => {
      await runMutation('updateTaskTag', taskTagId, () => TaskTagService.updateTaskTag(taskTagId, patch), ['navigation', 'query']);
    },
    getTaskTagDeleteImpact: (taskTagId) => TaskTagService.getTaskTagDeleteImpact(taskTagId),
    deleteTaskTag: (taskTagId) =>
      runMutation('deleteTaskTag', taskTagId, () => TaskTagService.deleteTaskTag(taskTagId), ['navigation', 'query']),
    reorderTaskTags: (workspaceId, orderedIds) =>
      runMutation('reorderTaskTags', workspaceId, () => TaskTagService.reorderTaskTags(workspaceId, orderedIds), ['navigation', 'query']),

    createChecklistItem: async (taskId, text) => {
      await runMutation('createChecklistItem', taskId, () => ChecklistItemService.createChecklistItem(taskId, text), ['query', 'detail']);
    },
    updateChecklistItem: async (itemId, text) => {
      await runMutation('updateChecklistItem', itemId, () => ChecklistItemService.updateChecklistItem(itemId, text), ['query', 'detail']);
    },
    setChecklistItemCompletion: async (itemId, completed) => {
      await runMutation('setChecklistItemCompletion', itemId, () => ChecklistItemService.setChecklistItemCompletion(itemId, completed), ['query', 'detail']);
    },
    reorderChecklistItems: async (taskId, orderedIds) => {
      await runMutation('reorderChecklistItems', taskId, () => ChecklistItemService.reorderChecklistItems(taskId, orderedIds), ['detail']);
    },
    deleteChecklistItem: async (itemId) => {
      await runMutation('deleteChecklistItem', itemId, () => ChecklistItemService.deleteChecklistItem(itemId), ['query', 'detail']);
    },

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
