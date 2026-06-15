import { describe, it, expect } from 'vitest';
import { extractHostname } from '@/entrypoints/sidepanel/utils/url';

describe('extractHostname — 从 url 提取 hostname', () => {
  it('https url 提取 hostname（含子域 www.）', () => {
    expect(extractHostname('https://www.google.com/search?q=x')).toBe('www.google.com');
  });

  it('裸域提取', () => {
    expect(extractHostname('https://github.com')).toBe('github.com');
  });

  it('http 协议同样支持', () => {
    expect(extractHostname('http://example.com')).toBe('example.com');
  });

  it('IP:port 提取 hostname 不含端口', () => {
    expect(extractHostname('http://192.168.1.1:8080')).toBe('192.168.1.1');
  });

  it('localhost 提取', () => {
    expect(extractHostname('http://localhost:3000')).toBe('localhost');
  });

  it('chrome:// 协议 → null', () => {
    expect(extractHostname('chrome://newtab')).toBeNull();
  });

  it('chrome-extension:// 协议 → null', () => {
    expect(extractHostname('chrome-extension://abc/options.html')).toBeNull();
  });

  it('about: 协议 → null', () => {
    expect(extractHostname('about:blank')).toBeNull();
  });

  it('file:// 协议 → null', () => {
    expect(extractHostname('file:///Users/x/index.html')).toBeNull();
  });

  it('空字符串 → null', () => {
    expect(extractHostname('')).toBeNull();
  });

  it('非 url 纯文本 → null', () => {
    expect(extractHostname('这不是一个网址')).toBeNull();
  });
});
