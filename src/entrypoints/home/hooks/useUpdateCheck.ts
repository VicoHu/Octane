import { useCallback, useEffect, useRef, useState } from 'react';
import type { Channel } from '@/shared/distribution';

// 项目无 @types/chrome：声明全局 chrome，最小子集断言。
declare const chrome: unknown;

interface ChromeLike {
  runtime: {
    requestUpdateCheck(): Promise<unknown>;
  };
}

export const UPDATE_CHECK_DELAY_MS = 5_000;

export type UpdateCheckResult =
  | { type: 'update-available'; version: string }
  | { type: 'up-to-date' }
  | { type: 'manual' };

/** 仅以 background 写入的待装版本判断更新；requestUpdateCheck 的状态不可靠。 */
export function resolveUpdateCheckResult(
  channel: Channel,
  pendingVersion: string | null,
): UpdateCheckResult {
  if (channel === 'manual') return { type: 'manual' };
  if (pendingVersion) return { type: 'update-available', version: pendingVersion };
  return { type: 'up-to-date' };
}

/** 两个主动检测入口共用：触发商店检查后固定等待 background 同步待装版本。 */
export function useUpdateCheck(channel: Channel, pendingVersion: string | null) {
  const [checking, setChecking] = useState(false);
  const pendingVersionRef = useRef(pendingVersion);

  useEffect(() => {
    pendingVersionRef.current = pendingVersion;
  }, [pendingVersion]);

  const checkForUpdate = useCallback(async (): Promise<UpdateCheckResult> => {
    if (channel === 'manual') return { type: 'manual' };

    setChecking(true);
    try {
      try {
        await (chrome as unknown as ChromeLike).runtime.requestUpdateCheck();
      } catch {
        // 忽略：只信任 background 的 onUpdateAvailable 结果。
      }
      await new Promise<void>((resolve) => setTimeout(resolve, UPDATE_CHECK_DELAY_MS));
      return resolveUpdateCheckResult(channel, pendingVersionRef.current);
    } finally {
      setChecking(false);
    }
  }, [channel]);

  return { checking, checkForUpdate };
}
