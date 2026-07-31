import { describe, expect, it, vi } from 'vitest';
import {
  createProductionChromeAdapter,
  SessionContinuity,
  type SessionContinuityAdapter,
  type SessionContinuityTab,
} from '../sessionContinuity';

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const WS_B = 'bbbbbbbb-0000-0000-0000-000000000000';
const WS_C = 'cccccccc-0000-0000-0000-000000000000';
const HOME_URL = 'chrome-extension://octane/home.html';

class MemoryChromeAdapter implements SessionContinuityAdapter {
  readonly storage = new Map<string, unknown>();
  readonly tabs = new Map<number, SessionContinuityTab>();
  readonly groups = new Map<number, { id: number; windowId: number; title?: string }>();
  windows = [{ id: 1, incognito: false }];
  private nextTabId = 100;
  private nextGroupId = 100;

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

  async groupTabs(tabIds: number[], windowId: number, groupId?: number): Promise<number> {
    const id = groupId ?? this.nextGroupId++;
    if (!this.groups.has(id)) this.groups.set(id, { id, windowId });
    for (const tabId of tabIds) {
      const tab = this.tabs.get(tabId);
      if (tab) tab.groupId = id;
    }
    return id;
  }

  async ungroupTabs(tabIds: number[]): Promise<void> {
    for (const tabId of tabIds) {
      const tab = this.tabs.get(tabId);
      if (tab) tab.groupId = -1;
    }
  }

  async updateGroup(groupId: number, details: { title?: string; collapsed?: boolean }): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('标签组不存在');
    Object.assign(group, details);
  }

  getHomeUrl(): string {
    return HOME_URL;
  }
}

