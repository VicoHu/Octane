import { describe, expect, it } from 'vitest';
import { restrictToVerticalAxis } from '../modifiers';

describe('restrictToVerticalAxis', () => {
  it('清除横向位移并保留纵向位移与缩放', () => {
    const transform = restrictToVerticalAxis({
      transform: { x: 120, y: 48, scaleX: 1, scaleY: 1 } as never,
    } as never);

    expect(transform).toEqual({ x: 0, y: 48, scaleX: 1, scaleY: 1 });
  });
});
