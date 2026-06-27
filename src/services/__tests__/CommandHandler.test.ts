import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCommand } from '../CommandHandler';
import * as homeTab from '@/shared/tabs/focusOrCreateHomeTab';

describe('handleCommand（快捷键命令分发）', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('open-home → 调用 focusOrCreateHomeTab', async () => {
    const spy = vi.spyOn(homeTab, 'focusOrCreateHomeTab').mockResolvedValue(undefined);
    await handleCommand('open-home');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('open-home 失败 → 不抛出，记 error 日志', async () => {
    vi.spyOn(homeTab, 'focusOrCreateHomeTab').mockRejectedValue(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(handleCommand('open-home')).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });

  it('未知命令（_execute_side_panel_action 由 Chrome 直接处理、不经 onCommand）→ 无副作用', async () => {
    const homeSpy = vi.spyOn(homeTab, 'focusOrCreateHomeTab').mockResolvedValue(undefined);
    await handleCommand('_execute_side_panel_action');
    await handleCommand('whatever');
    expect(homeSpy).not.toHaveBeenCalled();
  });
});
