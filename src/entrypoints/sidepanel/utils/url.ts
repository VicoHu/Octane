/**
 * 从 url 提取 hostname。
 *
 * 仅接受 http/https 协议的 url；chrome://、about:、file:// 等浏览器
 * 特殊协议与无法解析的字符串返回 null——side panel 据此显示
 * "此页面不支持联动"，不报错（对应 test plan codepath E1）。
 *
 * @returns hostname（new URL().hostname 形式，不含端口/协议）；
 *          非 http(s) 或解析失败返回 null
 */
export function extractHostname(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return hostname;
  } catch {
    return null;
  }
}
