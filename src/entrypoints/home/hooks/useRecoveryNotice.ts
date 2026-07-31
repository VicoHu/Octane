import { useEffect } from 'react';
import {
  retryPendingRecovery,
  takeRecoveryNotice,
} from '@/shared/tabs/sessionContinuity';
import { Toast } from '@/components/ui/toast';

declare const chrome: unknown;

const RECOVERY_NOTICE_KEY = 'sessionContinuity.recoveryNotice';

interface ChromeLike {
  storage?: {
    onChanged?: {
      addListener(callback: (changes: Record<string, unknown>, area: string) => void): void;
      removeListener(callback: (changes: Record<string, unknown>, area: string) => void): void;
    };
  };
}

/** Home 只消费恢复计数，并将重试委托给后台会话连续性模块。 */
export function useRecoveryNotice(): void {
  useEffect(() => {
    let active = true;
    let consumeQueue = Promise.resolve();
    const consume = () => {
      consumeQueue = consumeQueue.then(async () => {
        const notice = await takeRecoveryNotice();
        if (!active || !notice) return;
        Toast.warning({
          content: `已恢复 ${notice.restoredCount} 个标签页，${notice.failedCount} 个未恢复`,
          action: {
            label: '重试',
            onClick: () => { void retryPendingRecovery(); },
          },
        });
      }).catch(() => undefined);
    };
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && RECOVERY_NOTICE_KEY in changes) consume();
    };
    const onChanged = (chrome as ChromeLike).storage?.onChanged;

    consume();
    onChanged?.addListener(listener);
    return () => {
      active = false;
      onChanged?.removeListener(listener);
    };
  }, []);
}
