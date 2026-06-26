import { describe, it, expect } from 'vitest';
import { isEmoji } from '../emoji';

describe('isEmoji — 判断输入是否为单个 emoji 字符', () => {
  describe('合法 emoji', () => {
    it('常见单码点 emoji', () => {
      expect(isEmoji('📁')).toBe(true);
      expect(isEmoji('📚')).toBe(true);
      expect(isEmoji('🚀')).toBe(true);
      expect(isEmoji('⭐')).toBe(true);
      expect(isEmoji('💡')).toBe(true);
    });

    it('带 Variation Selector-16 的 emoji', () => {
      // ⚙️ = U+2699 + U+FE0F
      expect(isEmoji('⚙️')).toBe(true);
      // ✏️ = U+270F + U+FE0F
      expect(isEmoji('✏️')).toBe(true);
    });

    it('ZWJ 组合 emoji（多码点）', () => {
      // 👨‍💻 = man + ZWJ + computer
      expect(isEmoji('👨‍💻')).toBe(true);
    });

    it('肤色修饰 emoji', () => {
      // 👍🏽 = thumbs up + skin tone
      expect(isEmoji('👍🏽')).toBe(true);
    });

    it('旗子 emoji（区域标志序列）', () => {
      // 🇨🇳 = regional indicator CN
      expect(isEmoji('🇨🇳')).toBe(true);
    });
  });

  describe('非法输入（应拒绝）', () => {
    it('空串', () => {
      expect(isEmoji('')).toBe(false);
    });

    it('拉丁字母', () => {
      expect(isEmoji('A')).toBe(false);
      expect(isEmoji('abc')).toBe(false);
    });

    it('中文', () => {
      expect(isEmoji('书')).toBe(false);
      expect(isEmoji('工作')).toBe(false);
    });

    it('数字', () => {
      expect(isEmoji('1')).toBe(false);
      expect(isEmoji('123')).toBe(false);
    });

    it('标点与符号', () => {
      expect(isEmoji('!')).toBe(false);
      expect(isEmoji('?')).toBe(false);
      expect(isEmoji('.')).toBe(false);
    });

    it('多个 emoji 拼接', () => {
      expect(isEmoji('📁📚')).toBe(false);
    });

    it('emoji + 文字混合', () => {
      expect(isEmoji('📁工作')).toBe(false);
      expect(isEmoji('A📁')).toBe(false);
    });
  });

  describe('边界', () => {
    it('空白字符', () => {
      expect(isEmoji(' ')).toBe(false);
      expect(isEmoji('\t')).toBe(false);
    });

    it('超长字符串即便以 emoji 开头也拒绝', () => {
      // 防止粘贴超长 emoji 序列攻击
      expect(isEmoji('🚀'.repeat(10))).toBe(false);
    });
  });
});
