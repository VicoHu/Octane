import { useState, useEffect } from 'react';
import { isUnlocked } from '@/services/UnlockSession';
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
 * 获取书签的上下文，按需解密。
 *
 * - 书签不含加密 context（hasEncryptedContext=false）→ 直接 getContexts（明文，无需密钥）
 * - 含加密 context 且未解锁 → locked=true，不调 getContexts（locked UI，不预渲染明文）
 * - 含加密 context 且已解锁 → getContexts（含解密）→ contexts；解密失败 → error，明文不泄露
 *
 * 解锁判定按 sidepanel surface 独立查询（UnlockSession.isUnlocked('sidepanel')），
 * 与 home 解锁态物理隔离：home 解锁不再联动 sidepanel 自动解锁（分层保护）。
 *
 * @param bookmarkId 书签 id
 * @param hasEncryptedContext 书签是否含加密 context（冗余字段，决定是否需解锁 gate）
 * @param contextCount 书签的上下文条数（冗余字段；变化时重新拉取，捕获就地创建的新上下文）
 */
export function useEncryptedContexts(
  bookmarkId: string,
  hasEncryptedContext: boolean,
  contextCount: number,
): EncryptedContextsState {
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
      // 仅含加密 context 时才需解锁 gate；未加密 context 不需密钥，直接读取
      if (hasEncryptedContext) {
        const unlocked = await isUnlocked('sidepanel');
        if (!active) return;
        if (!unlocked) {
          setState({ contexts: [], locked: true, error: null, loading: false });
          return;
        }
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
  }, [bookmarkId, hasEncryptedContext, contextCount]);

  return state;
}
