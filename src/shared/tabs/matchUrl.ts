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
