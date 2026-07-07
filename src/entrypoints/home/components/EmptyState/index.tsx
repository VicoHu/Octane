import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { IconPlus } from '@douyinfe/semi-icons';
import styles from './index.module.css';

interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ message, actionLabel, onAction }) => {
  return (
    <div className={styles.empty}>
      <div className={`${styles.message} ${!actionLabel ? styles.messageOnly : ''}`}>{message}</div>
      {actionLabel && onAction && (
        <Button icon={<IconPlus />} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
