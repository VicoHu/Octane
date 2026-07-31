import { describe, expect, it } from 'vitest';
import {
  createProductionChromeAdapter,
  SessionContinuity,
  type SessionContinuityAdapter,
  type SessionContinuityTab,
} from '../sessionContinuity';

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const HOME_URL = 'chrome-extension://octane/home.html';

class MemoryChromeAdapter implements SessionContinuityAdapter {
  readonly storage = new Map<string, unknown>();
  readonly tabs = new Map<number, SessionContinuityTab>();
  readonly groups = new Map<number, { id: number; windowId: number; title?: string }>();
  windows = [{ id: 1, incognito: false }];
  private nextTabId = 100;

  async getStorage(keys: string | string[]): Promise<Record<string, unknown>> {
    const names = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(names.flatMap((key) =>
      this.storage.has(key) ? [[key, this.storage.get(key)]] : [],
    ));
  }

  async setStorage(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) this.storage.set(key, value);
  }

  async removeStorage(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.storage.delete(key);
  }

  async getNormalWindows() {
    return this.windows.filter((window) => !window.incognito);
  }

  async queryTabs(windowId: number): Promise<SessionContinuityTab[]> {
    return Array.from(this.tabs.values())
      .filter((tab) => tab.windowId === windowId)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  }

  async queryGroups(windowId: number) {
    return Array.from(this.groups.values()).filter((group) => group.windowId === windowId);
  }

  async createTab(details: { url: string; pinned: boolean; windowId: number; index: number; active: boolean }) {
    const tab = { id: this.nextTabId++, groupId: -1, discarded: false, ...details };
    this.tabs.set(tab.id, tab);
    return tab;
  }

  async updateTab(tabId: number, details: { active: boolean }): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error('标签页不存在');
    if (details.active) {
      for (const item of this.tabs.values()) {
        if (item.windowId === tab.windowId) item.active = false;
      }
    }
    tab.active = details.active;
  }

  async discardTab(tabId: number): Promise<void> {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error('标签页不存在');
    tab.discarded = true;
  }

  getHomeUrl(): string {
    return HOME_URL;
  }
}

function coordinator(adapter: MemoryChromeAdapter, validWorkspaceIds = [WS_A]) {
  return new SessionContinuity(adapter, {
    isWorkspaceValid: async (workspaceId) => validWorkspaceIds.includes(workspaceId),
    debounceMs: 0,
  });
}

function businessTab(partial: Partial<SessionContinuityTab> = {}): SessionContinuityTab {
  return {
    id: 1,
    windowId: 1,
    url: 'https://example.com/path?state=1#section',
    index: 0,
    groupId: -1,
    pinned: false,
    active: false,
    ...partial,
  };
}

