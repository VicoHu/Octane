/**
 * 聚焦指定 tab（激活到前台）。
 *
 * Phase 2：点击已打开书签 → 跳转到 useOpenTabs 匹配到的 tab。
 * tab 来自 currentWindow 查询，已在当前窗口，仅需 tabs.update 激活，
 * 无需额外 windows.update（用户正在用当前窗口）。
 *
 * 兜底（autoplan Eng Review R2）：tab 可能在「列表渲染」与「点击跳转」之间被关闭，
 * 此时 chrome.tabs.update 会 reject（"No tab with id"）。try/catch 吞掉 rejection；
 * 若调用方提供了 url，则回退 window.open(url) 新开标签，避免跳转静默失败。
 *
 * 实现注意：chrome 引用在函数体内读取（参考 focusOrCreateHomeTab.ts）。
 */
declare const chrome: unknown;

interface ChromeLike {
  tabs: {
    update(id: number, props: { active?: boolean }): Promise<unknown>;
  };
}

export async function focusTab(tabId: number, url?: string): Promise<void> {
  const c = chrome as unknown as ChromeLike | undefined;
  if (!c?.tabs?.update) return;
  try {
    await c.tabs.update(tabId, { active: true });
  } catch {
    // tab 已关闭等：提供了 url 则回退新开，否则仅吞掉 rejection（不抛未捕获 promise）
    if (url) window.open(url, '_blank');
  }
}
