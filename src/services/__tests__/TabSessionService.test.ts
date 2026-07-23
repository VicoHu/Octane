import { describe, it, expect } from 'vitest';
import { installChromeStorageLocal } from '@/test/storageMock';
import { getTabSession, saveTabSession, clearTabSession } from '../TabSessionService';
import type { TabEntry } from '@/shared/types';

// TabSessionService：工作区标签会话存 chrome.storage.local 分键（tabSession.<wsId>）。
// 用 installChromeStorageLocal 装真实 in-memory storage.local 往返（规范 §6：service 测真实往返，
// 只 mock 副作用边界，不 mock 被测逻辑）。

describe('TabSessionService — 工作区标签会话 storage.local 分键 CRUD', () => {
  it('get 不存在的 workspace → 返回 null', async () => {
    installChromeStorageLocal({});
    expect(await getTabSession('ws-none')).toBeNull();
  });

  it('save 后 get → 返回有序 TabEntry（含 url/pinned/order）', async () => {
    installChromeStorageLocal({});
    const tabs: TabEntry[] = [
      { url: 'https://a.com', order: 0 },
      { url: 'https://b.com', pinned: true, order: 1 },
    ];
    await saveTabSession('ws-1', tabs);
    const session = await getTabSession('ws-1');
    expect(session).not.toBeNull();
    expect(session!.tabs).toEqual(tabs);
    expect(session!.tabs[1]).toMatchObject({ url: 'https://b.com', pinned: true, order: 1 });
    expect(typeof session!.savedAt).toBe('number');
  });

  it('clear workspace 后 get → 返回 null', async () => {
    installChromeStorageLocal({});
    await saveTabSession('ws-2', [{ url: 'https://c.com', order: 0 }]);
    await clearTabSession('ws-2');
    expect(await getTabSession('ws-2')).toBeNull();
  });

  it('分键：不同 workspace 会话互不覆盖（rev4 核心 invariant）', async () => {
    installChromeStorageLocal({});
    await saveTabSession('ws-a', [{ url: 'https://a.com', order: 0 }]);
    await saveTabSession('ws-b', [{ url: 'https://b.com', order: 0 }]);
    const a = await getTabSession('ws-a');
    const b = await getTabSession('ws-b');
    expect(a!.tabs[0]!.url).toBe('https://a.com');
    expect(b!.tabs[0]!.url).toBe('https://b.com');
  });
});
