import { useState, useEffect } from 'react';
import { getAll } from '@/shared/db/database';
import { findBookmarksByHost } from '@/services/BookmarkService';
import type { Bookmark } from '@/shared/types';
import { DB_NAME } from '@/shared/types';

export interface HostBookmarksState {
  /** hostname 命中的书签（跨所有 workspace） */
  matched: Bookmark[];
  loading: boolean;
}

/**
 * 按 hostname 全局匹配书签（跨所有 workspace，不限定 workspace 范围）。
 *
 * - hostname 为 null（非 http(s) 页面）→ matched=[]，不调 getAll
 * - hostname 有值 → getAll('bookmarks') + findBookmarksByHost
 * - hostname 变化 → 重新匹配（active flag 丢弃过期结果）
 * - 收到跨上下文 bookmarks 变更广播（newtab 改书签/上下文）→ 重新匹配
 *
 * 全局匹配的理由：side panel 入口语义是"当前页面"，不是"某个工作区"；
 * 用户在不同 workspace 存了同 host 的书签都应可见。来源信息由书签名/锁标识体现。
 *
 * @param hostname 当前 tab 的 hostname（null 表示不可用）
 */
export function useHostBookmarks(hostname: string | null): HostBookmarksState {
  const [matched, setMatched] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hostname) {
      setMatched([]);
      setLoading(false);
      return;
    }

    let active = true;

    const refresh = async () => {
      const all = await getAll<Bookmark>('bookmarks');
      if (!active) return;
      setMatched(findBookmarksByHost(all, hostname));
      setLoading(false);
    };

    setLoading(true);
    refresh();

    // 监听跨上下文数据变更：newtab 改书签/上下文（经 syncContextMeta 写 bookmarks 表）
    // → 广播 store==='bookmarks' → 自动重新匹配。
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DB_NAME) : null;
    channel?.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as { store?: string };
      if (data?.store === 'bookmarks') refresh();
    });

    return () => {
      active = false;
      channel?.close();
    };
  }, [hostname]);

  return { matched, loading };
}
