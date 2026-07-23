import React from 'react';
import { createPortal } from 'react-dom';
import { DragOverlay, type Modifier } from '@dnd-kit/core';
import styles from './dnd.module.css';

interface SortableOverlayProps {
  /** 面明度决定描边色:浅色面(BookmarkCard/ManagePanel)light 炭灰;深色面(Sidebar/PinnedArea)dark 浅描边 */
  tone?: 'light' | 'dark';
  /** 非法落区:overlay 降透明 .5 + not-allowed */
  invalid?: boolean;
  /** 常驻 grip 态(ManagePanel)无需影响 overlay,保留扩展位 */
  children: React.ReactNode;
  /** 可选的 overlay 位移约束；workspace 需要与列表行保持同一垂直坐标策略。 */
  modifiers?: Modifier[];
}

/**
 * SortableOverlay —— dnd-kit DragOverlay 的项目级 wrapper。
 *
 * - dnd-kit 的 DragOverlay 本身**不** portal(渲染在 React 树原位)。ManagePanel 处在
 *   shadcn Dialog 内,DialogContent 用 -translate-x-1/2 -translate-y-1/2 居中,是常驻
 *   transform 祖先;若 DragOverlay 留在 Dialog 内,其 position:fixed 的 containing block
 *   会被该 transform 捕获,top/left(视口坐标)被当作相对 Dialog 的偏移 → overlay 瞬移到
 *   右下。故这里用 createPortal 主动把 DragOverlay 挂到 document.body,脱离 transform 祖先。
 * - createPortal 只改 DOM 挂载点,React 树/context 不变,useDndContext 仍可用。
 * - z-index 1005(>Dialog,<Toast 1010)。
 * - 描边按面明度(D6):浅色面炭灰 #2D3436,深色面浅描边 rgba(255,255,255,.5)。
 * - scale(1.04) + shadow-elevated;reduced-motion 由 dnd.module.css 禁用 scale。
 */
export function SortableOverlay({ tone = 'light', invalid = false, children, modifiers }: SortableOverlayProps) {
  const cls = [
    styles.overlay,
    tone === 'dark' ? styles.overlayDark : styles.overlayLight,
    invalid ? styles.overlayInvalid : '',
  ]
    .filter(Boolean)
    .join(' ');
  return createPortal(
    <DragOverlay
      modifiers={modifiers}
      style={{ zIndex: 1005 }}
      dropAnimation={{ duration: 180, easing: 'ease-out' }}
    >
      <div className={cls}>{children}</div>
    </DragOverlay>,
    document.body,
  );
}
