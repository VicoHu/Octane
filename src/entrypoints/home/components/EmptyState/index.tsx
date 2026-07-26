import React from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import styles from './index.module.css';

interface SecondaryAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** 组合空状态时提供的次级清除入口（#53） */
  secondaryActions?: SecondaryAction[];
}

export const EmptyState: React.FC<EmptyStateProps> = ({ message, actionLabel, onAction, secondaryActions }) => {
  const hasAction = actionLabel && onAction;
  const hasSecondary = secondaryActions && secondaryActions.length > 0;
  return (
    <div className={styles.empty}>
      <div className={`${styles.message} ${!hasAction && !hasSecondary ? styles.messageOnly : ''}`}>{message}</div>
      {hasAction && (
        <Button variant="default" onClick={onAction}>
          <Plus data-icon="inline-start" />
          {actionLabel}
        </Button>
      )}
      {hasSecondary && (
        <div className={styles.secondaryActions}>
          {secondaryActions!.map((action) => (
            <Button key={action.label} variant="ghost" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};
