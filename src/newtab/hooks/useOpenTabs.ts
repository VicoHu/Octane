import { useEffect, useState } from 'react';
import { normalizeUrl } from '@/shared/tabs/matchUrl';

/**
 * chrome 最小子集类型（项目无 @types/chrome，参考 focusOrCreateHomeTab.ts 的断言模式）。
 * 仅声明本 hook 用到的形状，避免引入 @types/chrome 全量类型。
 */
declare const chrome: unknown;

interface ChromeTabLike {
  id?: number;
  url?: string;
  /** 最近活跃时间（毫秒时间戳），用于同 key 多 tab 时取最近活跃的 */
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

/**
 * 监听当前窗口已打开的 tab，返回「规范化 host+pathname → tabId」映射。
 *
 * 用于 BookmarkCard 的「已打开 Tab」左侧竖线标识（设计 §2.2）+ Phase 2 点击跳转。
 *
 * - 挂载时 query 一次当前窗口全部 tab
 * - 监听 tabs.onCreated/onUpdated/onRemoved 实时刷新（tab 开关/导航后同步）
 * - 卸载时移除监听
 * - chrome 不可用时（测试 / 非扩展环境）返回空 Map，不抛错
 * - 同一 host+pathname 匹配多个 tab 时，取 lastAccessed 最大的（最近活跃）
 *
 * 匹配规则见 matchUrl.ts（host + pathname 精确比较）。
 */
export function useOpenTabs(): Map<string, number> {
  const [openTabs, setOpenTabs] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const c = chrome as unknown as ChromeLike | undefined;
    if (!c?.tabs?.query) return;

    let active = true;

    const refresh = async () => {
      try {
        const tabs = await c.tabs.query({ currentWindow: true });
        if (!active) return;
        const map = new Map<string, number>();
        const lastSeen = new Map<string, number>();
        for (const t of tabs) {
          if (t.id == null) continue;
          const key = normalizeUrl(t.url ?? '');
          if (!key) continue;
          // 同 key 多 tab：保留 lastAccessed 最大的（最近活跃）
          const ts = t.lastAccessed ?? 0;
          if (ts >= (lastSeen.get(key) ?? -1)) {
            lastSeen.set(key, ts);
            map.set(key, t.id);
          }
        }
        setOpenTabs(map);
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
