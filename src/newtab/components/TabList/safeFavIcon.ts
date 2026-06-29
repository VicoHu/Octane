/**
 * R7 favIconUrl scheme 白名单(防御纵深)。
 *
 * tab 的 favIconUrl 来自运行时 chrome.tabs.Tab,属不可信输入。<img src> 本身不执行
 * 脚本,但为防御纵深(data: SVG、异常 scheme),仅放行已知安全 scheme,其余由 TabCard
 * 回退首字母占位。
 */
export function isSafeFavIcon(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('https://') || url.startsWith('http://')) return true;
  if (url.startsWith('chrome-extension://')) return true;
  if (url.startsWith('data:image/')) return true;
  return false;
}
