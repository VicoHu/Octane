import { useState, useEffect } from 'react';
import { isUnlocked } from '@/services/CryptoService';
import { getContexts } from '@/services/ContextService';
import type { Context } from '@/shared/types';

export interface EncryptedContextsState {
  /** 解密后的上下文（解锁且成功时填充） */
  contexts: Context[];
  /** 未解锁 → true，此时不调用 getContexts（locked UI，不预渲染明文） */
  locked: boolean;
  /** 解密失败（密码错误/数据损坏）时的错误信息 */
  error: string | null;
  loading: boolean;
}

/**
 * 获取书签的上下文，按解锁状态 gate 解密。
 *
 * - 未解锁（isUnlocked false）→ locked=true，不调 getContexts（locked UI，不预渲染明文）
 * - 解锁 → getContexts（含解密）→ contexts；解密失败（密码错误/数据损坏）→ error，明文不泄露
 *
 * 解锁状态源自 chrome.storage.session（extension-level 跨上下文共享），
 * newtab 解锁后 side panel 自动感知（M5 跨上下文一致性）。
 *
 * @param bookmarkId 书签 id
 */
export function useEncryptedContexts(bookmarkId: string): EncryptedContextsState {
  const [state, setState] = useState<EncryptedContextsState>({
    contexts: [],
    locked: false,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let active = true;
    setState({ contexts: [], locked: false, error: null, loading: true });

    (async () => {
      const unlocked = await isUnlocked();
      if (!active) return;
      if (!unlocked) {
        setState({ contexts: [], locked: true, error: null, loading: false });
        return;
      }
      try {
        const contexts = await getContexts(bookmarkId);
        if (!active) return;
        setState({ contexts, locked: false, error: null, loading: false });
      } catch (e) {
        if (!active) return;
        setState({
          contexts: [],
          locked: false,
          error: (e as Error).message || '解密失败',
          loading: false,
        });
      }
    })();

    return () => {
      active = false;
    };
  }, [bookmarkId]);

  return state;
}
