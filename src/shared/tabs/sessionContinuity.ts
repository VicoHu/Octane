import { listWorkspaces } from '@/services/WorkspaceService';
import type { TabIsolationSetting } from '@/shared/tabIsolationSetting';
import type { TabEntry, TabSession } from '@/shared/types';
import { IDENTITY_SUFFIX } from './tabGroupIdentity';

const TAB_SESSION_PREFIX = 'tabSession.';
const TOPOLOGY_KEY = 'sessionContinuity.topology';
const LAST_WORKSPACE_KEY = 'lastWorkspaceId';
const ISOLATION_KEY = 'tabIsolationSetting';
const ENABLED_SETTINGS: TabIsolationSetting[] = ['close', 'hide-discard', 'hide'];
const NATIVE_TOPOLOGY_QUIET_MS = 100;
const NATIVE_TOPOLOGY_TIMEOUT_MS = 500;

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
  collapsed?: boolean;
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
  groupTabs(tabIds: number[], windowId: number, groupId?: number): Promise<number>;
  ungroupTabs(tabIds: number[]): Promise<void>;
  updateGroup(groupId: number, details: { title?: string; collapsed?: boolean }): Promise<void>;
  getHomeUrl(): string;
}

interface SessionContinuityOptions {
  isWorkspaceValid: (workspaceId: string) => Promise<boolean>;
  listWorkspaceIds: () => Promise<string[]>;
  debounceMs?: number;
}

interface ResidentTopology {
  workspaceId: string;
  title: string;
}

interface CurrentTopology {
  currentWorkspaceId: string;
  residents: ResidentTopology[];
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

function reconciliationKey(url: string, pinned: boolean): string {
  try {
    return `${pinned ? '1' : '0'}:${new URL(url).href}`;
  } catch {
    return `${pinned ? '1' : '0'}:${url}`;
  }
}

function isUngrouped(tab: SessionContinuityTab): boolean {
  return tab.groupId == null || tab.groupId === -1;
}

function isTopology(value: unknown): value is CurrentTopology {
  if (!value || typeof value !== 'object') return false;
  const topology = value as Partial<CurrentTopology>;
  return typeof topology.currentWorkspaceId === 'string' && Array.isArray(topology.residents) &&
    topology.residents.every((resident) =>
      typeof resident?.workspaceId === 'string' && typeof resident.title === 'string',
    );
}

function isLegacyTopology(value: unknown): value is Pick<CurrentTopology, 'currentWorkspaceId'> {
  if (!value || typeof value !== 'object') return false;
  const topology = value as Record<string, unknown>;
  return Object.keys(topology).length === 1 && typeof topology.currentWorkspaceId === 'string';
}

/**
 * 单窗口工作区标签会话连续性。
 *
 * 这个模块负责当前 Workspace 的持续保存及冷恢复协调。原生标签页在短暂静默后按 URL、
 * pinned 和出现次数复用；驻留 Workspace 和失败重试分别由后续 ticket 承担。
 */
export class SessionContinuity {
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private generation = 0;
  private recovering = false;
  private startupStarted = false;
  private resetNativeQuietWindow: (() => void) | null = null;

  constructor(
    private readonly adapter: SessionContinuityAdapter,
    private readonly options: SessionContinuityOptions,
  ) {
    this.debounceMs = options.debounceMs ?? 150;
  }

  /** 由 background 的标签页/标签组事件调用，防抖保存最终拓扑。 */
  notifyTopologyChanged(): void {
    if (this.recovering) {
      this.resetNativeQuietWindow?.();
      return;
    }
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
      await this.waitForNativeTopology();
      const storedTopology = (await this.adapter.getStorage(TOPOLOGY_KEY))[TOPOLOGY_KEY];
      const topology = isTopology(storedTopology) ? storedTopology : null;
      await this.restoreCurrentWorkspace(windowId, workspaceId);

      if (stored[ISOLATION_KEY] !== 'close' && topology?.currentWorkspaceId === workspaceId) {
        for (const resident of topology.residents) {
          await this.restoreResidentWorkspace(windowId, resident);
        }
      }
      await this.adapter.updateTab(homeId, { active: true });
    } finally {
      this.recovering = false;
    }
  }

  private async waitForNativeTopology(): Promise<void> {
    await new Promise<void>((resolve) => {
      let quietTimer: ReturnType<typeof setTimeout> | null = null;
      const settle = () => {
        if (quietTimer) clearTimeout(quietTimer);
        clearTimeout(timeoutTimer);
        this.resetNativeQuietWindow = null;
        resolve();
      };
      const timeoutTimer = setTimeout(settle, NATIVE_TOPOLOGY_TIMEOUT_MS);
      this.resetNativeQuietWindow = () => {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(settle, NATIVE_TOPOLOGY_QUIET_MS);
      };
      this.resetNativeQuietWindow();
    });
  }

