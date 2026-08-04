import { describe, expect, it } from 'vitest';
import {
  PRIORITY_RANK,
  compareStableTaskOrder,
  isTaskDragEnabled,
  normalizeTodoName,
  taskContainerKey,
  validateDueDate,
  validateTaskTagName,
  type StableTaskOrderKey,
} from '@/shared/tasks/taskRules';

const baseOrderKey: StableTaskOrderKey = {
  workspaceOrder: 0,
  listId: null,
  listOrder: 0,
  order: 0,
  createdAt: 1,
  id: 'a',
};

describe('待办名称规则', () => {
  it('规范化名称会去除首尾空白并生成小写键', () => {
    expect(normalizeTodoName('  Project Alpha  ')).toEqual({
      name: 'Project Alpha',
      normalizedName: 'project alpha',
    });
  });

  it('空白名称返回 null', () => {
    expect(normalizeTodoName(' \t\n ')).toBeNull();
  });

  it('任务标签名称限制为最多 32 个字符', () => {
    expect(validateTaskTagName('a'.repeat(32))).toEqual({
      name: 'a'.repeat(32),
      normalizedName: 'a'.repeat(32),
    });
    expect(validateTaskTagName('a'.repeat(33))).toBeNull();
  });
});

describe('截止日期规则', () => {
  it('只接受真实的 YYYY-MM-DD 日历日期', () => {
    expect(validateDueDate('2026-02-30')).toBe(false);
    expect(validateDueDate('2026-13-01')).toBe(false);
    expect(validateDueDate('2026-02-29')).toBe(false);
    expect(validateDueDate('2024-02-29')).toBe(true);
    expect(validateDueDate('2026-2-01')).toBe(false);
    expect(validateDueDate('2026/02/01')).toBe(false);
  });
});

describe('任务容器键', () => {
  it('收件箱使用稳定字符串键且相同输入得到相同键', () => {
    expect(taskContainerKey('workspace-1', null)).toBe('["workspace-1",null]');
    expect(taskContainerKey('workspace-1', null)).toBe(taskContainerKey('workspace-1', null));
  });
});

describe('优先级顺序', () => {
  it('按 high、medium、low、none 递增', () => {
    expect(PRIORITY_RANK.high).toBeLessThan(PRIORITY_RANK.medium);
    expect(PRIORITY_RANK.medium).toBeLessThan(PRIORITY_RANK.low);
    expect(PRIORITY_RANK.low).toBeLessThan(PRIORITY_RANK.none);
  });
});

describe('稳定任务排序', () => {
  it('依次按工作区、收件箱、清单、任务顺序、创建时间和 id 比较', () => {
    const ordered: StableTaskOrderKey[] = [
      { ...baseOrderKey, id: 'list-later', listId: 'list-2', listOrder: 1 },
      { ...baseOrderKey, id: 'created-later', createdAt: 2 },
      { ...baseOrderKey, id: 'id-later' },
      { ...baseOrderKey, id: 'task-later', order: 1 },
      { ...baseOrderKey, id: 'workspace-later', workspaceOrder: 1 },
      { ...baseOrderKey, id: 'list-earlier', listId: 'list-1', listOrder: 0 },
      { ...baseOrderKey, id: 'inbox', listId: null, listOrder: 99 },
    ];

    expect(ordered.sort(compareStableTaskOrder).map((key) => key.id)).toEqual([
      'id-later',
      'inbox',
      'created-later',
      'task-later',
      'list-earlier',
      'list-later',
      'workspace-later',
    ]);
  });
});

describe('任务拖拽启用条件', () => {
  const enabledOptions = {
    workspaceCount: 1,
    containerCount: 1,
    sort: 'manual' as const,
    search: '  ',
    statusFilter: 'active' as const,
    priorityFilter: 'all' as const,
  };

  it('只在单工作区、单容器、手动、无搜索、活跃且无优先级筛选时启用', () => {
    expect(isTaskDragEnabled(enabledOptions)).toBe(true);
  });

  it.each([
    { workspaceCount: 2 },
    { containerCount: 2 },
    { sort: 'dueDate' as const },
    { search: 'needle' },
    { statusFilter: 'completed' as const },
    { priorityFilter: 'high' as const },
  ])('不满足限制时禁用：%o', (override) => {
    expect(isTaskDragEnabled({ ...enabledOptions, ...override })).toBe(false);
  });
});
