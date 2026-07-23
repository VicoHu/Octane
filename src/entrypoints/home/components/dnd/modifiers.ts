import type { Modifier } from '@dnd-kit/core';

type DndTransform = { x: number; y: number; scaleX: number; scaleY: number };

/** 将拖拽 transform 收敛为垂直位移，供 modifier 和 workspace 行复用。 */
export const toVerticalTransform = (transform: DndTransform | null): DndTransform | null => {
  if (!transform) return null;
  return { ...transform, x: 0 };
};

/** 工作区列表只允许沿垂直轴移动，避免拖拽预览横向漂移。 */
export const restrictToVerticalAxis: Modifier = ({ transform }) => toVerticalTransform(transform)!;
