import React from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
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
        <Button variant="default" onClick={onAction}>
          <Plus data-icon="inline-start" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
