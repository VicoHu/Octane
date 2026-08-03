import { describe, expect, it } from 'vitest';
import { validateBackup } from '@/services/BackupService';
import { BACKUP_SCHEMA } from '@/shared/types';

function makeV6File(dataOverride: Record<string, unknown> = {}, kind: 'backup' | 'share' = 'backup') {
  return {
    schema: BACKUP_SCHEMA,
    version: 6,
    kind,
    exportedAt: 1_700_000_000_000,
    appVersion: '0.2.4.0',
    data: {
      workspaces: [{ id: 'ws-1', name: '工作', icon: 'W', createdAt: 1, order: 0 }],
      categories: [],
      bookmarks: [],
      contexts: [],
      pinnedTabs: [],
      cryptoMetadata: null,
      taskLists: [{
        id: 'list-1', workspaceId: 'ws-1', name: '收集', normalizedName: '收集', color: 'green',
        order: 0, archivedAt: null, createdAt: 1, updatedAt: 1,
      }],
      taskTags: [{
        id: 'tag-1', workspaceId: 'ws-1', name: '工作', normalizedName: '工作', color: 'blue',
        order: 0, createdAt: 1, updatedAt: 1,
      }],
      tasks: [{
        id: 'task-1', workspaceId: 'ws-1', listId: 'list-1', containerKey: '["ws-1","list-1"]',
        title: '完成备份', description: '', priority: 'high', dueDate: '2026-08-03', status: 'active',
        order: 0, completedAt: null, deletedAt: null, createdAt: 1, updatedAt: 1,
      }],
      checklistItems: [{
        id: 'item-1', taskId: 'task-1', text: '核验', isCompleted: false,
        completedAt: null, order: 0, createdAt: 1, updatedAt: 1,
      }],
      taskTagAssignments: [{ taskId: 'task-1', tagId: 'tag-1', createdAt: 1 }],
      ...dataOverride,
    },
  };
}

describe('validateBackup — v6 待办数据', () => {
  it('合法 v6 全量备份 → 保留完整关系和恢复预览元数据', () => {
    const result = validateBackup(makeV6File());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toBe(6);
    expect(result.exportedAt).toBe(1_700_000_000_000);
    expect(result.appVersion).toBe('0.2.4.0');
    expect(result.containsTodoData).toBe(true);
    expect(result.isLegacyWithoutTodo).toBe(false);
    expect(result.data.taskTagAssignments).toEqual([{ taskId: 'task-1', tagId: 'tag-1', createdAt: 1 }]);
  });

  it('v6 缺少任一待办数组 → 拒绝', () => {
    const file = makeV6File();
    delete (file.data as Record<string, unknown>).tasks;

    expect(validateBackup(file).ok).toBe(false);
  });

  it.each([
    ['跨工作区 Task List', { taskLists: [{ ...makeV6File().data.taskLists[0], workspaceId: 'missing' }] }],
    ['非法 containerKey', { tasks: [{ ...makeV6File().data.tasks[0], containerKey: '["ws-1",null]' }] }],
    ['非法截止日期', { tasks: [{ ...makeV6File().data.tasks[0], dueDate: '2026-02-30' }] }],
    ['跨工作区 Assignment', { taskTags: [{ ...makeV6File().data.taskTags[0], workspaceId: 'other' }] }],
    ['不存在父 Task 的 Checklist', { checklistItems: [{ ...makeV6File().data.checklistItems[0], taskId: 'missing' }] }],
  ])('v6 %s → 拒绝', (_scenario, dataOverride) => {
    expect(validateBackup(makeV6File(dataOverride)).ok).toBe(false);
  });

  it('v5 旧备份 → 规范化为五个空待办集合并标记 legacy', () => {
    const legacy = makeV6File({}, 'backup');
    legacy.version = 5;
    delete (legacy.data as Record<string, unknown>).taskLists;
    delete (legacy.data as Record<string, unknown>).tasks;
    delete (legacy.data as Record<string, unknown>).checklistItems;
    delete (legacy.data as Record<string, unknown>).taskTags;
    delete (legacy.data as Record<string, unknown>).taskTagAssignments;

    const result = validateBackup(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tasks).toEqual([]);
    expect(result.containsTodoData).toBe(false);
    expect(result.isLegacyWithoutTodo).toBe(true);
  });

  it('v6 分享包携带待办数据 → 拒绝', () => {
    expect(validateBackup(makeV6File({}, 'share')).ok).toBe(false);
  });

  it('v6 分享包待办数组均为空 → 接受且不包含待办', () => {
    const result = validateBackup(makeV6File({
      taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [],
    }, 'share'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.containsTodoData).toBe(false);
  });
});
