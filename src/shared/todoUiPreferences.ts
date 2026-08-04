type TodoSort = 'manual' | 'dueDate' | 'priority' | 'createdAt';

export interface TodoUiPreferences {
  detailSplitPercent: number | null;
  sortOverrides: Record<string, TodoSort>;
}

const DETAIL_SPLIT_PERCENT_KEY = 'todo.detailSplitPercent';
const SORT_OVERRIDES_KEY = 'todo.sortOverrides';
const VALID_SORTS = new Set<TodoSort>(['manual', 'dueDate', 'priority', 'createdAt']);

function asDetailSplitPercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asSortOverrides(value: unknown): Record<string, TodoSort> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, TodoSort] => VALID_SORTS.has(entry[1] as TodoSort)),
  );
}

/** 读取本机 UI 偏好；storage 损坏或不可用时返回默认值。 */
export async function loadTodoUiPreferences(): Promise<TodoUiPreferences> {
  try {
    const stored = await chrome.storage.local.get([DETAIL_SPLIT_PERCENT_KEY, SORT_OVERRIDES_KEY]);
    return {
      detailSplitPercent: asDetailSplitPercent(stored[DETAIL_SPLIT_PERCENT_KEY]),
      sortOverrides: asSortOverrides(stored[SORT_OVERRIDES_KEY]),
    };
  } catch {
    return { detailSplitPercent: null, sortOverrides: {} };
  }
}

/** 保存中右分栏比例；写入失败不影响当前页面会话。 */
export async function saveDetailSplitPercent(percent: number | null): Promise<void> {
  try {
    await chrome.storage.local.set({ [DETAIL_SPLIT_PERCENT_KEY]: percent });
  } catch {
    // 静默：内存中的布局状态仍可继续使用
  }
}

/** 保存指定视图的排序偏好；读写失败不影响当前页面会话。 */
export async function saveSortOverride(viewKey: string, sort: TodoSort): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(SORT_OVERRIDES_KEY);
    const sortOverrides = asSortOverrides(stored[SORT_OVERRIDES_KEY]);
    await chrome.storage.local.set({
      [SORT_OVERRIDES_KEY]: { ...sortOverrides, [viewKey]: sort },
    });
  } catch {
    // 静默：当前排序已由 Zustand 内存状态保存
  }
}
