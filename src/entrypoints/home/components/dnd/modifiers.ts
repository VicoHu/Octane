import type { Modifier } from '@dnd-kit/core';

/** 工作区列表只允许沿垂直轴移动，避免拖拽预览横向漂移。 */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});
