import { listWorkspaces } from '@/services/WorkspaceService';
import type { TabIsolationSetting } from '@/shared/tabIsolationSetting';
import type { TabEntry, TabSession } from '@/shared/types';
import { IDENTITY_SUFFIX } from './tabGroupIdentity';

const TAB_SESSION_PREFIX = 'tabSession.';
const TOPOLOGY_KEY = 'sessionContinuity.topology';
const LAST_WORKSPACE_KEY = 'lastWorkspaceId';
const ISOLATION_KEY = 'tabIsolationSetting';
const ENABLED_SETTINGS: TabIsolationSetting[] = ['close', 'hide-discard', 'hide'];

export interface SessionContinuityTab {
  id: number;
  windowId: number;
  url?: string;
  index?: number;
  groupId?: number;
  pinned?: boolean;
  active?: boolean;
  discarded?: boolean;
}

interface SessionContinuityGroup {
  id: number;
  windowId: number;
  title?: string;
}

interface NormalWindow {
  id: number;
  incognito?: boolean;
}

export interface SessionContinuityAdapter {
  getStorage(keys: string | string[]): Promise<Record<string, unknown>>;
  setStorage(values: Record<string, unknown>): Promise<void>;
  removeStorage(keys: string | string[]): Promise<void>;
  getNormalWindows(): Promise<NormalWindow[]>;
  queryTabs(windowId: number): Promise<SessionContinuityTab[]>;
  queryGroups(windowId: number): Promise<SessionContinuityGroup[]>;
  createTab(details: {
    url: string;
    pinned: boolean;
    windowId: number;
    index: number;
    active: boolean;
  }): Promise<SessionContinuityTab>;
  updateTab(tabId: number, details: { active: boolean }): Promise<void>;
  discardTab(tabId: number): Promise<void>;
  getHomeUrl(): string;
}

interface SessionContinuityOptions {
  isWorkspaceValid: (workspaceId: string) => Promise<boolean>;
  debounceMs?: number;
}

interface CurrentTopology {
  currentWorkspaceId: string;
}

function tabSessionKey(workspaceId: string): string {
  return `${TAB_SESSION_PREFIX}${workspaceId}`;
}

function isEnabledSetting(value: unknown): value is Exclude<TabIsolationSetting, 'off'> {
  return ENABLED_SETTINGS.includes(value as TabIsolationSetting);
}

function isRestorable(tab: SessionContinuityTab): boolean {
  if (!tab.url) return false;
  return !(
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('about:') ||
    tab.url.startsWith('chrome-extension://') ||
    tab.url.startsWith('devtools://') ||
    tab.url.startsWith('file://')
  );
}

function toEntry(tab: SessionContinuityTab): TabEntry {
  return { url: tab.url!, pinned: tab.pinned ?? false, order: tab.index ?? 0 };
}

/**
 * 单窗口工作区标签会话连续性。
 *
 * 这个模块只负责 #64 的当前 Workspace tracer bullet：持续保存，以及没有原生业务标签
 * 时的冷恢复。原生会话协调、驻留 Workspace 和失败重试分别由后续 ticket 承担。
 */
export class SessionContinuity {
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private generation = 0;
  private recovering = false;
  private startupStarted = false;

  constructor(
    private readonly adapter: SessionContinuityAdapter,
    private readonly options: SessionContinuityOptions,
  ) {
    this.debounceMs = options.debounceMs ?? 150;
  }

