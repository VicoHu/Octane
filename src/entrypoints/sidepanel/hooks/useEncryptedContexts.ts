import { useState, useEffect, useRef } from 'react';
import { getContexts } from '@/services/ContextService';
import type { Context } from '@/shared/types';

export interface EncryptedContextsState {
  /** 上下文列表（明文 + 密文占位；密文未解锁时 content 为空，由 ContextCard 渲染锁占位） */
  contexts: Context[];
  /** 解密/读取失败时的错误信息 */
  error: string | null;
  loading: boolean;
}

/**
 * 获取书签的上下文（上下文级粒度）。
 *
 * - 始终调 getContexts（容错：明文正常返回，密文未解锁保留占位，不解密不泄露）
 * - 密文上下文未解锁时由 ContextCard 单独渲染锁占位（点击解锁），明文上下文始终可见
 * - 解锁/锁定状态变化（octane-unlock-sidepanel / octane-derived-key）经 chrome.storage.onChanged
 *   广播 → bump revision → 静默重拉（保留上次 contexts，不闪骨架）；切书签/contextCount 变化走骨架
 *
 * @param bookmarkId 书签 id
 * @param hasEncryptedContext 书签是否含加密 context（保留签名兼容，内部不再用于整体 gate）
 * @param contextCount 书签的上下文条数（变化时重新拉取）
 */
export function useEncryptedContexts(
  bookmarkId: string,
  hasEncryptedContext: boolean,
  contextCount: number,
): EncryptedContextsState {
  const [state, setState] = useState<EncryptedContextsState>({
    contexts: [],
    error: null,
    loading: true,
  });
  // 解锁状态变化信号：unlock/lock/home lock 经 onChanged 广播时 bump，触发下方 effect 静默重拉。
  // 仅监听解锁标记 + 共享 key（不含 visibility key），失焦/聚焦不触发（止闪烁）。
  const [revision, setRevision] = useState(0);
  const lastKeyRef = useRef('');

  useEffect(() => {
    const onChanged = (globalThis as Record<string, unknown>).chrome as
      | { storage?: { onChanged?: { addListener?(cb: unknown): void; removeListener?(cb: unknown): void } } }
      | undefined;
    const listener = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName !== 'session') return;
      if ('octane-unlock-sidepanel' in changes || 'octane-derived-key' in changes) {
        setRevision((r) => r + 1);
      }
    };
    onChanged?.storage?.onChanged?.addListener?.(listener);
    return () => {
      onChanged?.storage?.onChanged?.removeListener?.(listener);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const key = `${bookmarkId}:${contextCount}`;
    const keyChanged = key !== lastKeyRef.current;
    lastKeyRef.current = key;
    // 切书签 / contextCount 变化 → 显示骨架；解锁/锁定重拉（revision）→ 保留上次 contexts 静默更新
    if (keyChanged) {
      setState({ contexts: [], error: null, loading: true });
    }

    (async () => {
      try {
        const contexts = await getContexts(bookmarkId);
        if (!active) return;
        setState({ contexts, error: null, loading: false });
      } catch (e) {
        if (!active) return;
        setState({
          contexts: [],
          error: (e as Error).message || '解密失败',
          loading: false,
        });
      }
    })();

    return () => {
      active = false;
    };
    // hasEncryptedContext 不参与：始终拉取 contexts（容错返回明文 + 密文占位）
    void hasEncryptedContext;
  }, [bookmarkId, contextCount, revision, hasEncryptedContext]);

  return state;
}
