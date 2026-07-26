import { describe, it, expect } from 'vitest';
import {
  MAX_TAG_COUNT,
  MAX_TAG_LENGTH,
  normalizeTags,
  validateTag,
} from '@/shared/utils/tagRules';

describe('validateTag — 单个 Tag 校验与清理', () => {
  it('去除首尾空白后非空 → 通过', () => {
    expect(validateTag('  React  ')).toBe('React');
  });

  it('纯空白 → 返回 null（trim 后为空）', () => {
    expect(validateTag('   ')).toBeNull();
    expect(validateTag('\t\n')).toBeNull();
    expect(validateTag('')).toBeNull();
  });

  it('去首尾空白后仍含内部空白 → 返回 null', () => {
    expect(validateTag('React Native')).toBeNull();
    expect(validateTag('React\tNative')).toBeNull();
    expect(validateTag('React\nNative')).toBeNull();
  });

  it('无空白的中文字符 → 通过', () => {
    expect(validateTag('前端')).toBe('前端');
  });

  it('无空白的符号组合 → 通过', () => {
    expect(validateTag('C++')).toBe('C++');
    expect(validateTag('#hashtag')).toBe('#hashtag');
  });

  it('超过 32 字符 → 返回 null', () => {
    expect(validateTag('a'.repeat(MAX_TAG_LENGTH + 1))).toBeNull();
  });

  it('正好 32 字符 → 通过', () => {
    expect(validateTag('a'.repeat(MAX_TAG_LENGTH))).toBe('a'.repeat(MAX_TAG_LENGTH));
  });
});

describe('normalizeTags — 批量规范化、校验、去重', () => {
  it('空数组输入 → 返回空数组', () => {
    expect(normalizeTags([])).toEqual([]);
  });

  it('全部合法、无重复 → trim 后原样保留，顺序不变', () => {
    expect(normalizeTags(['React', 'Vue', 'Angular'])).toEqual(['React', 'Vue', 'Angular']);
  });

  it('含首尾空白的合法 Tag → trim', () => {
    expect(normalizeTags(['  React  ', 'Vue'])).toEqual(['React', 'Vue']);
  });

  it('非法 Tag（含内部空白/超长/空）→ 被过滤', () => {
    expect(normalizeTags(['React', 'Vue Native', '', 'Angular'])).toEqual(['React', 'Angular']);
  });

  it('大小写不敏感去重：保留首次出现的展示形式', () => {
    expect(normalizeTags(['React', 'react', 'REACT', 'Vue'])).toEqual(['React', 'Vue']);
  });

  it('大小写不敏感去重：首次含首尾空白时先 trim 再比较', () => {
    // '  React  ' → 'React' 是首次，'react' 是重复
    expect(normalizeTags(['  React  ', 'react'])).toEqual(['React']);
  });

  it('超过 MAX_TAG_COUNT（20）个合法 Tag → 截断到 20 个', () => {
    const input = Array.from({ length: 25 }, (_, i) => `tag${i}`);
    const result = normalizeTags(input);
    expect(result).toHaveLength(MAX_TAG_COUNT);
    // 保留前 20 个（添加顺序）
    expect(result).toEqual(input.slice(0, MAX_TAG_COUNT));
  });

  it("重复 Tag 不计入上限：20 个 'a' + 1 个 'b' → ['a', 'b']（去重后 2 个）", () => {
    const input = [...Array.from({ length: 20 }, () => 'a'), 'b'];
    expect(normalizeTags(input)).toEqual(['a', 'b']);
  });

  it('全为非法输入 → 返回空数组', () => {
    expect(normalizeTags(['', '   ', 'a b', 'a\tb'])).toEqual([]);
  });

  it('中文与英文混合、大小写不敏感去重', () => {
    expect(normalizeTags(['前端', '前端', 'frontend', 'Frontend'])).toEqual([
      '前端',
      'frontend',
    ]);
  });
});

describe('Tag 常量', () => {
  it('MAX_TAG_COUNT 为 20', () => {
    expect(MAX_TAG_COUNT).toBe(20);
  });

  it('MAX_TAG_LENGTH 为 32', () => {
    expect(MAX_TAG_LENGTH).toBe(32);
  });
});
