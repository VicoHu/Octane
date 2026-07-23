import { describe, it, expect } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';
import { getTabIsolationSetting, setTabIsolationSetting } from '../tabIsolationSetting';

// tabIsolationSetting：工作区标签隔离开关 storage.local key = 'off' | 'close'。
// 用 installChromeStorageLocal 装真实 in-memory storage.local 往返（规范 §6）。

describe('tabIsolationSetting — 隔离开关 storage.local CRUD', () => {
  it('默认 off（未设置 → 不隔离）', async () => {
    installChromeStorageLocal({});
    expect(await getTabIsolationSetting()).toBe('off');
  });

  it('set close → get close', async () => {
    const { store } = installChromeStorageLocal({});
    await setTabIsolationSetting('close');
    expect(await getTabIsolationSetting()).toBe('close');
    expect(store.tabIsolationSetting).toBe('close');
  });

  it('set off → get off（显式关闭）', async () => {
    installChromeStorageLocal({});
    await setTabIsolationSetting('off');
    expect(await getTabIsolationSetting()).toBe('off');
  });

  it('非法值（手动篡改）→ 回退 off', async () => {
    installChromeStorageLocal({ initial: { tabIsolationSetting: 'bogus' } });
    expect(await getTabIsolationSetting()).toBe('off');
  });
});

describe('tabIsolationSetting hide 档', () => {
  it('getTabIsolationSetting 接受 hide-discard / hide（默认 off）', async () => {
    installChromeStorageLocal({});
    const { getTabIsolationSetting, setTabIsolationSetting } = await import('../tabIsolationSetting');
    await setTabIsolationSetting('hide-discard');
    expect(await getTabIsolationSetting()).toBe('hide-discard');
    await setTabIsolationSetting('hide');
    expect(await getTabIsolationSetting()).toBe('hide');
    // 非法值回退 off
    await setTabIsolationSetting('unknown' as never);
    expect(await getTabIsolationSetting()).toBe('off');
  });
});