function coordinator(adapter: MemoryChromeAdapter, validWorkspaceIds = [WS_A]) {
  return new SessionContinuity(adapter, {
    isWorkspaceValid: async (workspaceId) => validWorkspaceIds.includes(workspaceId),
    listWorkspaceIds: async () => validWorkspaceIds,
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

describe('SessionContinuity — #66 驻留 Workspace 冷恢复', () => {
  it.each(['hide', 'hide-discard'] as const)('%s：A 驻留、B 当前后重启 → B 散开，A 折叠并全部释放，Home 活动', async (setting) => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({ tabIsolationSetting: setting, lastWorkspaceId: WS_B });
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true, index: 0 }));
    adapter.tabs.set(2, businessTab({ id: 2, url: 'https://a-1.example', groupId: 10, index: 1 }));
    adapter.tabs.set(3, businessTab({ id: 3, url: 'https://a-2.example', groupId: 10, index: 2 }));
    adapter.tabs.set(4, businessTab({ id: 4, url: 'https://a-3.example', groupId: 10, index: 3 }));
    adapter.tabs.set(5, businessTab({ id: 5, url: 'https://b-1.example', index: 4 }));
    adapter.tabs.set(6, businessTab({ id: 6, url: 'https://b-2.example', index: 5 }));
    adapter.tabs.set(7, businessTab({ id: 7, url: 'https://b-3.example', index: 6 }));
    adapter.tabs.set(8, businessTab({ id: 8, url: 'https://b-4.example', index: 7 }));
    adapter.groups.set(10, { id: 10, windowId: 1, title: 'A ·aaaaaaaa' });

    const continuity = coordinator(adapter, [WS_A, WS_B]);
    continuity.notifyTopologyChanged();
    await continuity.flushAutosave();
    expect(adapter.storage.get('sessionContinuity.topology')).toEqual({
      currentWorkspaceId: WS_B,
      residents: [{ workspaceId: WS_A, title: 'A ·aaaaaaaa' }],
    });
    await adapter.setStorage({
      [`tabSession.${WS_A}`]: {
        tabs: [
          { url: 'https://a-1.example', order: 1 },
          { url: 'https://a-2.example', order: 2 },
          { url: 'https://a-3.example', order: 3 },
        ],
        savedAt: 1,
      },
    });

    adapter.tabs.clear();
    adapter.groups.clear();
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true, index: 0 }));
    await finishColdRecovery(continuity);

    const tabs = await adapter.queryTabs(1);
    const bTabs = tabs.filter((tab) => tab.url?.startsWith('https://b-'));
    const aTabs = tabs.filter((tab) => tab.url?.startsWith('https://a-'));
    const aGroup = Array.from(adapter.groups.values()).find((group) => group.title === 'A ·aaaaaaaa');
    expect(bTabs).toHaveLength(4);
    expect(bTabs.every((tab) => tab.groupId === -1 && tab.discarded && !tab.active)).toBe(true);
    expect(aTabs).toHaveLength(3);
    expect(aGroup).toMatchObject({ collapsed: true });
    expect(aTabs.every((tab) => tab.groupId === aGroup?.id && tab.discarded && !tab.active)).toBe(true);
    expect(tabs.find((tab) => tab.url === HOME_URL)).toMatchObject({ active: true });
  });

  it('resident session 含 pinned：只恢复可入组标签，pinned 留在 session 且不泄漏到顶层', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({
      tabIsolationSetting: 'hide',
      lastWorkspaceId: WS_B,
      [`tabSession.${WS_A}`]: {
        tabs: [
          { url: 'https://a-group.example', order: 0 },
          { url: 'https://a-pinned.example', pinned: true, order: 1 },
        ],
        savedAt: 1,
      },
      [`tabSession.${WS_B}`]: { tabs: [{ url: 'https://b.example', order: 0 }], savedAt: 1 },
      'sessionContinuity.topology': {
        currentWorkspaceId: WS_B,
        residents: [{ workspaceId: WS_A, title: 'A ·aaaaaaaa' }],
      },
    });
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));

    await finishColdRecovery(coordinator(adapter, [WS_A, WS_B]));

    const tabs = await adapter.queryTabs(1);
    const aGroup = Array.from(adapter.groups.values()).find((group) => group.title === 'A ·aaaaaaaa');
    expect(tabs.filter((tab) => tab.url === 'https://a-group.example')).toEqual([
      expect.objectContaining({ groupId: aGroup?.id, discarded: true }),
    ]);
    expect(tabs.some((tab) => tab.url === 'https://a-pinned.example')).toBe(false);
    expect(adapter.storage.get(`tabSession.${WS_A}`)).toMatchObject({
      tabs: expect.arrayContaining([expect.objectContaining({ url: 'https://a-pinned.example', pinned: true })]),
    });
  });

  it('resident 身份组多命中：fail closed，不新建或重组该 resident', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({
      tabIsolationSetting: 'hide',
      lastWorkspaceId: WS_B,
      [`tabSession.${WS_A}`]: { tabs: [{ url: 'https://a.example', order: 0 }], savedAt: 1 },
      [`tabSession.${WS_B}`]: { tabs: [{ url: 'https://b.example', order: 0 }], savedAt: 1 },
      'sessionContinuity.topology': {
        currentWorkspaceId: WS_B,
        residents: [{ workspaceId: WS_A, title: 'A ·aaaaaaaa' }],
      },
    });
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));
    adapter.tabs.set(2, businessTab({ id: 2, url: 'https://a.example', groupId: 10 }));
    adapter.tabs.set(3, businessTab({ id: 3, url: 'https://a.example', groupId: 11 }));
    adapter.groups.set(10, { id: 10, windowId: 1, title: 'A ·aaaaaaaa' });
    adapter.groups.set(11, { id: 11, windowId: 1, title: 'A copy ·aaaaaaaa' });

    await finishColdRecovery(coordinator(adapter, [WS_A, WS_B]));

    const tabs = await adapter.queryTabs(1);
    expect(tabs.filter((tab) => tab.url === 'https://a.example')).toEqual([
      expect.objectContaining({ id: 2, groupId: 10 }),
      expect.objectContaining({ id: 3, groupId: 11 }),
    ]);
    expect(Array.from(adapter.groups.values())).toHaveLength(2);
  });

  it('删除清理等待在途自动保存结束后移除 session 与 topology，旧写不能复活 URL', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({ tabIsolationSetting: 'hide', lastWorkspaceId: WS_A });
    adapter.tabs.set(1, businessTab({ url: 'https://deleted.example' }));
    const continuity = coordinator(adapter);
    const saveStorage = adapter.setStorage.bind(adapter);
    let releaseWrite: (() => void) | undefined;
    const writeReleased = new Promise<void>((resolve) => { releaseWrite = resolve; });
    let signalWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = resolve; });
    adapter.setStorage = async (values) => {
      if (`tabSession.${WS_A}` in values) {
        signalWriteStarted?.();
        await writeReleased;
      }
      await saveStorage(values);
    };

    continuity.notifyTopologyChanged();
    const flush = continuity.flushAutosave();
    await writeStarted;
    const cleanup = continuity.clearWorkspaceState(WS_A);
    releaseWrite?.();
    await Promise.all([flush, cleanup]);

    expect(adapter.storage.get(`tabSession.${WS_A}`)).toBeUndefined();
    expect(adapter.storage.get('sessionContinuity.topology')).toBeUndefined();
  });

  it('#64 legacy topology 的当前 Workspace 删除时，同时移除 topology 与 tab session', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({
      [`tabSession.${WS_A}`]: { tabs: [{ url: 'https://deleted.example', order: 0 }], savedAt: 1 },
      'sessionContinuity.topology': { currentWorkspaceId: WS_A },
    });

    await coordinator(adapter).clearWorkspaceState(WS_A);

    expect(adapter.storage.get(`tabSession.${WS_A}`)).toBeUndefined();
    expect(adapter.storage.get('sessionContinuity.topology')).toBeUndefined();
  });

  it('未知 malformed topology 不当作 legacy 删除', async () => {
    const adapter = new MemoryChromeAdapter();
    const malformedTopology = { currentWorkspaceId: WS_A, residents: 'unknown' };
    await adapter.setStorage({
      [`tabSession.${WS_A}`]: { tabs: [{ url: 'https://deleted.example', order: 0 }], savedAt: 1 },
      'sessionContinuity.topology': malformedTopology,
    });

    await coordinator(adapter).clearWorkspaceState(WS_A);

    expect(adapter.storage.get(`tabSession.${WS_A}`)).toBeUndefined();
    expect(adapter.storage.get('sessionContinuity.topology')).toEqual(malformedTopology);
  });

  it('保存 topology：resident 按标签位置有序，历史 session 未驻留不写入', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({ tabIsolationSetting: 'hide', lastWorkspaceId: WS_B });
    adapter.tabs.set(1, businessTab({ url: 'https://c.example', groupId: 20, index: 1 }));
    adapter.tabs.set(2, businessTab({ id: 2, url: 'https://a.example', groupId: 10, index: 5 }));
    adapter.tabs.set(3, businessTab({ id: 3, url: 'https://b.example', index: 6 }));
    adapter.groups.set(10, { id: 10, windowId: 1, title: 'A ·aaaaaaaa' });
    adapter.groups.set(20, { id: 20, windowId: 1, title: 'C ·cccccccc' });

    const continuity = coordinator(adapter, [WS_A, WS_B, WS_C]);
    continuity.notifyTopologyChanged();
    await continuity.flushAutosave();

    expect(adapter.storage.get('sessionContinuity.topology')).toEqual({
      currentWorkspaceId: WS_B,
      residents: [
        { workspaceId: WS_C, title: 'C ·cccccccc' },
        { workspaceId: WS_A, title: 'A ·aaaaaaaa' },
      ],
    });
  });

  it('close：即使 topology 记录 resident，也只恢复当前 Workspace', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({
      tabIsolationSetting: 'close',
      lastWorkspaceId: WS_B,
      [`tabSession.${WS_A}`]: { tabs: [{ url: 'https://a.example', order: 0 }], savedAt: 1 },
      [`tabSession.${WS_B}`]: { tabs: [{ url: 'https://b.example', order: 0 }], savedAt: 1 },
      'sessionContinuity.topology': {
        currentWorkspaceId: WS_B,
        residents: [{ workspaceId: WS_A, title: 'A ·aaaaaaaa' }],
      },
    });
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));

    await finishColdRecovery(coordinator(adapter, [WS_A, WS_B]));

    expect((await adapter.queryTabs(1)).map((tab) => tab.url)).toContain('https://b.example');
    expect((await adapter.queryTabs(1)).map((tab) => tab.url)).not.toContain('https://a.example');
    expect(adapter.groups.size).toBe(0);
  });

  it('当前 Workspace 原生身份组：恢复后解散；用户组与非 topology 身份组不接管', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({
      tabIsolationSetting: 'hide',
      lastWorkspaceId: WS_B,
      [`tabSession.${WS_B}`]: { tabs: [{ url: 'https://b.example', order: 0 }], savedAt: 1 },
      'sessionContinuity.topology': { currentWorkspaceId: WS_B, residents: [] },
    });
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));
    adapter.tabs.set(2, businessTab({ id: 2, url: 'https://b.example', groupId: 10 }));
    adapter.tabs.set(3, businessTab({ id: 3, url: 'https://user.example', groupId: 20 }));
    adapter.groups.set(10, { id: 10, windowId: 1, title: 'B ·bbbbbbbb' });
    adapter.groups.set(20, { id: 20, windowId: 1, title: '用户标签组' });

    await finishColdRecovery(coordinator(adapter, [WS_A, WS_B]));

    expect(adapter.tabs.get(2)).toMatchObject({ groupId: -1, active: false, discarded: true });
    expect(adapter.tabs.get(3)).toMatchObject({ groupId: 20 });
  });
});

