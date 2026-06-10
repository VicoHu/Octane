import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { IconPlus } from '@douyinfe/semi-icons';

interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ message, actionLabel, onAction }) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 20px',
      color: 'var(--muted)',
    }}>
      <div style={{ fontSize: 16, marginBottom: actionLabel ? 16 : 0 }}>{message}</div>
      {actionLabel && onAction && (
        <Button icon={<IconPlus />} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
