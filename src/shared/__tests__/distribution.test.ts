import { describe, it, expect } from 'vitest';
import {
  detectChannel,
  compareVersions,
  UPDATE_URL,
  CHANNEL_LABEL,
  CWS_EXTENSION_ID,
} from '../distribution';

describe('detectChannel', () => {
  it('CWS ID 命中 → cws', () => {
    expect(detectChannel(CWS_EXTENSION_ID)).toBe('cws');
  });
  it('未知 ID → manual（安全 fallback）', () => {
    expect(detectChannel('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('manual');
    expect(detectChannel('')).toBe('manual');
  });
});

describe('UPDATE_URL / CHANNEL_LABEL', () => {
  it('CWS URL 含扩展 ID', () => {
    expect(UPDATE_URL.cws).toContain(CWS_EXTENSION_ID);
  });
  it('manual URL 指向 GitHub Releases', () => {
    expect(UPDATE_URL.manual).toBe('https://github.com/VicoHu/Octane/releases');
  });
  it('每个渠道有非空 label', () => {
    expect(CHANNEL_LABEL.cws).toBe('Chrome 商店版');
    expect(CHANNEL_LABEL.manual).toBe('手动安装');
  });
});

describe('compareVersions', () => {
  it('a 更新 → 正数', () => {
    expect(compareVersions('0.1.14.0', '0.1.13.0')).toBeGreaterThan(0);
  });
  it('相等 → 0', () => {
    expect(compareVersions('0.1.13.0', '0.1.13.0')).toBe(0);
  });
  it('b 更新 → 负数', () => {
    expect(compareVersions('0.1.12.0', '0.1.13.0')).toBeLessThan(0);
  });
  it('容忍 v 前缀', () => {
    expect(compareVersions('v0.1.14.0', '0.1.13.0')).toBeGreaterThan(0);
  });
  it('不等长缺位补 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
  });
});