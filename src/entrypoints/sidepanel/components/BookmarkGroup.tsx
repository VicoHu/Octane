import { useState } from 'react';
import { IconLock, IconPlus } from '@douyinfe/semi-icons';
import { useEncryptedContexts } from '../hooks/useEncryptedContexts';
import { ContextCard } from './ContextCard';
import { InlineContextEditor } from './InlineContextEditor';
import type { Bookmark } from '@/shared/types';
import styles from './BookmarkGroup.module.css';

interface BookmarkGroupProps {
  bookmark: Bookmark;
  /** 分类名（来源辨识 chip）。二级模式下段头已显示分类时可省略，避免重复 */
  categoryName?: string;
  /** 分类 icon，与 categoryName 配对 */
  categoryIcon?: string;
}

/**
 * 单书签分组：header（书签名 + 加密锁标识 + 命中数 + 可选分类 chip）+ 四态内容。
 * 内调 useEncryptedContexts 按解锁状态 gate 解密渲染。
 *
 * 四态：locked（暖色解锁卡）/ loading（骨架）/ error（错误）/ contexts（ContextCard 列表）
 */
export function BookmarkGroup({ bookmark, categoryName, categoryIcon }: BookmarkGroupProps) {
  const { contexts, locked, error, loading } = useEncryptedContexts(bookmark.id, bookmark.hasEncryptedContext, bookmark.contextCount);
  const [editing, setEditing] = useState(false);

  return (
    <div className={styles.group} role="listitem" aria-label={bookmark.name}>
      <div className={styles.header}>
        <span className={styles.name}>{bookmark.name}</span>
        {bookmark.hasEncryptedContext && <IconLock className={styles.lock} aria-label="含加密上下文" />}
        {categoryName && (
          <span className={styles.chip} title={categoryName}>
            {categoryIcon ? `${categoryIcon} ` : ''}{categoryName}
          </span>
        )}
        <span className={styles.count}>{bookmark.contextCount} 条上下文</span>
        <button
          className={styles.addBtn}
          onClick={() => setEditing(true)}
          aria-label="添加上下文"
          title="就地创建上下文"
        >
          <IconPlus />
        </button>
      </div>
      {editing && (
        <InlineContextEditor bookmarkId={bookmark.id} onDone={() => setEditing(false)} />
      )}
      {locked ? (
        <div className={styles.locked}>含加密上下文，点击解锁查看</div>
      ) : loading ? (
        <div className={styles.loading}>加载中…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : contexts.length === 0 ? (
        <div className={styles.empty}>暂无上下文</div>
      ) : (
        <div className={styles.contexts}>
          {contexts.map((ctx) => (
            <ContextCard key={ctx.id} context={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}
