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
  /** 页面标题（TabList 展示） */
  title?: string;
  /** 运行时 favicon（区别于书签存储的 faviconUrl） */
  favIconUrl?: string;
  /** 是否固定标签（pinned，UI 角标） */
  pinned?: boolean;
  /** 浏览器 tab 位置（tab 栏从左到右的索引，0 起），用于稳定排序 + 0.2.x 会话保存 */
  index?: number;
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
  /** 页面标题（TabList 展示，无值则省略） */
  title?: string;
  /** 运行时 favicon（无值则省略，TabCard 回退首字母） */
  favIconUrl?: string;
  /** 是否固定标签（无值则省略） */
  pinned?: boolean;
  /** 浏览器 tab 位置（无值则省略） */
  index?: number;
}

/**
 * 判断 url 是否为浏览器内部页 / 扩展页，应从 TabList 过滤掉。
 * 这些页无法被书签业务匹配，且多为噪声（newtab/settings/自身 home 等）。
 */
function isInternalPage(url: string): boolean {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://')
  );
}

/**
 * 监听当前窗口已打开的 tab，返回「按浏览器位置(index)升序」的 OpenTab 列表
 * (与浏览器 tab 栏顺序一致)。
 *
 * 用于:TabList 标签页视图展示 + BookmarkCard 的「已打开 Tab」竖线标识 + 书签点击跳转。
 *
 * - 挂载时 query 一次当前窗口全部 tab
 * - 监听 tabs.onCreated/onUpdated/onRemoved 实时刷新（tab 开关/导航后同步）
 * - 卸载时移除监听
 * - chrome 不可用时（测试 / 非扩展环境）返回空列表，不抛错
 *
 * 排序:按 index 升序(浏览器实际顺序)。lastAccessed 仅作字段保留,不参与默认排序;
 * 需"最近活跃"语义处(如书签点击跳转)用 matchUrl.ts 的 pickMostRecentMatchingTab 显式取。
 * 匹配规则(段边界前缀)见 matchUrl.ts 的 bookmarkMatchesOpenTab。
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
          // 过滤浏览器内部页 / 扩展页（含自身 home）：噪声且无法业务匹配
          if (isInternalPage(t.url)) continue;
          list.push({
            url: t.url,
            tabId: t.id,
            lastAccessed: t.lastAccessed ?? 0,
            title: t.title,
            favIconUrl: t.favIconUrl,
            pinned: t.pinned,
            index: t.index,
          });
        }
        // 按浏览器位置(index)升序:tab 列表须与浏览器 tab 栏顺序一致,避免用户困惑。
        // lastAccessed 不再作默认排序,仅保留为字段(书签点击跳转等需"最近活跃"时显式取,
        // 见 matchUrl.ts 的 pickMostRecentMatchingTab)。chrome.tabs.query 默认已按 index
        // 返回,此处显式排序作防御。
        list.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
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
