import { describe, it, expect } from 'vitest';
import { isSafeFavIcon } from '../safeFavIcon';

/**
 * R7 favIconUrl scheme allowlist(防御纵深)。
 * <img src> 本身不执行脚本,但 tab 的 favIconUrl 来自运行时 chrome.tabs.Tab,
 * 不可信。仅放行已知安全 scheme,其余回退首字母。
 */
describe('isSafeFavIcon — favIcon scheme 白名单', () => {
  it('放行 https / http', () => {
    expect(isSafeFavIcon('https://example.com/favicon.ico')).toBe(true);
    expect(isSafeFavIcon('http://example.com/f.png')).toBe(true);
  });

  it('放行 data:image/* (favicon 常见 base64)', () => {
    expect(isSafeFavIcon('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeFavIcon('data:image/svg+xml,...')).toBe(true);
  });

  it('放行 chrome-extension:// (扩展自身图标)', () => {
    expect(isSafeFavIcon('chrome-extension://abc123/icon.png')).toBe(true);
  });

  it('拒绝 javascript: URI(XSS 防御)', () => {
    expect(isSafeFavIcon('javascript:alert(1)')).toBe(false);
  });

  it('拒绝非 image 的 data: URI(如 data:text/html)', () => {
    expect(isSafeFavIcon('data:text/html,<script>1</script>')).toBe(false);
  });

  it('拒绝空 / 未定义 / 异常 scheme', () => {
    expect(isSafeFavIcon('')).toBe(false);
    expect(isSafeFavIcon(undefined)).toBe(false);
    expect(isSafeFavIcon('blob:https://example.com/uuid')).toBe(false);
    expect(isSafeFavIcon('ftp://example.com/icon.png')).toBe(false);
  });
});
