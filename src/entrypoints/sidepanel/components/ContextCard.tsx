import { useMemo } from 'react';
import { Lock } from 'lucide-react';
import { renderMarkdown } from '@/shared/utils/markdown';
import { useUnlockRequest } from '../unlockContext';
import type { Context } from '@/shared/types';
import styles from './ContextCard.module.css';

interface ContextCardProps {
  context: Context;
}

/**
 * 单条上下文卡片：标题 + markdown 预览。纯展示组件。
 * 复用 home 同款 renderMarkdown（marked + DOMPurify 净化）。
 *
 * 密文未解锁（isEncrypted 且 content 为空占位）→ 渲染可点击锁占位，点击触发 requestUnlock。
 * 解锁后 onChanged 重拉，content 填充明文，正常渲染。
 */
export function ContextCard({ context }: ContextCardProps) {
  const requestUnlock = useUnlockRequest();
  const html = useMemo(() => renderMarkdown(context.content), [context.content]);

  if (context.isEncrypted && !context.content) {
    return (
      <div
        className={styles.locked}
        role="button"
        tabIndex={0}
        aria-label="加密上下文，点击解锁"
        onClick={requestUnlock}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            requestUnlock();
          }
        }}
      >
        <Lock className={styles.lockIcon} />
        <span>加密上下文，点击解锁查看</span>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.title}>{context.title || '无标题'}</div>
      <div className={styles.content} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
