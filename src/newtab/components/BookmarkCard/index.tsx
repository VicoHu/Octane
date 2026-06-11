import React from 'react';
import { IconLock, IconEdit, IconEdit2 } from '@douyinfe/semi-icons';
import type { Bookmark } from '@/shared/types';
import styles from './index.module.css';

interface BookmarkCardProps {
  bookmark: Bookmark;
  notePreview?: string;
  onClick: (bookmark: Bookmark) => void;
  onEditNote: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
}

export const BookmarkCard: React.FC<BookmarkCardProps> = ({ bookmark, notePreview, onClick, onEditNote, onEditBookmark }) => {
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
      aria-label={bookmark.isNoteEncrypted ? `${bookmark.name}，包含加密笔记` : bookmark.name}
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
          <div className={`${styles.description} ${bookmark.hasNote ? styles.descriptionWithNote : ''}`}>
            {bookmark.description}
          </div>
        )}

        {/* 笔记预览 */}
        {bookmark.hasNote && (
          <div className={styles.noteRow}>
            {bookmark.isNoteEncrypted ? (
              <>
                <IconLock className={styles.noteIcon} />
                <span className={styles.noteText}>••••••••</span>
              </>
            ) : (
              <span className={styles.notePreview}>{notePreview}</span>
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
            onEditNote(bookmark);
          }}
          aria-label="编辑笔记"
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
