import React, { useState } from 'react';
import { Card, Button } from '@douyinfe/semi-ui';
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
  const [faviconError, setFaviconError] = useState(false);
  const displayUrl = (() => {
    try {
      return new URL(bookmark.url).hostname;
    } catch {
      return bookmark.url;
    }
  })();

  return (
    <Card
      role="listitem"
      aria-label={bookmark.hasEncryptedContext ? `${bookmark.name}，包含加密上下文` : bookmark.name}
      onClick={() => onClick(bookmark)}
      shadows="hover"
      bodyStyle={{ display: 'flex', gap: 'var(--space-md)', padding: 'var(--space-lg)', alignItems: 'center' }}
      className={styles.card}
    >
      {/* Favicon（faviconUrl 加载失败时回退首字母）*/}
      <div className={styles.favicon}>
        {bookmark.faviconUrl && !faviconError ? (
          <img
            src={bookmark.faviconUrl}
            alt=""
            className={styles.faviconImg}
            onError={() => setFaviconError(true)}
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
        <Button
          theme="borderless"
          size="small"
          icon={<IconEdit />}
          aria-label="查看上下文"
          className={styles.actionBtn}
          onClick={(e) => {
            e.stopPropagation();
            onViewContexts(bookmark);
          }}
        />
        <Button
          theme="borderless"
          size="small"
          icon={<IconEdit2 />}
          aria-label="编辑书签"
          className={styles.actionBtn}
          onClick={(e) => {
            e.stopPropagation();
            onEditBookmark(bookmark);
          }}
        />
      </div>
    </Card>
  );
};