describe('SessionContinuity — #64 当前 Workspace 冷启动恢复', () => {
  it('隔离开启：标签变化后的最新当前 Workspace 快照覆盖旧会话，并排除非归属页面', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({ tabIsolationSetting: 'hide', lastWorkspaceId: WS_A });
    adapter.tabs.set(1, businessTab({ index: 2, pinned: true }));
    adapter.tabs.set(2, businessTab({ id: 2, url: HOME_URL, index: 0, pinned: true }));
    adapter.tabs.set(3, businessTab({ id: 3, url: 'file:///private.txt', index: 3 }));
    adapter.tabs.set(4, businessTab({ id: 4, url: 'https://user-group.example', index: 4, groupId: 20 }));
    adapter.tabs.set(5, businessTab({ id: 5, url: 'https://mine.example', index: 1, groupId: 10 }));
    adapter.groups.set(10, { id: 10, windowId: 1, title: `A ·${WS_A.slice(0, 8)}` });
    adapter.groups.set(20, { id: 20, windowId: 1, title: '用户分组' });

    const continuity = coordinator(adapter);
    continuity.notifyTopologyChanged();
    await continuity.flushAutosave();

    expect(adapter.storage.get(`tabSession.${WS_A}`)).toMatchObject({
      tabs: [
        { url: 'https://mine.example', pinned: false, order: 1 },
        { url: 'https://example.com/path?state=1#section', pinned: true, order: 2 },
      ],
    });
  });

  it('旧的延迟写在新快照后完成：最终仍保留新快照', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({ tabIsolationSetting: 'close', lastWorkspaceId: WS_A });
    adapter.tabs.set(1, businessTab({ url: 'https://old.example' }));

    let releaseOldWrite: (() => void) | undefined;
    const oldWriteReleased = new Promise<void>((resolve) => { releaseOldWrite = resolve; });
    let signalOldWriteStarted: (() => void) | undefined;
    const oldWriteStarted = new Promise<void>((resolve) => { signalOldWriteStarted = resolve; });
    let signalNewWriteCommitted: (() => void) | undefined;
    const newWriteCommitted = new Promise<void>((resolve) => { signalNewWriteCommitted = resolve; });
    let newWriteStarted = false;
    const setStorage = adapter.setStorage.bind(adapter);
    let writeCount = 0;
    adapter.setStorage = async (values) => {
      writeCount++;
      if (writeCount === 1) {
        signalOldWriteStarted?.();
        await oldWriteReleased;
      }
      await setStorage(values);
      if (writeCount === 2) signalNewWriteCommitted?.();
    };

    const continuity = coordinator(adapter);
    continuity.notifyTopologyChanged();
    const firstFlush = continuity.flushAutosave();
    await oldWriteStarted;

    adapter.tabs.set(1, businessTab({ url: 'https://new.example' }));
    continuity.notifyTopologyChanged();
    const secondFlush = continuity.flushAutosave();
    await new Promise((resolve) => setTimeout(resolve, 0));
    newWriteStarted = writeCount === 2;
    if (newWriteStarted) {
      await newWriteCommitted;
    }
    releaseOldWrite?.();
    await Promise.all([firstFlush, secondFlush]);

    expect(adapter.storage.get(`tabSession.${WS_A}`)).toMatchObject({
      tabs: [{ url: 'https://new.example' }],
    });
  });

  it('一次写入失败后：后续自动保存仍能写入最新快照', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({ tabIsolationSetting: 'close', lastWorkspaceId: WS_A });
    adapter.tabs.set(1, businessTab({ url: 'https://failed.example' }));

    const setStorage = adapter.setStorage.bind(adapter);
    let writeCount = 0;
    adapter.setStorage = async (values) => {
      writeCount++;
      if (writeCount === 1) throw new Error('第一次写入失败');
      await setStorage(values);
    };

    const continuity = coordinator(adapter);
    continuity.notifyTopologyChanged();
    await expect(continuity.flushAutosave()).rejects.toThrow('第一次写入失败');

    adapter.tabs.set(1, businessTab({ url: 'https://recovered.example' }));
    continuity.notifyTopologyChanged();
    await continuity.flushAutosave();

    expect(adapter.storage.get(`tabSession.${WS_A}`)).toMatchObject({
      tabs: [{ url: 'https://recovered.example' }],
    });
  });

  it('production adapter：只查询并返回非隐身 normal 窗口', async () => {
    const originalChrome = (globalThis as Record<string, unknown>).chrome;
    let query: unknown;
    (globalThis as Record<string, unknown>).chrome = {
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
      windows: {
        getAll: async (details: unknown) => {
          query = details;
          return [
            { id: 1, type: 'normal', incognito: false },
            { id: 2, type: 'popup', incognito: false },
            { id: 3, type: 'normal', incognito: true },
          ];
        },
      },
      tabs: {
        query: async () => [],
        create: async () => businessTab(),
        update: async () => {},
        discard: async () => {},
      },
      tabGroups: { query: async () => [] },
      runtime: { getURL: () => HOME_URL },
    };

    try {
      const adapter = createProductionChromeAdapter();
      expect(adapter).not.toBeNull();
      expect(await adapter!.getNormalWindows()).toEqual([{ id: 1, incognito: false }]);
      expect(query).toEqual({ windowTypes: ['normal'] });
    } finally {
      (globalThis as Record<string, unknown>).chrome = originalChrome;
    }
  });

  it('关闭浏览器后无原生业务标签：恢复最新会话、Home 保持活动且业务标签已释放', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({
      tabIsolationSetting: 'close',
      lastWorkspaceId: WS_A,
      [`tabSession.${WS_A}`]: {
        tabs: [
          { url: 'https://one.example?view=a#top', pinned: false, order: 1 },
          { url: 'https://two.example', pinned: true, order: 2 },
        ],
        savedAt: 1,
      },
    });
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));

    const continuity = coordinator(adapter);
    await continuity.startColdRecovery();

    const tabs = await adapter.queryTabs(1);
    expect(tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: HOME_URL, active: true, pinned: true }),
      expect.objectContaining({ url: 'https://one.example?view=a#top', active: false, discarded: true }),
      expect.objectContaining({ url: 'https://two.example', pinned: true, active: false, discarded: true }),
    ]));
  });

  it('off：不保存、不主动恢复，并保留已有工作区会话', async () => {
    const adapter = new MemoryChromeAdapter();
    const oldSession = { tabs: [{ url: 'https://kept.example', order: 0 }], savedAt: 1 };
    await adapter.setStorage({
      tabIsolationSetting: 'off',
      lastWorkspaceId: WS_A,
      [`tabSession.${WS_A}`]: oldSession,
    });
    adapter.tabs.set(1, businessTab());

    const continuity = coordinator(adapter);
    continuity.notifyTopologyChanged();
    await continuity.flushAutosave();
    await continuity.startColdRecovery();

    expect(adapter.storage.get(`tabSession.${WS_A}`)).toEqual(oldSession);
    expect(adapter.storage.get('sessionContinuity.topology')).toBeUndefined();
    expect(await adapter.queryTabs(1)).toEqual([businessTab()]);
  });

  it('多个普通窗口：冷恢复 fail closed，不创建或移动任何业务标签页', async () => {
    const adapter = new MemoryChromeAdapter();
    adapter.windows = [{ id: 1, incognito: false }, { id: 2, incognito: false }];
    await adapter.setStorage({
      tabIsolationSetting: 'hide-discard',
      lastWorkspaceId: WS_A,
      [`tabSession.${WS_A}`]: { tabs: [{ url: 'https://missing.example', order: 0 }], savedAt: 1 },
    });
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));

    await coordinator(adapter).startColdRecovery();

    expect(await adapter.queryTabs(1)).toEqual([businessTab({ url: HOME_URL, pinned: true, active: true })]);
  });

  it('恢复期间收到标签变化：中间拓扑不会覆盖恢复前的完整会话', async () => {
    const adapter = new MemoryChromeAdapter();
    const snapshot = { tabs: [{ url: 'https://keep.example', order: 0 }], savedAt: 1 };
    await adapter.setStorage({
      tabIsolationSetting: 'close',
      lastWorkspaceId: WS_A,
      [`tabSession.${WS_A}`]: snapshot,
    });
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));

    const continuity = coordinator(adapter);
    const originalCreate = adapter.createTab.bind(adapter);
    adapter.createTab = async (details) => {
      continuity.notifyTopologyChanged();
      return originalCreate(details);
    };
    await continuity.startColdRecovery();
    await continuity.flushAutosave();

    expect(adapter.storage.get(`tabSession.${WS_A}`)).toEqual(snapshot);
  });

  it('旧版本无 topology：仅恢复有效的 lastWorkspaceId，不枚举历史会话', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({
      tabIsolationSetting: 'hide',
      lastWorkspaceId: WS_A,
      [`tabSession.${WS_A}`]: { tabs: [{ url: 'https://current.example', order: 0 }], savedAt: 1 },
      'tabSession.old-workspace': { tabs: [{ url: 'https://history.example', order: 0 }], savedAt: 1 },
    });
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));

    await coordinator(adapter).startColdRecovery();

    const urls = (await adapter.queryTabs(1)).map((tab) => tab.url);
    expect(urls).toContain('https://current.example');
    expect(urls).not.toContain('https://history.example');
  });
});
