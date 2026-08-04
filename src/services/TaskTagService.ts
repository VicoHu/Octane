import { broadcastChange, getDB } from '@/shared/db/database';
import { normalizeTodoName, validateTaskTagName } from '@/shared/tasks/taskRules';
import type { TaskTag, TodoColor } from '@/shared/types';
import { nextOrder, validateOrderedIds } from '@/shared/utils/order';

export interface TaskTagInput {
  name: string;
  color: TodoColor;
}

export interface TaskTagPatch {
  name?: string;
  color?: TodoColor;
}

function generateId(): string {
  return crypto.randomUUID();
}

function requireName(value: string): { name: string; normalizedName: string } {
  const normalized = validateTaskTagName(value);
  if (!normalized) {
    if (normalizeTodoName(value)) throw new Error('标签名称最多 32 个字符');
    throw new Error('标签名称不能为空');
  }
  return normalized;
}

function isConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'ConstraintError';
}

function asTaskTag(record: TaskTag | undefined): TaskTag {
  if (!record) throw new Error('标签不存在');
  return record;
}

/** 创建 Workspace 所属 Task Tag，名称唯一性由复合 unique index 最终保证。 */
export async function createTaskTag(workspaceId: string, input: TaskTagInput): Promise<TaskTag> {
  const { name, normalizedName } = requireName(input.name);
  const db = await getDB();
  const tx = db.transaction(['workspaces', 'taskTags'], 'readwrite');

  try {
    const workspace = await tx.objectStore('workspaces').get(workspaceId);
    if (!workspace) throw new Error('工作区不存在');

    const store = tx.objectStore('taskTags');
    const existing = await store.index('by-workspaceId').getAll(workspaceId);
    const now = Date.now();
    const taskTag: TaskTag = {
      id: generateId(),
      workspaceId,
      name,
      normalizedName,
      color: input.color,
      order: nextOrder(existing),
      createdAt: now,
      updatedAt: now,
    };
    await store.put(taskTag);
    await tx.done;
    broadcastChange('taskTags', 'put');
    return taskTag;
  } catch (error) {
    await tx.done.catch(() => undefined);
    if (isConstraintError(error)) throw new Error('该工作区已存在同名标签');
    throw error;
  }
}

/** 更新 Task Tag 名称或颜色。 */
export async function updateTaskTag(taskTagId: string, patch: TaskTagPatch): Promise<TaskTag> {
  const nameUpdate = patch.name === undefined ? undefined : requireName(patch.name);
  const db = await getDB();
  const tx = db.transaction('taskTags', 'readwrite');

  try {
    const store = tx.objectStore('taskTags');
    const existing = asTaskTag(await store.get(taskTagId));
    const updated: TaskTag = {
      ...existing,
      ...(nameUpdate ?? {}),
      ...(patch.color === undefined ? {} : { color: patch.color }),
      updatedAt: Date.now(),
    };
    await store.put(updated);
    await tx.done;
    broadcastChange('taskTags', 'put');
    return updated;
  } catch (error) {
    await tx.done.catch(() => undefined);
    if (isConstraintError(error)) throw new Error('该工作区已存在同名标签');
    throw error;
  }
}

/** 统计仍可见的关联 Task，Deleted Task 不计入删除影响。 */
export async function getTaskTagDeleteImpact(taskTagId: string): Promise<{ affectedTaskCount: number }> {
  const db = await getDB();
  const tx = db.transaction(['taskTags', 'taskTagAssignments', 'tasks'], 'readonly');
  asTaskTag(await tx.objectStore('taskTags').get(taskTagId));
  const assignments = await tx.objectStore('taskTagAssignments').index('by-tagId').getAll(taskTagId);
  const taskIds = new Set(assignments.map((assignment) => assignment.taskId));
  let affectedTaskCount = 0;
  const taskStore = tx.objectStore('tasks');
  for (const taskId of taskIds) {
    const task = await taskStore.get(taskId);
    if (task && task.deletedAt === null) affectedTaskCount++;
  }
  await tx.done;
  return { affectedTaskCount };
}

/** 在一个事务中删除 Tag 和关联 Assignment，不修改 Task。 */
export async function deleteTaskTag(taskTagId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['taskTags', 'taskTagAssignments'], 'readwrite');
  const tagStore = tx.objectStore('taskTags');
  const assignmentStore = tx.objectStore('taskTagAssignments');
  asTaskTag(await tagStore.get(taskTagId));
  const assignments = await assignmentStore.index('by-tagId').getAll(taskTagId);
  for (const assignment of assignments) {
    await assignmentStore.delete([assignment.taskId, assignment.tagId]);
  }
  await tagStore.delete(taskTagId);
  await tx.done;
  broadcastChange('taskTags', 'delete');
}

/** 在同一 Workspace 内对 Task Tag 完整重编号。 */
export async function reorderTaskTags(workspaceId: string, orderedIds: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('taskTags', 'readwrite');
  const store = tx.objectStore('taskTags');
  const existing = await store.index('by-workspaceId').getAll(workspaceId);
  const error = validateOrderedIds(orderedIds, existing.map((taskTag) => taskTag.id));
  if (error) throw new Error(error);

  const byId = new Map(existing.map((taskTag) => [taskTag.id, taskTag]));
  const now = Date.now();
  for (let index = 0; index < orderedIds.length; index++) {
    const taskTag = byId.get(orderedIds[index]!)!;
    await store.put({ ...taskTag, order: index, updatedAt: now });
  }
  await tx.done;
  broadcastChange('taskTags', 'put');
}
