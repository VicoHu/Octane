/**
 * logo tab（pinned home 页）的唤起与常驻保证。
 *
 * 背景：Octane 放弃了 chrome_url_overrides.newtab，改为在 tab 栏常驻一个
 * pinned home tab 作为书签主页入口。本模块提供两个能力：
 * - focusOrCreateHomeTab：sidepanel"在 Octane 管理"、popup"打开书签主页"、
 *   background 的 onInstalled / windows.onCreated 共用。当前窗口已有 pinned
 *   home tab 则聚焦，否则创建 pinned。
 * - ensureHomeTabInAllWindows：background 的 onStartup / onInstalled(update) 用，
 *   遍历所有窗口，给缺 pinned home tab 的窗口补建。
 * - dedupeHomeTabsInWindow：background 的 tabs.onUpdated 用，session restore
 *   竞态导致同窗口出现重复 pinned home tab 时，保留首个移除其余。
 *
 * 实现注意：chrome 引用必须在函数体内读取（运行时 globalThis.chrome），
 * 不能在模块顶层 const 绑定，否则测试覆盖 chrome 后不生效。
 */

// 项目无 @types/chrome：声明全局 chrome（运行时 globalThis.chrome），再用最小子集接口断言（参考 background.ts）。
declare const chrome: unknown;

interface ChromeLike {
  runtime: { getURL(path: string): string };
  tabs: {
    query(info: { url?: string; windowId?: number }): Promise<ChromeTab[]>;
    update(id: number, props: { active?: boolean }): Promise<unknown>;
    create(props: {
      url: string;
      pinned?: boolean;
      windowId?: number;
    }): Promise<unknown>;
    remove(id: number): Promise<unknown>;
  };
  windows: {
    getCurrent(): Promise<{ id?: number }>;
    update(id: number, props: { focused?: boolean }): Promise<unknown>;
    getAll(): Promise<{ id?: number }[]>;
  };
}
interface ChromeTab {
  id?: number;
  windowId: number;
  pinned: boolean;
}

/**
 * 唤起当前窗口（或指定 windowId）的 logo tab：
 * 已有 pinned home tab → 聚焦该 tab + 聚焦窗口；否则创建 pinned。
 */
export async function focusOrCreateHomeTab(windowId?: number): Promise<void> {
  const c = chrome as unknown as ChromeLike;
  const url = c.runtime.getURL('home.html');
  const winId = windowId ?? (await c.windows.getCurrent()).id;
  const tabs = await c.tabs.query({ url });
  const logoTab = tabs.find(
    (t) => t.windowId === winId && t.pinned && t.id != null,
  );
  if (logoTab) {
    await c.tabs.update(logoTab.id!, { active: true });
    if (winId != null) await c.windows.update(winId, { focused: true });
  } else {
    await c.tabs.create({ url, pinned: true });
  }
}

/**
 * 遍历所有窗口，给每个缺 pinned home tab 的窗口补建。
 * background 的 onStartup / onInstalled(update) 用，保证重启/升级后常驻。
 */
export async function ensureHomeTabInAllWindows(): Promise<void> {
  const c = chrome as unknown as ChromeLike;
  const url = c.runtime.getURL('home.html');
  const windows = await c.windows.getAll();
  for (const w of windows) {
    if (w.id == null) continue;
    const tabs = await c.tabs.query({ url, windowId: w.id });
    if (!tabs.some((t) => t.pinned)) {
      await c.tabs.create({ url, pinned: true, windowId: w.id });
    }
  }
}

/**
 * 去重：同一窗口若存在多个 pinned home tab，保留首个，移除其余。
 *
 * 背景：windows.onCreated 触发早于浏览器 session restore 完成，
 * focusOrCreateHomeTab 此时 query 查不到恢复中的 pinned tab 而误建第二个，
 * 待 restore 完成后窗口内出现重复 logo tab。本函数在 home tab 加载完成
 * （tabs.onUpdated status=complete）后调用，可靠兜底去重。
 */
export async function dedupeHomeTabsInWindow(windowId: number): Promise<void> {
  const c = chrome as unknown as ChromeLike;
  const url = c.runtime.getURL('home.html');
  const tabs = await c.tabs.query({ url, windowId });
  const dups = tabs.filter((t) => t.pinned && t.id != null);
  if (dups.length <= 1) return;
  for (let i = 1; i < dups.length; i++) {
    const t = dups[i];
    if (t?.id == null) continue;
    await c.tabs.remove(t.id);
  }
}
