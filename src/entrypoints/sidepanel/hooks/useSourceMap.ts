import { useState, useEffect } from 'react';
import { getAll } from '@/shared/db/database';
import type { Workspace, Category } from '@/shared/types';
import { DB_NAME } from '@/shared/types';

export interface SourceMapState {
  workspaces: Workspace[];
  categories: Category[];
  /** false 直到首次 getAll 完成；false 期调用方不应渲染来源名（避免闪烁 undefined） */
  ready: boolean;
}

/**
 * 加载工作区 + 分类（来源解析数据源），供 groupBookmarksByWorkspace 与书签卡 chip 使用。
 *
 * - mount → getAll('workspaces') + getAll('categories')，完成后 ready=true
 * - 监听 BroadcastChannel('octane-db')：
 *   - store==='workspaces' || store==='categories' → 刷新（改名/改图标）
 *   - store==='bookmarks' && action==='delete' → 刷新（R9：cascadeDeleteWorkspace/Category
 *     只广播 bookmarks-delete，不广播 workspaces/categories-delete；不监听则删工作区后残留幽灵段头）
 *   - bookmarks-put（如 syncContextMeta 改 contextCount）→ 不刷新（避免每次上下文增删都重取）
 * - BroadcastChannel 不可用 → 静默降级（仅无监听，首次加载不受影响）
 */
export function useSourceMap(): SourceMapState {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const [wss, cats] = await Promise.all([
        getAll<Workspace>('workspaces'),
        getAll<Category>('categories'),
      ]);
      if (!active) return;
      setWorkspaces(wss);
      setCategories(cats);
      setReady(true);
    };

    refresh();

    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DB_NAME) : null;
    channel?.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as { store?: string; action?: string } | undefined;
      if (!data) return;
      const isSource = data.store === 'workspaces' || data.store === 'categories';
      const isCascadeDelete = data.store === 'bookmarks' && data.action === 'delete';
      if (isSource || isCascadeDelete) refresh();
    });

    return () => {
      active = false;
      channel?.close();
    };
  }, []);

  return { workspaces, categories, ready };
}
