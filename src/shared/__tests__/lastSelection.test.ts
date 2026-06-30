import { describe, it, expect } from 'vitest';
import {
  LAST_WS_KEY,
  LAST_CAT_BY_WS_KEY,
  resolveLastWs,
  resolveLastCat,
} from '@/shared/lastSelection';

describe('lastSelection 常量', () => {
  it('workspace 用全局 key，category 用 per-workspace map key', () => {
    expect(LAST_WS_KEY).toBe('lastWorkspaceId');
    expect(LAST_CAT_BY_WS_KEY).toBe('lastCategoryIdByWs');
  });
});

describe('resolveLastWs', () => {
  it('lastId 在列表中 → 返回 lastId', () => {
    const ws = [{ id: 'w1' }, { id: 'w2' }];
    expect(resolveLastWs('w2', ws)).toBe('w2');
  });

  it('lastId 不在列表中 → 回退到第一个', () => {
    const ws = [{ id: 'w1' }, { id: 'w2' }];
    expect(resolveLastWs('wGhost', ws)).toBe('w1');
  });

  it('lastId 为 undefined → 回退到第一个', () => {
    const ws = [{ id: 'w1' }];
    expect(resolveLastWs(undefined, ws)).toBe('w1');
  });

  it('列表为空 → 返回 null', () => {
    expect(resolveLastWs('w1', [])).toBe(null);
  });
});

describe('resolveLastCat', () => {
  it('map[wsId] 在分类列表中 → 返回该分类', () => {
    const cats = [{ id: 'c1' }, { id: 'c2' }];
    expect(resolveLastCat('w1', cats, { w1: 'c2' })).toBe('c2');
  });

  it('map[wsId] 不在分类列表中（已被删）→ 回退到第一个', () => {
    const cats = [{ id: 'c1' }, { id: 'c2' }];
    expect(resolveLastCat('w1', cats, { w1: 'cGhost' })).toBe('c1');
  });

  it('map 中无该工作区条目 → 回退到第一个', () => {
    const cats = [{ id: 'c1' }];
    expect(resolveLastCat('w1', cats, {})).toBe('c1');
  });

  it('分类列表为空 → 返回 null', () => {
    expect(resolveLastCat('w1', [], { w1: 'c1' })).toBe(null);
  });
});
