import { useState, useEffect } from 'react';
import { readPendingUpdate } from '@/services/UpdateStore';

// 项目无 @types/chrome：声明全局 chrome，最小子集断言（参考 ShortcutsSection.tsx）。
declare const chrome: unknown;

interface ChromeLike {
  storage: {
    onChanged: {
      addListener(cb: (changes: unknown, area: string) => void): void;
      removeListener(cb: (changes: unknown, area: string) => void): void;
    };
  };
}

/**
 * 读取待装更新版本；storage.onChanged 变化时重读（多窗口 / background 写入同步）。
 * 返回 version = 有新版本提示；null = 无提示。semver 兜底在 readPendingUpdate 内。
 */
export function usePendingUpdate(): { version: string | null } {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const read = async () => {
      const v = await readPendingUpdate();
      if (active) setVersion(v);
    };
    read();
    const listener = (_changes: unknown, area: string) => {
      if (area === 'local') void read();
    };
    const c = chrome as unknown as ChromeLike;
    c.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      c.storage.onChanged.removeListener(listener);
    };
  }, []);

  return { version };
}
