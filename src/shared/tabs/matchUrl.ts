/**
 * URL 规范化与匹配：书签 URL 与已打开 Tab URL 的匹配规则。
 *
 * 规则（用户决策，设计 §2.2）：精确比较 url.host + url.pathname，
 * 忽略 protocol / query / hash。
 * 例：https://github.com/user/repo?a=1 与 http://github.com/user/repo#top 匹配，
 * 但不匹配 https://github.com/user/repo/sub。
 */

/**
 * 将 URL 规范化为 host + pathname 串，作为匹配 key。
 * 非法 URL 返回 null。
 *
 * 用 host（含端口）而非 hostname：遵循用户指定的 window.location.host 语义。
 */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.host + u.pathname;
  } catch {
    return null;
  }
}

/**
 * 判断两个 URL 是否匹配（host + pathname 相等）。任一非法返回 false。
 */
export function urlsMatch(a: string, b: string): boolean {
  const na = normalizeUrl(a);
  const nb = normalizeUrl(b);
  return na !== null && nb !== null && na === nb;
}

/**
 * 归一 pathname：去掉末尾斜杠（根 '/' → ''）。
 * 使 /archives 与 /archives/ 等价；根路径归一为空串后，
 * `tabPath.startsWith(bmPath + '/')` 即 `startsWith('/')`，可匹配同站任意页。
 */
function normPath(pathname: string): string {
  return pathname.replace(/\/+$/, '');
}

/**
 * 判断书签 URL 是否匹配某已打开 Tab URL（单轨方案，段边界前缀）。
 *
 * 匹配规则（设计 §2.2 修订）：host 相等 + tab 路径等于书签路径或在其之下。
 * 即 tab 在书签所指页面或其子路径时视为「已打开」。任一非法 URL 返回 false。
 *
 * - 根书签（path '/'）匹配同站任意页（接受的权衡：站点根书签，开着站点任何页都算）
 * - 段边界：/blog 不匹配 /blogger（startsWith('/blog/') 为 false）
 * - 末尾斜杠归一：/archives ≡ /archives/
 * - 忽略 protocol / query / hash（仅比较 host + pathname）
 */
export function bookmarkMatchesOpenTab(bmUrl: string, tabUrl: string): boolean {
  let bm: URL;
  let tab: URL;
  try {
    bm = new URL(bmUrl);
    tab = new URL(tabUrl);
  } catch {
    return false;
  }
  if (bm.host !== tab.host) return false;
  const bmPath = normPath(bm.pathname);
  const tabPath = normPath(tab.pathname);
  return tabPath === bmPath || tabPath.startsWith(bmPath + '/');
}

/**
 * 在一组 tab 中,挑出与书签 URL 匹配且最近活跃(lastAccessed 最大)的那个。
 *
 * 用途:书签点击跳转——当一个书签对应多个已打开 tab 时,聚焦"最近活跃"的那个
 * (原 Phase 2 语义)。
 *
 * 显式按 lastAccessed 取最大,**不依赖传入数组顺序**:useOpenTabs 数据源已改为按
 * 浏览器位置(index)排序,书签跳转不能再靠数组首位取最近活跃,故提取此纯函数。
 * 无匹配返回 undefined。
 */
export function pickMostRecentMatchingTab<T extends { url: string; lastAccessed: number }>(
  tabs: T[],
  bmUrl: string,
): T | undefined {
  let best: T | undefined;
  let bestTs = -Infinity;
  for (const t of tabs) {
    if (bookmarkMatchesOpenTab(bmUrl, t.url) && t.lastAccessed > bestTs) {
      best = t;
      bestTs = t.lastAccessed;
    }
  }
  return best;
}
