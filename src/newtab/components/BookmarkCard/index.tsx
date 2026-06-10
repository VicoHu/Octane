import React from 'react';
import { IconLock } from '@douyinfe/semi-icons';
import type { Bookmark } from '@/shared/types';

interface BookmarkCardProps {
  bookmark: Bookmark;
  notePreview?: string;
  onClick: (bookmark: Bookmark) => void;
}

export const BookmarkCard: React.FC<BookmarkCardProps> = ({ bookmark, notePreview, onClick }) => {
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
      style={{
        background: 'var(--card-bg)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--card-shadow)',
        padding: 16,
        cursor: 'pointer',
        display: 'flex',
        gap: 12,
        transition: 'box-shadow 0.15s, transform 0.15s',
        border: '1px solid var(--border-color)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--card-hover-shadow)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--card-shadow)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Favicon */}
      <div style={{ flexShrink: 0, width: 32, height: 32 }}>
        {bookmark.faviconUrl ? (
          <img
            src={bookmark.faviconUrl}
            alt=""
            style={{ width: 32, height: 32, borderRadius: 4 }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div style={{
            width: 32, height: 32, borderRadius: 4,
            background: '#e0e0e0', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 14, color: '#999',
          }}>
            {bookmark.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* 右侧信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bookmark.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayUrl}
        </div>
        {bookmark.description && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: bookmark.hasNote ? 4 : 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {bookmark.description}
          </div>
        )}

        {/* 笔记预览 */}
        {bookmark.hasNote && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {bookmark.isNoteEncrypted ? (
              <>
                <IconLock style={{ fontSize: 12, color: 'var(--muted)' }} />
                <span style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 1 }}>••••••••</span>
              </>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                {notePreview}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
