import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { focusTab } from '../focusTab';

/**
 * focusTab 跳转兜底测试。
 *
 * 设计背景(autoplan Eng Review R2):tab 可能在「渲染列表」与「点击跳转」之间被关闭,
 * 此时 chrome.tabs.update(tabId) 会 reject("No tab with id"),裸 await 会产生未捕获的
 * promise rejection。focusTab 需 try/catch,失败时用 url 回退 window.open。
 *
 * 签名:focusTab(tabId, url?) —— url 可选,仅作兜底用;不传则不回退(保持向后兼容,
 * 现有 Content.handleCardClick 只传 tabId 的调用不受影响)。
 */

describe('focusTab — stale tabId 兜底', () => {
  beforeEach(() => {
    // jsdom 无 chrome / window.open,各自打桩
    (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
    Object.defineProperty(globalThis, 'open', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('正常激活:chrome.tabs.update 成功 → 不回退 window.open', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    (globalThis as unknown as { chrome: unknown }).chrome = { tabs: { update } };
    const openSpy = vi.spyOn(globalThis, 'open');

    await focusTab(42, 'https://example.com');

    expect(update).toHaveBeenCalledWith(42, { active: true });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('stale tabId:update reject 且提供了 url → 回退 window.open(url)', async () => {
    const update = vi.fn().mockRejectedValue(new Error('No tab with id: 42'));
    (globalThis as unknown as { chrome: unknown }).chrome = { tabs: { update } };
    const openSpy = vi.spyOn(globalThis, 'open').mockReturnValue(null);

    // 不应抛出(否则未捕获 rejection)
    await expect(focusTab(42, 'https://example.com/page')).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledWith(42, { active: true });
    expect(openSpy).toHaveBeenCalledWith('https://example.com/page', '_blank');
  });

  it('stale tabId 但未提供 url → 不回退,也不抛出(向后兼容,仅吞掉 rejection)', async () => {
    const update = vi.fn().mockRejectedValue(new Error('No tab with id: 42'));
    (globalThis as unknown as { chrome: unknown }).chrome = { tabs: { update } };
    const openSpy = vi.spyOn(globalThis, 'open');

    await expect(focusTab(42)).resolves.toBeUndefined();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('chrome 不可用 → 直接 noop(不抛错)', async () => {
    await expect(focusTab(42, 'https://example.com')).resolves.toBeUndefined();
    expect(globalThis.open).not.toHaveBeenCalled();
  });
});
