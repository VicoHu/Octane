import { useMemo } from 'react';
import { renderMarkdown } from '@/shared/utils/markdown';
import type { Context } from '@/shared/types';
import styles from './ContextCard.module.css';

interface ContextCardProps {
  context: Context;
}

/**
 * 单条上下文卡片：标题 + markdown 预览。纯展示组件。
 * 复用 newtab 同款 renderMarkdown（marked + DOMPurify 净化）。
 */
export function ContextCard({ context }: ContextCardProps) {
  // useMemo：renderMarkdown 含 marked.parse + DOMPurify.sanitize，仅 content 变化时重算
  const html = useMemo(() => renderMarkdown(context.content), [context.content]);
  return (
    <div className={styles.card}>
      <div className={styles.title}>{context.title || '无标题'}</div>
      <div className={styles.content} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
