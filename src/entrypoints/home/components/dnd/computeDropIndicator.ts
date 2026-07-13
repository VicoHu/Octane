/**
 * computeDropIndicator —— 纯函数:根据 active(跟随指针)与 over 的 rect 算插入线轴与位置。
 *
 * - 1D vertical list:恒横向插入线,before/after 由 active center 在 over 中线上下决定。
 * - 2D grid:|dy|>=|dx| → 垂直主导(行间横线);否则水平主导(列间竖线)。
 *   before/after 由对应主轴方向 active center 落在 over 哪半决定。
 * - 纯函数无 DOM 依赖,边界(重合/对角线)由 >= 与 <0 约定确定,单测覆盖。
 *
 * 调用方:onDragOver 时 over.id !== active.id 才调用;同 item 由调用方过滤(返回 null 不显线)。
 * 设计权衡:dnd-kit onDragOver 在 over 变化时触发(非每帧),before/after 为 over 级粒度
 * (over 一变即准确,同 over 内部不刷新),与 react-beautiful-dnd 一致,可接受。
 */

export interface DropRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type DropLayout = '1d' | '2d';
export type DropAxis = 'horizontal' | 'vertical';
export type DropPosition = 'before' | 'after';

export interface DropIndicatorResult {
  axis: DropAxis;
  position: DropPosition;
}

export function computeDropIndicator(input: {
  activeRect: DropRect;
  overRect: DropRect;
  layout: DropLayout;
}): DropIndicatorResult {
  const { activeRect, overRect, layout } = input;
  // active center(跟随指针的 translated rect 中心)
  const cx = activeRect.left + activeRect.width / 2;
  const cy = activeRect.top + activeRect.height / 2;
  // over center
  const ocx = overRect.left + overRect.width / 2;
  const ocy = overRect.top + overRect.height / 2;
  const dx = cx - ocx;
  const dy = cy - ocy;

  // 1D list:恒横线,由垂直方向定 before/after
  if (layout === '1d') {
    return { axis: 'horizontal', position: dy < 0 ? 'before' : 'after' };
  }

  // 2D grid:垂直主导 → 行间横线;水平主导 → 列间竖线(对角线 |dy|=|dx| 偏 horizontal)
  if (Math.abs(dy) >= Math.abs(dx)) {
    return { axis: 'horizontal', position: dy < 0 ? 'before' : 'after' };
  }
  return { axis: 'vertical', position: dx < 0 ? 'before' : 'after' };
}
