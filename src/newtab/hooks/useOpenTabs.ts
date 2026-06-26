import { useEffect, useState } from 'react';

/**
 * chrome 最小子集类型（项目无 @types/chrome，参考 focusOrCreateHomeTab.ts 的断言模式）。
 * 仅声明本 hook 用到的形状，避免引入 @types/chrome 全量类型。
 */
declare const chrome: unknown;

interface ChromeTabLike {
  id?: number;
  url?: string;
  /** 最近活跃时间（毫秒时间戳），用于排序取最近活跃的 tab */
  lastAccessed?: number;
}

interface TabsEventEmitter {
  addListener(cb: () => void): void;
  removeListener(cb: () => void): void;
}

interface ChromeLike {
  tabs: {
    query(info: { currentWindow: boolean }): Promise<ChromeTabLike[]>;
    onCreated: TabsEventEmitter;
    onUpdated: TabsEventEmitter;
    onRemoved: TabsEventEmitter;
  };
}

/** 已打开 Tab 的最小投影：Content 层用 bookmarkMatchesOpenTab 做前缀匹配。 */
export interface OpenTab {
  url: string;
  tabId: number;
  lastAccessed: number;
}

/**
 * 监听当前窗口已打开的 tab，返回「按最近活跃降序」的 OpenTab 列表。
 *
 * 用于 BookmarkCard 的「已打开 Tab」左侧竖线标识（设计 §2.2）+ Phase 2 点击跳转。
 *
 * - 挂载时 query 一次当前窗口全部 tab
 * - 监听 tabs.onCreated/onUpdated/onRemoved 实时刷新（tab 开关/导航后同步）
 * - 卸载时移除监听
 * - chrome 不可用时（测试 / 非扩展环境）返回空列表，不抛错
 *
 * 返回降序列表：Content 的 handleCardClick 用 find 取首个匹配，即最近活跃的同站 tab。
 * 匹配规则（段边界前缀）见 matchUrl.ts 的 bookmarkMatchesOpenTab。
 */
export function useOpenTabs(): OpenTab[] {
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);

  useEffect(() => {
    const c = chrome as unknown as ChromeLike | undefined;
    if (!c?.tabs?.query) return;

    let active = true;

    const refresh = async () => {
      try {
        const tabs = await c.tabs.query({ currentWindow: true });
        if (!active) return;
        const list: OpenTab[] = [];
        for (const t of tabs) {
          if (t.id == null || !t.url) continue;
          list.push({ url: t.url, tabId: t.id, lastAccessed: t.lastAccessed ?? 0 });
        }
        // 按最近活跃降序：handleCardClick 的 find 取首个即最近活跃同站 tab
        list.sort((a, b) => b.lastAccessed - a.lastAccessed);
        setOpenTabs(list);
      } catch {
        // query 失败（权限 / 环境问题）保持上次状态，不抛错
      }
    };

    refresh();
    c.tabs.onCreated.addListener(refresh);
    c.tabs.onUpdated.addListener(refresh);
    c.tabs.onRemoved.addListener(refresh);

    return () => {
      active = false;
      c.tabs.onCreated.removeListener(refresh);
      c.tabs.onUpdated.removeListener(refresh);
      c.tabs.onRemoved.removeListener(refresh);
    };
  }, []);

  return openTabs;
}
