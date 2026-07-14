import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BookmarkCard } from './index';
import { GripButton } from '../dnd/GripButton';
import dndStyles from '../dnd/dnd.module.css';
import styles from './index.module.css';
import type { Bookmark } from '@/shared/types';

interface SortableBookmarkCardProps {
  bookmark: Bookmark;
  hasOpenTab?: boolean;
  /** 搜索态:禁用拖拽(grip GripButton disabled + useSortable disabled) */
  disabled?: boolean;
  /** 首启 coachmark(T9):首个书签 grip 显示提示 */
  coachmark?: { onClose: () => void };
  onClick: (bookmark: Bookmark) => void;
  onViewContexts: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDelete: (bookmark: Bookmark) => void;
}

/**
 * SortableBookmarkCard —— BookmarkCard 的拖拽 wrapper(T4)。
 *
 * - useSortable 包裹;setNodeRef + transform/transition 应用到 wrapper。
 * - D6:listeners 收敛到 grip GripButton,整卡 BookmarkCard onClick(跳转)保留不破坏。
 * - isDragging 时原位内容隐藏(visibility hidden),wrapper 显示 placeholder 虚线框(dnd-kit measured rect,
 *   禁固定 min-height 防列位重算跳跃);DragOverlay 副本由 Content 层 SortableOverlay 渲染。
 */
export const SortableBookmarkCard: React.FC<SortableBookmarkCardProps> = ({
  bookmark,
  hasOpenTab,
  disabled,
  coachmark,
  onClick,
  onViewContexts,
  onEditBookmark,
  onDelete,
}) => {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: bookmark.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={`${styles.sortableWrap}${isDragging ? ` ${dndStyles.placeholder}` : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className={isDragging ? styles.dragGhost : undefined}>
        <BookmarkCard
          bookmark={bookmark}
          hasOpenTab={hasOpenTab}
          grip={<GripButton listeners={listeners} disabled={disabled} coachmark={coachmark} />}
          onClick={onClick}
          onViewContexts={onViewContexts}
          onEditBookmark={onEditBookmark}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
};
