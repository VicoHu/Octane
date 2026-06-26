/**
 * 聚焦指定 tab（激活到前台）。
 *
 * Phase 2：点击已打开书签 → 跳转到 useOpenTabs 匹配到的 tab。
 * tab 来自 currentWindow 查询，已在当前窗口，仅需 tabs.update 激活，
 * 无需额外 windows.update（用户正在用当前窗口）。
 *
 * 实现注意：chrome 引用在函数体内读取（参考 focusOrCreateHomeTab.ts）。
 */
declare const chrome: unknown;

interface ChromeLike {
  tabs: {
    update(id: number, props: { active?: boolean }): Promise<unknown>;
  };
}

export async function focusTab(tabId: number): Promise<void> {
  const c = chrome as unknown as ChromeLike | undefined;
  if (!c?.tabs?.update) return;
  await c.tabs.update(tabId, { active: true });
}
