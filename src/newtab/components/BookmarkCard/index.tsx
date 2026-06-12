import React from 'react';
import { IconLock, IconEdit, IconEdit2 } from '@douyinfe/semi-icons';
import type { Bookmark } from '@/shared/types';
import styles from './index.module.css';

interface BookmarkCardProps {
  bookmark: Bookmark;
  contextPreview?: string;
  onClick: (bookmark: Bookmark) => void;
  onViewContexts: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
}

export const BookmarkCard: React.FC<BookmarkCardProps> = ({ bookmark, contextPreview, onClick, onViewContexts, onEditBookmark }) => {
  const displayUrl = (() => {
    try {
      return new URL(bookmark.url).hostname;
    } catch {
      return bookmark.url;
    }
  })();

  return (
    <div
      role="listitem"
      aria-label={bookmark.hasEncryptedContext ? `${bookmark.name}，包含加密上下文` : bookmark.name}
      onClick={() => onClick(bookmark)}
      className={styles.card}
    >
      {/* Favicon */}
      <div className={styles.favicon}>
        {bookmark.faviconUrl ? (
          <img
            src={bookmark.faviconUrl}
            alt=""
            className={styles.faviconImg}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className={styles.fallback}>
            {bookmark.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* 右侧信息 */}
      <div className={styles.info}>
        <div className={styles.name}>{bookmark.name}</div>
        <div className={styles.url}>{displayUrl}</div>
        {bookmark.description && (
          <div className={`${styles.description} ${bookmark.contextCount > 0 ? styles.descriptionWithNote : ''}`}>
            {bookmark.description}
          </div>
        )}

        {/* 上下文预览 */}
        {bookmark.contextCount > 0 && (
          <div className={styles.noteRow}>
            {bookmark.hasEncryptedContext ? (
              <>
                <IconLock className={styles.noteIcon} />
                <span className={styles.noteText}>••••••••</span>
              </>
            ) : (
              <span className={styles.notePreview}>{contextPreview}</span>
            )}
          </div>
        )}
      </div>

      {/* 操作按钮区 */}
      <div className={styles.actions}>
        <button
          className={styles.actionBtn}
          onClick={(e) => {
            e.stopPropagation();
            onViewContexts(bookmark);
          }}
          aria-label="查看上下文"
        >
          <IconEdit />
        </button>
        <button
          className={styles.actionBtn}
          onClick={(e) => {
            e.stopPropagation();
            onEditBookmark(bookmark);
          }}
          aria-label="编辑书签"
        >
          <IconEdit2 />
        </button>
      </div>
    </div>
  );
};