describe('SessionContinuity — #65 原生会话协调', () => {
  it('原生拓扑变化后：等待新的静默窗口才补齐缺失标签', async () => {
    const adapter = adapterWithSession([
      { url: 'https://one.example', order: 0 },
      { url: 'https://two.example', order: 1 },
    ]);
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));
    const continuity = coordinator(adapter);
    vi.useFakeTimers();

    try {
      const recovery = continuity.startColdRecovery();
      await vi.advanceTimersByTimeAsync(99);
      expect(businessUrls(adapter)).toEqual([]);

      adapter.tabs.set(2, businessTab({ id: 2, url: 'https://one.example', index: 1 }));
      continuity.notifyTopologyChanged();
      await vi.advanceTimersByTimeAsync(99);
      expect(businessUrls(adapter)).toEqual(['https://one.example']);

      await vi.advanceTimersByTimeAsync(1);
      await recovery;
      expect(businessUrls(adapter)).toEqual(['https://one.example', 'https://two.example']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('原生拓扑持续变化超过上限：在 timeout 后才按最终拓扑协调', async () => {
    const adapter = adapterWithSession([{ url: 'https://missing.example', order: 0 }]);
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));
    const continuity = coordinator(adapter);
    vi.useFakeTimers();

    try {
      const recovery = continuity.startColdRecovery();
      for (let elapsed = 0; elapsed < 450; elapsed += 50) {
        await vi.advanceTimersByTimeAsync(50);
        continuity.notifyTopologyChanged();
        expect(businessUrls(adapter)).toEqual([]);
      }
      await vi.advanceTimersByTimeAsync(50);
      await recovery;
      expect(businessUrls(adapter)).toEqual(['https://missing.example']);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['未原生恢复', [], ['https://one.example', 'https://two.example']],
    ['部分原生恢复', ['https://one.example'], ['https://one.example', 'https://two.example']],
    ['完整原生恢复', ['https://one.example', 'https://two.example'], ['https://one.example', 'https://two.example']],
    ['原生恢复数量超过快照', ['https://one.example', 'https://one.example', 'https://two.example'], ['https://one.example', 'https://one.example', 'https://two.example']],
  ])('%s：只补齐快照缺失次数', async (_scenario, nativeUrls, expectedUrls) => {
    const adapter = adapterWithSession([
      { url: 'https://one.example', order: 0 },
      { url: 'https://two.example', order: 1 },
    ]);
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));
    nativeUrls.forEach((url, index) => adapter.tabs.set(index + 2, businessTab({ id: index + 2, url, index: index + 1 })));

    await finishColdRecovery(coordinator(adapter));

    expect(businessUrls(adapter)).toEqual(expectedUrls);
  });

  it('重复 URL、query/hash 与固定状态：按完整 URL 和 pinned 多重集补齐', async () => {
    const adapter = adapterWithSession([
      { url: 'https://app.example/item?view=one#top', order: 0 },
      { url: 'https://app.example/item?view=one#top', order: 1 },
      { url: 'https://app.example/item?view=two#top', order: 2 },
      { url: 'not a URL', order: 3 },
      { url: 'https://app.example/item?view=one#top', pinned: true, order: 4 },
    ]);
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));
    adapter.tabs.set(2, businessTab({ id: 2, url: 'https://app.example/item?view=one#top', index: 1 }));
    adapter.tabs.set(3, businessTab({ id: 3, url: 'https://app.example/item?view=two#other', index: 2 }));
    adapter.tabs.set(4, businessTab({ id: 4, url: 'not a URL', index: 3 }));
    adapter.tabs.set(5, businessTab({ id: 5, url: 'https://app.example/item?view=one#top', pinned: true, index: 4 }));

    await finishColdRecovery(coordinator(adapter));

    const tabs = await adapter.queryTabs(1);
    expect(tabs.filter((tab) => tab.url === 'https://app.example/item?view=one#top' && !tab.pinned)).toHaveLength(2);
    expect(tabs.filter((tab) => tab.url === 'https://app.example/item?view=two#top' && !tab.pinned)).toHaveLength(1);
    expect(tabs.filter((tab) => tab.url === 'https://app.example/item?view=one#top' && tab.pinned)).toHaveLength(1);
    expect(tabs.filter((tab) => tab.url === 'not a URL')).toHaveLength(1);
  });

  it('当前 Workspace 唯一 Octane 身份组已原生恢复：复用 occurrence，不新建重复标签', async () => {
    const adapter = adapterWithSession([{ url: 'https://owned.example', order: 0 }]);
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));
    adapter.tabs.set(2, businessTab({ id: 2, url: 'https://owned.example', index: 1, groupId: 10 }));
    adapter.groups.set(10, { id: 10, windowId: 1, title: `A ·${WS_A.slice(0, 8)}` });

    await finishColdRecovery(coordinator(adapter));

    const tabs = await adapter.queryTabs(1);
    expect(tabs.filter((tab) => tab.url === 'https://owned.example')).toEqual([
      expect.objectContaining({ id: 2, groupId: -1 }),
    ]);
  });

  it('当前 Workspace 身份组有多个命中：fail closed，不任选其中一个', async () => {
    const adapter = adapterWithSession([{ url: 'https://owned.example', order: 0 }]);
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));
    adapter.tabs.set(2, businessTab({ id: 2, url: 'https://owned.example', index: 1, groupId: 10 }));
    adapter.tabs.set(3, businessTab({ id: 3, url: 'https://owned.example', index: 2, groupId: 11 }));
    adapter.groups.set(10, { id: 10, windowId: 1, title: `A ·${WS_A.slice(0, 8)}` });
    adapter.groups.set(11, { id: 11, windowId: 1, title: `A copy ·${WS_A.slice(0, 8)}` });

    await finishColdRecovery(coordinator(adapter));

    const tabs = await adapter.queryTabs(1);
    expect(tabs.find((tab) => tab.id === 2)).toMatchObject({ groupId: 10 });
    expect(tabs.find((tab) => tab.id === 3)).toMatchObject({ groupId: 11 });
    expect(tabs.filter((tab) => tab.url === 'https://owned.example' && tab.groupId === -1)).toHaveLength(1);
  });

  it('快照外标签、用户组和其他 Workspace Octane 组：保留且不作为当前 Workspace 匹配项', async () => {
    const wsB = 'bbbbbbbb-0000-0000-0000-000000000000';
    const adapter = adapterWithSession([{ url: 'https://owned.example', order: 0 }]);
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));
    adapter.tabs.set(2, businessTab({ id: 2, url: 'https://external.example', index: 1 }));
    adapter.tabs.set(3, businessTab({ id: 3, url: 'https://owned.example', index: 2, groupId: 20 }));
    adapter.tabs.set(4, businessTab({ id: 4, url: 'https://owned.example', index: 3, groupId: 30 }));
    adapter.groups.set(20, { id: 20, windowId: 1, title: '用户分组' });
    adapter.groups.set(30, { id: 30, windowId: 1, title: `B ·${wsB.slice(0, 8)}` });

    await finishColdRecovery(coordinator(adapter));

    const tabs = await adapter.queryTabs(1);
    expect(tabs.find((tab) => tab.id === 2)).toMatchObject({ url: 'https://external.example', groupId: -1 });
    expect(tabs.find((tab) => tab.id === 3)).toMatchObject({ url: 'https://owned.example', groupId: 20 });
    expect(tabs.find((tab) => tab.id === 4)).toMatchObject({ url: 'https://owned.example', groupId: 30 });
    expect(tabs.filter((tab) => tab.url === 'https://owned.example' && tab.groupId === -1)).toHaveLength(1);
  });

  it('同一 coordinator 重复启动：不重复创建标签，Home 保持激活且新标签已释放', async () => {
    const adapter = adapterWithSession([{ url: 'https://only-once.example', order: 1 }]);
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: true }));
    const continuity = coordinator(adapter);

    await finishColdRecovery(continuity);
    await continuity.startColdRecovery();

    const tabs = await adapter.queryTabs(1);
    expect(tabs.filter((tab) => tab.url === 'https://only-once.example')).toEqual([
      expect.objectContaining({ active: false, discarded: true }),
    ]);
    expect(tabs.find((tab) => tab.url === HOME_URL)).toMatchObject({ active: true });
  });

  it('无快照时：原生标签页稳定后仍保持 Home 活动', async () => {
    const adapter = new MemoryChromeAdapter();
    await adapter.setStorage({ tabIsolationSetting: 'close', lastWorkspaceId: WS_A });
    adapter.tabs.set(1, businessTab({ url: HOME_URL, pinned: true, active: false }));
    adapter.tabs.set(2, businessTab({ id: 2, url: 'https://native.example', index: 1, active: true }));

    await finishColdRecovery(coordinator(adapter));

    expect((await adapter.queryTabs(1)).find((tab) => tab.url === HOME_URL)).toMatchObject({ active: true });
  });
});

async function finishColdRecovery(continuity: SessionContinuity): Promise<void> {
  vi.useFakeTimers();
  try {
    const recovery = continuity.startColdRecovery();
    await vi.advanceTimersByTimeAsync(1_000);
    await recovery;
  } finally {
    vi.useRealTimers();
  }
}

function adapterWithSession(tabs: Array<{ url: string; order: number; pinned?: boolean }>): MemoryChromeAdapter {
  const adapter = new MemoryChromeAdapter();
  adapter.storage.set('tabIsolationSetting', 'close');
  adapter.storage.set('lastWorkspaceId', WS_A);
  adapter.storage.set(`tabSession.${WS_A}`, { tabs, savedAt: 1 });
  return adapter;
}

function businessUrls(adapter: MemoryChromeAdapter): string[] {
  return Array.from(adapter.tabs.values())
    .filter((tab) => tab.url !== HOME_URL)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((tab) => tab.url!);
}
