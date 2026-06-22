import { useEffect, useState } from 'react';
import { normalizeUrl } from '@/shared/tabs/matchUrl';

/**
 * chrome 最小子集类型（项目无 @types/chrome，参考 focusOrCreateHomeTab.ts 的断言模式）。
 * 仅声明本 hook 用到的形状，避免引入 @types/chrome 全量类型。
 */
declare const chrome: unknown;

interface ChromeTabLike {
  url?: string;
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

/**
 * 监听当前窗口已打开的 tab，返回规范化的 host+pathname 集合。
 *
 * 用于 BookmarkCard 的"已打开 Tab"左侧竖线标识（设计 §2.2）。
 *
 * - 挂载时 query 一次当前窗口全部 tab
 * - 监听 tabs.onCreated/onUpdated/onRemoved 实时刷新（tab 开关/导航后竖线同步）
 * - 卸载时移除监听
 * - chrome 不可用时（测试 / 非扩展环境）返回空集合，不抛错
 *
 * 匹配规则见 matchUrl.ts（host + pathname 精确比较）。
 */
export function useOpenTabs(): Set<string> {
  const [openUrls, setOpenUrls] = useState<Set<string>>(new Set());

  useEffect(() => {
    const c = chrome as unknown as ChromeLike | undefined;
    if (!c?.tabs?.query) return;

    let active = true;

    const refresh = async () => {
      try {
        const tabs = await c.tabs.query({ currentWindow: true });
        if (!active) return;
        const set = new Set<string>();
        for (const t of tabs) {
          const key = normalizeUrl(t.url ?? '');
          if (key) set.add(key);
        }
        setOpenUrls(set);
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

  return openUrls;
}