  /** 由 background 的标签页/标签组事件调用，防抖保存最终拓扑。 */
  notifyTopologyChanged(): void {
    if (this.recovering) return;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.enqueueAutosave(this.generation).catch(() => {
        // 后续保存必须能继续；后台事件没有调用方可以接收本次失败。
      });
    }, this.debounceMs);
  }

  /** runtime.onStartup 的唯一恢复入口；重复调用在本次浏览器启动内幂等。 */
  async startColdRecovery(): Promise<void> {
    if (this.startupStarted) return;
    this.startupStarted = true;

    const stored = await this.adapter.getStorage([ISOLATION_KEY, LAST_WORKSPACE_KEY]);
    if (!isEnabledSetting(stored[ISOLATION_KEY])) return;
    const workspaceId = stored[LAST_WORKSPACE_KEY];
    if (typeof workspaceId !== 'string' || !(await this.options.isWorkspaceValid(workspaceId))) return;

    const windows = await this.adapter.getNormalWindows();
    if (windows.length !== 1 || windows[0]?.id == null) return;
    const windowId = windows[0].id;

    this.recovering = true;
    try {
      const homeId = await this.ensureHomeTab(windowId);
      const beforeRestore = await this.adapter.queryTabs(windowId);
      // #65 之前不接管 Chrome 原生恢复出的业务标签；存在任何可恢复业务页即安全跳过。
      if (beforeRestore.some(isRestorable)) return;

      const sessionValue = (await this.adapter.getStorage(tabSessionKey(workspaceId)))[tabSessionKey(workspaceId)];
      const session = sessionValue as TabSession | undefined;
      if (!session?.tabs?.length) return;

      for (const entry of [...session.tabs].sort((a, b) => a.order - b.order)) {
        try {
          const created = await this.adapter.createTab({
            url: entry.url,
            pinned: entry.pinned ?? false,
            windowId,
            index: entry.order,
            active: false,
          });
          await this.adapter.discardTab(created.id);
        } catch {
          // #67 负责持久失败状态与重试；当前 tracer bullet 保留成功的同级标签恢复。
        }
      }
      await this.adapter.updateTab(homeId, { active: true });
    } finally {
      this.recovering = false;
    }
  }

  /** 隔离模式切换时同步清理本 ticket 拥有的拓扑元数据，不删除历史会话。 */
  async handleIsolationSettingChanged(): Promise<void> {
    const setting = (await this.adapter.getStorage(ISOLATION_KEY))[ISOLATION_KEY];
    if (!isEnabledSetting(setting)) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      await this.adapter.removeStorage(TOPOLOGY_KEY);
      return;
    }
    this.notifyTopologyChanged();
  }

  /** 测试和 onSuspend 的最佳努力 flush；不依赖它保证正确性。 */
  async flushAutosave(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      await this.enqueueAutosave(this.generation);
      return;
    }
    await this.saveQueue;
  }

  /**
   * 查询和写入必须共用一个队列：generation 只在写前有效，若两次 setStorage 并发，
   * 先查询的旧写仍可能在新写之后完成。失败后重置队列，不能阻塞后续自动保存。
   */
  private enqueueAutosave(generation: number): Promise<void> {
    const task = this.saveQueue.then(
      () => this.saveCurrentWorkspace(generation),
      () => this.saveCurrentWorkspace(generation),
    );
    this.saveQueue = task.catch(() => undefined);
    return task;
  }

  private async saveCurrentWorkspace(generation: number): Promise<void> {
    if (this.recovering) return;
    const stored = await this.adapter.getStorage([ISOLATION_KEY, LAST_WORKSPACE_KEY]);
    if (!isEnabledSetting(stored[ISOLATION_KEY])) return;
    const workspaceId = stored[LAST_WORKSPACE_KEY];
    if (typeof workspaceId !== 'string' || !(await this.options.isWorkspaceValid(workspaceId))) return;

    const windows = await this.adapter.getNormalWindows();
    if (windows.length !== 1 || windows[0]?.id == null) return;
    const windowId = windows[0].id;
    const [tabs, groups] = await Promise.all([
      this.adapter.queryTabs(windowId),
      this.adapter.queryGroups(windowId),
    ]);
    if (generation !== this.generation || this.recovering) return;

    const currentGroupIds = groups
      .filter((group) => group.title?.endsWith(IDENTITY_SUFFIX(workspaceId)))
      .map((group) => group.id);
    // 标识重复时不任选组，防止用户或其他 Workspace 标签页进入当前快照。
    const currentGroupId = currentGroupIds.length === 1 ? currentGroupIds[0] : null;
    const entries = tabs
      .filter(isRestorable)
      .filter((tab) => tab.groupId == null || tab.groupId === -1 || tab.groupId === currentGroupId)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(toEntry);
    const topology: CurrentTopology = { currentWorkspaceId: workspaceId };
    const session: TabSession = { tabs: entries, savedAt: Date.now() };

    if (generation !== this.generation || this.recovering) return;
    await this.adapter.setStorage({
      [tabSessionKey(workspaceId)]: session,
      [TOPOLOGY_KEY]: topology,
    });
  }

  private async ensureHomeTab(windowId: number): Promise<number> {
    const homeUrl = this.adapter.getHomeUrl();
    const tabs = await this.adapter.queryTabs(windowId);
    const home = tabs.find((tab) => tab.url === homeUrl && tab.pinned && tab.id != null);
    if (home) {
      await this.adapter.updateTab(home.id, { active: true });
      return home.id;
    }
    const created = await this.adapter.createTab({
      url: homeUrl,
      pinned: true,
      windowId,
      index: 0,
      active: true,
    });
    return created.id;
  }
}

