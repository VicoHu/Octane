import React from 'react';
import { DragOverlay } from '@dnd-kit/core';
import styles from './dnd.module.css';

interface SortableOverlayProps {
  /** 面明度决定描边色:浅色面(BookmarkCard/ManagePanel)light 炭灰;深色面(Sidebar/PinnedArea)dark 浅描边 */
  tone?: 'light' | 'dark';
  /** 非法落区:overlay 降透明 .5 + not-allowed */
  invalid?: boolean;
  /** 常驻 grip 态(ManagePanel)无需影响 overlay,保留扩展位 */
  children: React.ReactNode;
}

/**
 * SortableOverlay —— dnd-kit DragOverlay 的项目级 wrapper。
 *
 * - dnd-kit DragOverlay 默认 portal 到 document.body(防 Semi Modal overflow/transform 裁剪)。
 * - z-index 1005(>Semi Modal 1000,<Toast 1010)。
 * - 描边按面明度(D6):浅色面炭灰 #2D3436,深色面浅描边 rgba(255,255,255,.5)。
 * - scale(1.04) + shadow-elevated;reduced-motion 由 dnd.module.css 禁用 scale。
 */
export function SortableOverlay({ tone = 'light', invalid = false, children }: SortableOverlayProps) {
  const cls = [
    styles.overlay,
    tone === 'dark' ? styles.overlayDark : styles.overlayLight,
    invalid ? styles.overlayInvalid : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <DragOverlay style={{ zIndex: 1005 }} dropAnimation={{ duration: 180, easing: 'ease-out' }}>
      <div className={cls}>{children}</div>
    </DragOverlay>
  );
}
