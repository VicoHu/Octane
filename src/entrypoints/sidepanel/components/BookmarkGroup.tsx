import { IconLock } from '@douyinfe/semi-icons';
import { useEncryptedContexts } from '../hooks/useEncryptedContexts';
import { ContextCard } from './ContextCard';
import type { Bookmark } from '@/shared/types';
import styles from './BookmarkGroup.module.css';

interface BookmarkGroupProps {
  bookmark: Bookmark;
}

/**
 * 单书签分组：header（书签名 + 加密锁标识 + 命中数）+ 四态内容。
 * 内调 useEncryptedContexts 按解锁状态 gate 解密渲染。
 *
 * 四态：locked（暖色解锁卡）/ loading（骨架）/ error（错误）/ contexts（ContextCard 列表）
 *
 * 注：分类名 Tag 需额外 getAll('categories') 取数，P2 先用书签名 + 加密锁标识替代。
 */
export function BookmarkGroup({ bookmark }: BookmarkGroupProps) {
  const { contexts, locked, error, loading } = useEncryptedContexts(bookmark.id, bookmark.hasEncryptedContext);

  return (
    <div className={styles.group} role="listitem" aria-label={bookmark.name}>
      <div className={styles.header}>
        <span className={styles.name}>{bookmark.name}</span>
        {bookmark.hasEncryptedContext && <IconLock className={styles.lock} aria-label="含加密上下文" />}
        <span className={styles.count}>{bookmark.contextCount} 条上下文</span>
      </div>
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
