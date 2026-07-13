import { describe, it, expect } from 'vitest';
import { computeDropIndicator, type DropRect } from '../computeDropIndicator';

/** 构造 rect:over 固定在 (0,0) 100×100,center (50,50) */
const rect = (top: number, left: number, width = 100, height = 100): DropRect => ({
  top,
  left,
  width,
  height,
});
const over = rect(0, 0);

describe('computeDropIndicator', () => {
  describe('1D vertical list', () => {
    it('active center 在 over 上方 → horizontal/before', () => {
      const active = rect(0, 0, 100, 50); // center y=25 < 50
      expect(computeDropIndicator({ activeRect: active, overRect: over, layout: '1d' })).toEqual({
        axis: 'horizontal',
        position: 'before',
      });
    });

    it('active center 在 over 下方 → horizontal/after', () => {
      const active = rect(50, 0, 100, 50); // center y=75 > 50
      expect(computeDropIndicator({ activeRect: active, overRect: over, layout: '1d' })).toEqual({
        axis: 'horizontal',
        position: 'after',
      });
    });

    it('同 item 重合(dy=0)→ after(约定)', () => {
      const active = rect(0, 0, 100, 100); // center 完全重合
      expect(computeDropIndicator({ activeRect: active, overRect: over, layout: '1d' })).toEqual({
        axis: 'horizontal',
        position: 'after',
      });
    });
  });

  describe('2D grid', () => {
    it('active center 正上方(dy 主导)→ horizontal/before(行间横线)', () => {
      const active = rect(0, 0, 100, 50); // center (50,25): dx=0, dy=-25
      expect(computeDropIndicator({ activeRect: active, overRect: over, layout: '2d' })).toEqual({
        axis: 'horizontal',
        position: 'before',
      });
    });

    it('正下方(dy 主导)→ horizontal/after', () => {
      const active = rect(50, 0, 100, 50); // center (50,75): dy=25
      expect(computeDropIndicator({ activeRect: active, overRect: over, layout: '2d' })).toEqual({
        axis: 'horizontal',
        position: 'after',
      });
    });

    it('正左方(dx 主导)→ vertical/before(列间竖线)', () => {
      const active = rect(0, 0, 50, 100); // center (25,50): dx=-25, dy=0
      expect(computeDropIndicator({ activeRect: active, overRect: over, layout: '2d' })).toEqual({
        axis: 'vertical',
        position: 'before',
      });
    });

    it('正右方(dx 主导)→ vertical/after', () => {
      const active = rect(0, 50, 50, 100); // center (75,50): dx=25
      expect(computeDropIndicator({ activeRect: active, overRect: over, layout: '2d' })).toEqual({
        axis: 'vertical',
        position: 'after',
      });
    });

    it('对角线 |dy|=|dx| → 偏 horizontal(>= 约定)', () => {
      const active = rect(0, 0, 50, 50); // center (25,25): dx=-25, dy=-25
      expect(computeDropIndicator({ activeRect: active, overRect: over, layout: '2d' })).toEqual({
        axis: 'horizontal',
        position: 'before',
      });
    });

    it('末尾项:active center 远在 over 右侧水平主导 → vertical/after', () => {
      const active = rect(0, 80, 100, 100); // center (130,50): dx=80, dy=0
      expect(computeDropIndicator({ activeRect: active, overRect: over, layout: '2d' })).toEqual({
        axis: 'vertical',
        position: 'after',
      });
    });
  });
});
