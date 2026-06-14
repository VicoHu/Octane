import { describe, it, expect } from 'vitest';
import { useUser } from './useUser';

describe('useUser', () => {
  it('v1 占位：始终返回 null（guest 态）', () => {
    expect(useUser()).toBeNull();
  });
});