interface ChromeStorageLocal {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

interface ChromeApi {
  storage: { local: ChromeStorageLocal };
  windows: {
    getAll(details: { windowTypes: string[] }): Promise<Array<{
      id?: number;
      incognito?: boolean;
      type?: string;
    }>>;
  };
  tabs: {
    query(details: { windowId: number }): Promise<SessionContinuityTab[]>;
    create(details: { url: string; pinned: boolean; windowId: number; index: number; active: boolean }): Promise<SessionContinuityTab>;
    update(tabId: number, details: { active: boolean }): Promise<void>;
    discard(tabId: number): Promise<void>;
  };
  tabGroups: { query(details: { windowId: number }): Promise<SessionContinuityGroup[]> };
  runtime: { getURL(path: string): string };
}

function getChrome(): ChromeApi | null {
  const chrome = (globalThis as Record<string, unknown>)['chrome'];
  if (!chrome || typeof chrome !== 'object') return null;
  const value = chrome as ChromeApi;
  return value.storage?.local && value.windows && value.tabs && value.tabGroups && value.runtime ? value : null;
}

/** 生产 Chrome Adapter：仅映射本模块所需的本机扩展 API。 */
export function createProductionChromeAdapter(): SessionContinuityAdapter | null {
  const chrome = getChrome();
  if (!chrome) return null;
  return {
    getStorage: (keys) => chrome.storage.local.get(keys),
    setStorage: (values) => chrome.storage.local.set(values),
    removeStorage: (keys) => chrome.storage.local.remove(keys),
    getNormalWindows: async () => {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      return windows.flatMap((window) =>
        window.id != null && !window.incognito && window.type === 'normal'
          ? [{ id: window.id, incognito: false }]
          : [],
      );
    },
    queryTabs: (windowId) => chrome.tabs.query({ windowId }),
    queryGroups: (windowId) => chrome.tabGroups.query({ windowId }),
    createTab: (details) => chrome.tabs.create(details),
    updateTab: (tabId, details) => chrome.tabs.update(tabId, details),
    discardTab: (tabId) => chrome.tabs.discard(tabId),
    getHomeUrl: () => chrome.runtime.getURL('home.html'),
  };
}

async function productionWorkspaceIsValid(workspaceId: string): Promise<boolean> {
  return (await listWorkspaces()).some((workspace) => workspace.id === workspaceId);
}

const productionAdapter = createProductionChromeAdapter();
export const sessionContinuity = productionAdapter
  ? new SessionContinuity(productionAdapter, { isWorkspaceValid: productionWorkspaceIsValid })
  : null;
