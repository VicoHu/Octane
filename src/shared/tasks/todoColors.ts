import type { TodoColor } from '@/shared/types';

/** 待办颜色调色板。 */
export const TODO_COLOR_PALETTE: Readonly<Record<TodoColor, string>> = {
  gray: '#64748B',
  red: '#DC2626',
  amber: '#B45309',
  green: '#007D63',
  cyan: '#0E7490',
  blue: '#2563EB',
  violet: '#7C3AED',
  pink: '#BE185D',
};
