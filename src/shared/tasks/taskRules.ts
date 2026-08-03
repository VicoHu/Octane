import type { TaskPriority } from '@/shared/types';

/** 稳定任务排序所需的已投影字段。 */
export interface StableTaskOrderKey {
  workspaceOrder: number;
  listId: string | null;
  listOrder: number;
  order: number;
  createdAt: number;
  id: string;
}

/** 任务拖拽是否可用的当前视图条件。 */
export interface TaskDragOptions {
  workspaceCount: number;
  containerCount: number;
  sort: 'manual' | 'dueDate' | 'priority' | 'createdAt';
  search: string;
  statusFilter: 'active' | 'completed' | 'all';
  priorityFilter: TaskPriority | 'all';
}

/** 去除名称首尾空白并生成大小写不敏感的比较键。 */
export function normalizeTodoName(value: string): { name: string; normalizedName: string } | null {
  const name = value.trim();
  if (name === '') return null;
  return { name, normalizedName: name.toLowerCase() };
}

/** 校验任务标签名称的长度限制。 */
export function validateTaskTagName(value: string): { name: string; normalizedName: string } | null {
  const normalized = normalizeTodoName(value);
  return normalized !== null && normalized.name.length <= 32 ? normalized : null;
}

/** 校验真实的本地 YYYY-MM-DD 日历日期。 */
export function validateDueDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year!, month! - 1, day!);

  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day;
}

/** 生成 Workspace 内 Inbox 或 Task List 的稳定容器键。 */
export function taskContainerKey(workspaceId: string, listId: string | null): string {
  return JSON.stringify([workspaceId, listId]);
}

/** Priority 升序排名。 */
export const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

/** 按 Workspace、容器及任务字段生成完全确定的升序排序。 */
export function compareStableTaskOrder(a: StableTaskOrderKey, b: StableTaskOrderKey): number {
  if (a.workspaceOrder !== b.workspaceOrder) return a.workspaceOrder - b.workspaceOrder;

  const aIsInbox = a.listId === null;
  const bIsInbox = b.listId === null;
  if (aIsInbox !== bIsInbox) return aIsInbox ? -1 : 1;
  if (!aIsInbox && a.listOrder !== b.listOrder) return a.listOrder - b.listOrder;
  if (a.order !== b.order) return a.order - b.order;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 仅在完整活跃容器的未筛选手动视图中允许拖拽。 */
export function isTaskDragEnabled(options: TaskDragOptions): boolean {
  return options.workspaceCount === 1
    && options.containerCount === 1
    && options.sort === 'manual'
    && options.search.trim() === ''
    && options.statusFilter === 'active'
    && options.priorityFilter === 'all';
}