  private async restoreCurrentWorkspace(windowId: number, workspaceId: string): Promise<void> {
    const [existingTabs, groups, stored] = await Promise.all([
      this.adapter.queryTabs(windowId),
      this.adapter.queryGroups(windowId),
      this.adapter.getStorage(tabSessionKey(workspaceId)),
    ]);
    const currentGroupIds = groups
      .filter((group) => group.title?.endsWith(IDENTITY_SUFFIX(workspaceId)))
      .map((group) => group.id);
    // 标识冲突时不任选组，避免把用户或其他 Workspace 的 tab 计入当前快照。
    const currentGroupId = currentGroupIds.length === 1 ? currentGroupIds[0] : null;
    const session = stored[tabSessionKey(workspaceId)] as TabSession | undefined;
    if (session?.tabs?.length) {
      const available = new Map<string, SessionContinuityTab[]>();
      for (const tab of existingTabs) {
        if (!isRestorable(tab) || (!isUngrouped(tab) && tab.groupId !== currentGroupId)) continue;
        const key = reconciliationKey(tab.url!, tab.pinned ?? false);
        available.set(key, [...(available.get(key) ?? []), tab]);
      }
      const restoredTabIds: number[] = [];
      for (const entry of [...session.tabs].sort((a, b) => a.order - b.order)) {
        const key = reconciliationKey(entry.url, entry.pinned ?? false);
        const matched = available.get(key)?.shift();
        if (matched) {
          restoredTabIds.push(matched.id);
          continue;
        }
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
          // #67 负责持久失败状态与重试；当前 ticket 保留成功的同级标签恢复。
        }
      }
      for (const tabId of restoredTabIds) {
        try {
          await this.adapter.updateTab(tabId, { active: false });
          await this.adapter.discardTab(tabId);
        } catch {
          // #67 负责持久失败状态与重试；当前 ticket 保留成功的同级标签恢复。
        }
      }
    }
    if (currentGroupId != null) {
      const groupTabIds = (await this.adapter.queryTabs(windowId))
        .filter((tab) => tab.groupId === currentGroupId)
        .map((tab) => tab.id);
      if (groupTabIds.length) await this.adapter.ungroupTabs(groupTabIds);
    }
  }

  private async restoreResidentWorkspace(windowId: number, resident: ResidentTopology): Promise<void> {
    if (!(await this.options.isWorkspaceValid(resident.workspaceId))) return;
    const [groups, stored] = await Promise.all([
      this.adapter.queryGroups(windowId),
      this.adapter.getStorage(tabSessionKey(resident.workspaceId)),
    ]);
    const session = stored[tabSessionKey(resident.workspaceId)] as TabSession | undefined;
    const entries = session?.tabs.filter((entry) => !entry.pinned) ?? [];
    if (!entries.length) return;
    const matchingGroups = groups.filter((group) => group.title?.endsWith(IDENTITY_SUFFIX(resident.workspaceId)));
    // 多个稳定身份无法安全判定所有权，保留原样且不创建第三个组。
    if (matchingGroups.length > 1) return;
    let groupId = matchingGroups[0]?.id ?? null;
    const existingTabs = groupId == null
      ? []
      : (await this.adapter.queryTabs(windowId)).filter((tab) => tab.groupId === groupId && isRestorable(tab));
    const available = new Map<string, number>();
    for (const tab of existingTabs) {
      const key = reconciliationKey(tab.url!, tab.pinned ?? false);
      available.set(key, (available.get(key) ?? 0) + 1);
    }
    const createdTabs: Array<{ id: number; pinned: boolean }> = [];
    for (const entry of [...entries].sort((a, b) => a.order - b.order)) {
      const key = reconciliationKey(entry.url, entry.pinned ?? false);
      const matched = available.get(key) ?? 0;
      if (matched > 0) {
        available.set(key, matched - 1);
        continue;
      }
      try {
        const created = await this.adapter.createTab({
          url: entry.url,
          pinned: entry.pinned ?? false,
          windowId,
          index: entry.order,
          active: false,
        });
        createdTabs.push({ id: created.id, pinned: entry.pinned ?? false });
      } catch {
        // #67 负责持久失败状态与重试；当前 ticket 保留成功的同级标签恢复。
      }
    }
    const groupableIds = [...existingTabs, ...createdTabs]
      .filter((tab) => !tab.pinned)
      .map((tab) => tab.id);
    if (groupableIds.length) {
      groupId = await this.adapter.groupTabs(groupableIds, windowId, groupId ?? undefined);
      await this.adapter.updateGroup(groupId, { title: resident.title, collapsed: true });
    }
    const residentTabs = groupId == null
      ? []
      : (await this.adapter.queryTabs(windowId)).filter((tab) => tab.groupId === groupId).map((tab) => tab.id);
    for (const tabId of [...new Set([...residentTabs, ...createdTabs.map((tab) => tab.id)])]) {
      try {
        await this.adapter.updateTab(tabId, { active: false });
        await this.adapter.discardTab(tabId);
      } catch {
        // #67 负责持久失败状态与重试；当前 ticket 保留成功的同级标签恢复。
      }
    }
  }

  /** 删除 Workspace 时终止旧自动保存，并在队列尾部删除 session 与 topology 引用。 */
  async clearWorkspaceState(workspaceId: string): Promise<void> {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const cleanup = this.saveQueue.then(() => clearWorkspaceStorage(this.adapter, workspaceId));
    this.saveQueue = cleanup.catch(() => undefined);
    await cleanup;
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
    const workspaceIds = await this.options.listWorkspaceIds();
    const residents = workspaceIds
      .filter((id) => id !== workspaceId)
      .flatMap((id) => {
        const matches = groups.filter((group) => group.title?.endsWith(IDENTITY_SUFFIX(id)));
        if (matches.length !== 1 || !matches[0]!.title) return [];
        const groupId = matches[0]!.id;
        const order = Math.min(
          ...tabs.filter((tab) => tab.groupId === groupId).map((tab) => tab.index ?? Number.MAX_SAFE_INTEGER),
        );
        return [{ workspaceId: id, title: matches[0]!.title!, order }];
      })
      .sort((a, b) => a.order - b.order)
      .map(({ workspaceId: id, title }) => ({ workspaceId: id, title }));
    const topology: CurrentTopology = { currentWorkspaceId: workspaceId, residents };
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

type SessionStorageAdapter = Pick<SessionContinuityAdapter, 'getStorage' | 'setStorage' | 'removeStorage'>;

function createStorageAdapter(): SessionStorageAdapter | null {
  const chrome = (globalThis as Record<string, unknown>)['chrome'];
  if (!chrome || typeof chrome !== 'object') return null;
  const local = ((chrome as Record<string, unknown>)['storage'] as Record<string, unknown> | undefined)?.['local'];
  if (!local || typeof local !== 'object') return null;
  const storage = local as ChromeStorageLocal;
  return {
    getStorage: (keys) => storage.get(keys),
    setStorage: (values) => storage.set(values),
    removeStorage: (keys) => storage.remove(keys),
  };
}

async function clearWorkspaceStorage(
  adapter: SessionStorageAdapter,
  workspaceId: string,
): Promise<void> {
  const topology = (await adapter.getStorage(TOPOLOGY_KEY))[TOPOLOGY_KEY];
  await adapter.removeStorage(tabSessionKey(workspaceId));
  if (isLegacyTopology(topology)) {
    if (topology.currentWorkspaceId === workspaceId) await adapter.removeStorage(TOPOLOGY_KEY);
    return;
  }
  if (!isTopology(topology)) return;
  if (topology.currentWorkspaceId === workspaceId) {
    await adapter.removeStorage(TOPOLOGY_KEY);
    return;
  }
  const residents = topology.residents.filter((resident) => resident.workspaceId !== workspaceId);
  if (residents.length !== topology.residents.length) {
    await adapter.setStorage({ [TOPOLOGY_KEY]: { ...topology, residents } });
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
    group(details: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }): Promise<number>;
    ungroup(tabIds: number[]): Promise<void>;
  };
  tabGroups: {
    query(details: { windowId: number }): Promise<SessionContinuityGroup[]>;
    update(groupId: number, details: { title?: string; collapsed?: boolean }): Promise<void>;
  };
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
    groupTabs: (tabIds, windowId, groupId) => chrome.tabs.group(
      groupId == null ? { tabIds, createProperties: { windowId } } : { tabIds, groupId },
    ),
    ungroupTabs: (tabIds) => chrome.tabs.ungroup(tabIds),
    updateGroup: (groupId, details) => chrome.tabGroups.update(groupId, details),
    getHomeUrl: () => chrome.runtime.getURL('home.html'),
  };
}

async function productionWorkspaceIsValid(workspaceId: string): Promise<boolean> {
  return (await listWorkspaces()).some((workspace) => workspace.id === workspaceId);
}

async function productionWorkspaceIds(): Promise<string[]> {
  return (await listWorkspaces()).map((workspace) => workspace.id);
}

const productionAdapter = createProductionChromeAdapter();
export const sessionContinuity = productionAdapter
  ? new SessionContinuity(productionAdapter, {
    isWorkspaceValid: productionWorkspaceIsValid,
    listWorkspaceIds: productionWorkspaceIds,
  })
  : null;

/** 删除 Workspace 时通过生产 coordinator 串行清理 session 与冷恢复 topology。 */
export async function clearWorkspaceSessionContinuityState(workspaceId: string): Promise<void> {
  if (sessionContinuity) {
    await sessionContinuity.clearWorkspaceState(workspaceId);
    return;
  }
  const adapter = createProductionChromeAdapter() ?? createStorageAdapter();
  if (adapter) await clearWorkspaceStorage(adapter, workspaceId);
}
