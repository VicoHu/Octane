import { listWorkspaces } from "@/services/WorkspaceService";
import type { TabIsolationSetting } from "@/shared/tabIsolationSetting";
import type { TabEntry, TabSession } from "@/shared/types";
import { IDENTITY_SUFFIX } from "./tabGroupIdentity";

const TAB_SESSION_PREFIX = "tabSession.";
const TOPOLOGY_KEY = "sessionContinuity.topology";
const PENDING_RECOVERY_KEY = "sessionContinuity.pendingRecovery";
const RECOVERY_NOTICE_KEY = "sessionContinuity.recoveryNotice";
const RECOVERY_TOKEN_KEY = "sessionContinuity.recoveryToken";
const LAST_WORKSPACE_KEY = "lastWorkspaceId";
const ISOLATION_KEY = "tabIsolationSetting";
const ENABLED_SETTINGS: TabIsolationSetting[] = ["close", "hide-discard", "hide"];
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
  removeTabs(tabIds: number[]): Promise<void>;
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

interface PendingWorkspaceRecovery {
  workspaceId: string;
  entries: TabEntry[];
  resident?: ResidentTopology;
}

interface PendingRecovery {
  workspaces: PendingWorkspaceRecovery[];
}

export interface RecoveryNotice {
  restoredCount: number;
  failedCount: number;
  shown: boolean;
}

function tabSessionKey(workspaceId: string): string {
  return `${TAB_SESSION_PREFIX}${workspaceId}`;
}

/** 诊断日志（counts only，不暴露 URL）。真机 service worker console 可见，用于定位冷启动恢复链路。 */
function logRecovery(message: string): void {
  console.log(`[octane-recovery] ${message}`);
}

function isEnabledSetting(value: unknown): value is Exclude<TabIsolationSetting, "off"> {
  return ENABLED_SETTINGS.includes(value as TabIsolationSetting);
}

function isRestorable(tab: SessionContinuityTab): boolean {
  if (!tab.url) return false;
  return !(
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("edge://") ||
    tab.url.startsWith("about:") ||
    tab.url.startsWith("chrome-extension://") ||
    tab.url.startsWith("devtools://") ||
    tab.url.startsWith("file://")
  );
}

/** Chrome / Edge 冷启动会留一个原生「新标签页」噪声 tab；Octane 恢复出业务 tab 后应清理它。
 *  newtab URL 在不同 Chrome 版本有 chrome://newtab、chrome://new-tab-page、edge://newtab 等形态。 */
function isNativeNewTab(tab: SessionContinuityTab): boolean {
  if (!tab.url || tab.pinned) return false;
  const url = tab.url.replace(/\/$/, "");
  return url === "chrome://newtab" || url === "chrome://new-tab-page" || url === "edge://newtab";
}

function toEntry(tab: SessionContinuityTab): TabEntry {
  return { url: tab.url!, pinned: tab.pinned ?? false, order: tab.index ?? 0 };
}

function reconciliationKey(url: string, pinned: boolean): string {
  try {
    return `${pinned ? "1" : "0"}:${new URL(url).href}`;
  } catch {
    return `${pinned ? "1" : "0"}:${url}`;
  }
}

function isUngrouped(tab: SessionContinuityTab): boolean {
  return tab.groupId == null || tab.groupId === -1;
}

function mergeEntries(live: TabEntry[], protectedEntries: TabEntry[]): TabEntry[] {
  const counts = new Map<string, number>();
  for (const entry of live) {
    const key = reconciliationKey(entry.url, entry.pinned ?? false);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const merged = [...live];
  for (const entry of protectedEntries) {
    const key = reconciliationKey(entry.url, entry.pinned ?? false);
    const count = counts.get(key) ?? 0;
    if (count > 0) {
      counts.set(key, count - 1);
    } else {
      merged.push(entry);
    }
  }
  return merged.sort((a, b) => a.order - b.order);
}

function isTopology(value: unknown): value is CurrentTopology {
  if (!value || typeof value !== "object") return false;
  const topology = value as Partial<CurrentTopology>;
  return (
    typeof topology.currentWorkspaceId === "string" &&
    Array.isArray(topology.residents) &&
    topology.residents.every(
      (resident) => typeof resident?.workspaceId === "string" && typeof resident.title === "string",
    )
  );
}

function isPendingRecovery(value: unknown): value is PendingRecovery {
  if (!value || typeof value !== "object") return false;
  const workspaces = (value as Partial<PendingRecovery>).workspaces;
  return (
    Array.isArray(workspaces) &&
    workspaces.every(
      (workspace) =>
        typeof workspace?.workspaceId === "string" &&
        Array.isArray(workspace.entries) &&
        workspace.entries.every(
          (entry) =>
            typeof entry?.url === "string" &&
            typeof entry.order === "number" &&
            (entry.pinned == null || typeof entry.pinned === "boolean"),
        ) &&
        (workspace.resident == null ||
          (typeof workspace.resident.workspaceId === "string" && typeof workspace.resident.title === "string")),
    )
  );
}

function isRecoveryNotice(value: unknown): value is RecoveryNotice {
  if (!value || typeof value !== "object") return false;
  const notice = value as Partial<RecoveryNotice>;
  return (
    typeof notice.restoredCount === "number" &&
    typeof notice.failedCount === "number" &&
    typeof notice.shown === "boolean"
  );
}

function isLegacyTopology(value: unknown): value is Pick<CurrentTopology, "currentWorkspaceId"> {
  if (!value || typeof value !== "object") return false;
  const topology = value as Record<string, unknown>;
  return Object.keys(topology).length === 1 && typeof topology.currentWorkspaceId === "string";
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
    if (this.startupStarted) {
      logRecovery("startColdRecovery skipped: already started this session");
      return;
    }
    this.startupStarted = true;

    const stored = await this.adapter.getStorage([ISOLATION_KEY, LAST_WORKSPACE_KEY]);
    if (!isEnabledSetting(stored[ISOLATION_KEY])) {
      logRecovery(`startColdRecovery abort: isolation disabled (setting=${String(stored[ISOLATION_KEY])})`);
      return;
    }
    const workspaceId = stored[LAST_WORKSPACE_KEY];
    if (typeof workspaceId !== "string" || !(await this.options.isWorkspaceValid(workspaceId))) {
      logRecovery(`startColdRecovery abort: lastWorkspaceId invalid (${String(workspaceId)})`);
      return;
    }

    const windows = await this.adapter.getNormalWindows();
    logRecovery(`startColdRecovery: normalWindows=${windows.length}, workspace=${workspaceId}`);
    if (windows.length !== 1 || windows[0]?.id == null) {
      logRecovery(`startColdRecovery abort: expected exactly 1 normal window, got ${windows.length}`);
      return;
    }
    const windowId = windows[0].id;

    this.recovering = true;
    try {
      const homeId = await this.ensureHomeTab(windowId);
      logRecovery(`startColdRecovery: homeTab ensured, id=${homeId}`);
      await this.adapter.setStorage({ [RECOVERY_TOKEN_KEY]: { startedAt: Date.now() } });
      await this.waitForNativeTopology();
      logRecovery("startColdRecovery: native topology settled");
      const priorPendingValue = (await this.adapter.getStorage(PENDING_RECOVERY_KEY))[PENDING_RECOVERY_KEY];
      const priorPending = isPendingRecovery(priorPendingValue) ? priorPendingValue.workspaces : [];
      const processedWorkspaceIds = await this.coldWorkspaceIds(workspaceId, stored[ISOLATION_KEY]);
      const desiredCount = await this.countColdEntries(workspaceId, stored[ISOLATION_KEY]);
      logRecovery(`startColdRecovery: desiredCount=${desiredCount}, priorPending=${priorPending.length}`);
      let failed = await this.restoreColdTopology(windowId, workspaceId, stored[ISOLATION_KEY]);
      if (failed.length) {
        logRecovery(
          `startColdRecovery: first pass failed=${failed.reduce((c, p) => c + p.entries.length, 0)}, retrying`,
        );
        await this.waitForNativeTopology();
        failed = await this.restoreColdTopology(windowId, workspaceId, stored[ISOLATION_KEY]);
      }
      const restoredCount = Math.max(
        0,
        desiredCount - failed.reduce((count, pending) => count + pending.entries.length, 0),
      );
      failed = [...failed, ...priorPending.filter((pending) => !processedWorkspaceIds.has(pending.workspaceId))];
      logRecovery(
        `startColdRecovery: done restored=${restoredCount}, failed=${failed.reduce((c, p) => c + p.entries.length, 0)}`,
      );
      await this.persistRecoveryResult(failed, restoredCount, failed.length > 0);
      // 恢复成功后才清理原生「新标签页」噪声：避免误关用户有意保留的空标签。
      if (restoredCount > 0) await this.removeNativeNewTabs(windowId);
      await this.adapter.updateTab(homeId, { active: true });
    } finally {
      this.recovering = false;
    }
  }

  /** 用户从 Home 触发的幂等重试：只补齐仍未满足的 pending occurrence。 */
  async retryPendingRecovery(): Promise<void> {
    const stored = await this.adapter.getStorage([ISOLATION_KEY, PENDING_RECOVERY_KEY]);
    if (!isEnabledSetting(stored[ISOLATION_KEY]) || !isPendingRecovery(stored[PENDING_RECOVERY_KEY])) return;
    const windows = await this.adapter.getNormalWindows();
    if (windows.length !== 1 || windows[0]?.id == null) return;
    const windowId = windows[0].id;
    this.recovering = true;
    try {
      const unresolved: PendingWorkspaceRecovery[] = [];
      for (const pending of stored[PENDING_RECOVERY_KEY].workspaces) {
        const failed = pending.resident
          ? await this.restoreResidentWorkspace(windowId, pending.resident, pending.entries)
          : await this.restoreCurrentWorkspace(windowId, pending.workspaceId, pending.entries);
        if (failed.length) unresolved.push({ ...pending, entries: failed });
      }
      await this.persistRecoveryResult(unresolved);
    } finally {
      this.recovering = false;
    }
  }

  private async coldWorkspaceIds(workspaceId: string, setting: unknown): Promise<Set<string>> {
    const topologyValue = (await this.adapter.getStorage(TOPOLOGY_KEY))[TOPOLOGY_KEY];
    const topology = isTopology(topologyValue) ? topologyValue : null;
    const ids =
      setting !== "close" && topology?.currentWorkspaceId === workspaceId
        ? [workspaceId, ...topology.residents.map((resident) => resident.workspaceId)]
        : [workspaceId];
    return new Set(ids);
  }

  private async countColdEntries(workspaceId: string, setting: unknown): Promise<number> {
    const ids = await this.coldWorkspaceIds(workspaceId, setting);
    let count = 0;
    for (const id of ids) {
      const session = (await this.adapter.getStorage(tabSessionKey(id)))[tabSessionKey(id)] as TabSession | undefined;
      count += session?.tabs.filter((entry) => id === workspaceId || !entry.pinned).length ?? 0;
    }
    return count;
  }

  private async restoreColdTopology(
    windowId: number,
    workspaceId: string,
    setting: unknown,
  ): Promise<PendingWorkspaceRecovery[]> {
    const storedTopology = (await this.adapter.getStorage(TOPOLOGY_KEY))[TOPOLOGY_KEY];
    const topology = isTopology(storedTopology) ? storedTopology : null;
    const failed: PendingWorkspaceRecovery[] = [];
    // 先恢复驻留组、后恢复当前 Workspace 散开 tab：最终顺序为
    // [pinned Home] [驻留折叠组] [当前散开 tab]，符合用户对工作区分级的预期。
    if (setting !== "close" && topology?.currentWorkspaceId === workspaceId) {
      for (const resident of topology.residents) {
        const residentFailed = await this.restoreResidentWorkspace(windowId, resident);
        if (residentFailed.length)
          failed.push({ workspaceId: resident.workspaceId, resident, entries: residentFailed });
      }
    }
    const currentFailed = await this.restoreCurrentWorkspace(windowId, workspaceId);
    if (currentFailed.length) failed.push({ workspaceId, entries: currentFailed });
    return failed;
  }

  private async persistRecoveryResult(
    failed: PendingWorkspaceRecovery[],
    restoredCount = 0,
    resetNoticeShown = false,
  ): Promise<void> {
    if (!failed.length) {
      await this.adapter.removeStorage([PENDING_RECOVERY_KEY, RECOVERY_NOTICE_KEY]);
      return;
    }
    const failedCount = failed.reduce((count, pending) => count + pending.entries.length, 0);
    const existingNotice = (await this.adapter.getStorage(RECOVERY_NOTICE_KEY))[RECOVERY_NOTICE_KEY];
    await this.adapter.setStorage({
      [PENDING_RECOVERY_KEY]: { workspaces: failed },
      [RECOVERY_NOTICE_KEY]: {
        restoredCount,
        failedCount,
        shown: resetNoticeShown ? false : isRecoveryNotice(existingNotice) ? existingNotice.shown : false,
      } satisfies RecoveryNotice,
    });
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

  private async restoreCurrentWorkspace(
    windowId: number,
    workspaceId: string,
    desiredEntries?: TabEntry[],
  ): Promise<TabEntry[]> {
    const [existingTabs, groups, stored] = await Promise.all([
      this.adapter.queryTabs(windowId),
      this.adapter.queryGroups(windowId),
      this.adapter.getStorage(tabSessionKey(workspaceId)),
    ]);
    const currentGroupIds = groups
      .filter((group) => group.title?.endsWith(IDENTITY_SUFFIX(workspaceId)))
      .map((group) => group.id);
    const currentGroupId = currentGroupIds.length === 1 ? currentGroupIds[0] : null;
    const session = stored[tabSessionKey(workspaceId)] as TabSession | undefined;
    const entries = desiredEntries ?? session?.tabs ?? [];
    const failed: TabEntry[] = [];
    const available = new Map<string, SessionContinuityTab[]>();
    for (const tab of existingTabs) {
      if (!isRestorable(tab) || (!isUngrouped(tab) && tab.groupId !== currentGroupId)) continue;
      const key = reconciliationKey(tab.url!, tab.pinned ?? false);
      available.set(key, [...(available.get(key) ?? []), tab]);
    }
    const matchedTabs: Array<{ tabId: number; entry: TabEntry }> = [];
    for (const entry of [...entries].sort((a, b) => a.order - b.order)) {
      const key = reconciliationKey(entry.url, entry.pinned ?? false);
      const matched = available.get(key)?.shift();
      if (matched) {
        matchedTabs.push({ tabId: matched.id, entry });
        continue;
      }
      try {
        const created = await this.adapter.createTab({
          url: entry.url,
          pinned: entry.pinned ?? false,
          windowId,
          // 追加到窗口末尾：避免用快照相对 order 插到已恢复的驻留组前面。
          index: Number.MAX_SAFE_INTEGER,
          active: false,
        });
        // 不主动 discard：冷恢复刚创建的 tab 尚未完成加载，chrome.tabs.discard 会
        // 静默损坏该 tab（真机表现为点开后永久转圈）。active:false 已让它停在后台、
        // 不抢焦点；用户点击时再正常加载，这是真机可靠的折衷。
        void created;
      } catch (e) {
        logRecovery(`restoreCurrent: create failed (err=${(e as Error).message})`);
        failed.push(entry);
      }
    }
    for (const matched of matchedTabs) {
      try {
        await this.adapter.updateTab(matched.tabId, { active: false });
      } catch (e) {
        logRecovery(`restoreCurrent: update failed on matched tab (err=${(e as Error).message})`);
        failed.push(matched.entry);
      }
    }
    if (currentGroupId != null) {
      try {
        const groupTabIds = (await this.adapter.queryTabs(windowId))
          .filter((tab) => tab.groupId === currentGroupId)
          .map((tab) => tab.id);
        if (groupTabIds.length) await this.adapter.ungroupTabs(groupTabIds);
      } catch {
        return entries;
      }
    }
    return failed;
  }

  private async restoreResidentWorkspace(
    windowId: number,
    resident: ResidentTopology,
    desiredEntries?: TabEntry[],
  ): Promise<TabEntry[]> {
    if (!(await this.options.isWorkspaceValid(resident.workspaceId))) return [];
    const [groups, stored] = await Promise.all([
      this.adapter.queryGroups(windowId),
      this.adapter.getStorage(tabSessionKey(resident.workspaceId)),
    ]);
    const session = stored[tabSessionKey(resident.workspaceId)] as TabSession | undefined;
    const entries = (desiredEntries ?? session?.tabs ?? []).filter((entry) => !entry.pinned);
    if (!entries.length) return [];
    const matchingGroups = groups.filter((group) => group.title?.endsWith(IDENTITY_SUFFIX(resident.workspaceId)));
    if (matchingGroups.length > 1) return entries;
    let groupId = matchingGroups[0]?.id ?? null;
    const existingTabs =
      groupId == null
        ? []
        : (await this.adapter.queryTabs(windowId)).filter((tab) => tab.groupId === groupId && isRestorable(tab));
    const available = new Map<string, SessionContinuityTab[]>();
    for (const tab of existingTabs) {
      const key = reconciliationKey(tab.url!, tab.pinned ?? false);
      available.set(key, [...(available.get(key) ?? []), tab]);
    }
    const failed: TabEntry[] = [];
    const managed: Array<{ id: number; entry: TabEntry }> = [];
    const createdTabIds: number[] = [];
    for (const entry of [...entries].sort((a, b) => a.order - b.order)) {
      const key = reconciliationKey(entry.url, entry.pinned ?? false);
      const matched = available.get(key)?.shift();
      if (matched) {
        managed.push({ id: matched.id, entry });
        continue;
      }
      try {
        const created = await this.adapter.createTab({
          url: entry.url,
          pinned: false,
          windowId,
          // 追加到窗口末尾：驻留组先于当前散开 tab 恢复，追加保证组在前、散开在后。
          index: Number.MAX_SAFE_INTEGER,
          active: false,
        });
        createdTabIds.push(created.id);
        managed.push({ id: created.id, entry });
      } catch (e) {
        logRecovery(`restoreResident: create failed (ws=${resident.workspaceId}, err=${(e as Error).message})`);
        failed.push(entry);
      }
    }
    try {
      const groupableIds = managed.map((tab) => tab.id);
      if (groupableIds.length) {
        groupId = await this.adapter.groupTabs(groupableIds, windowId, groupId ?? undefined);
        await this.adapter.updateGroup(groupId, { title: resident.title, collapsed: true });
      }
    } catch (e) {
      logRecovery(`restoreResident: group failed (ws=${resident.workspaceId}, err=${(e as Error).message})`);
      if (createdTabIds.length) {
        try {
          await this.adapter.removeTabs(createdTabIds);
        } catch {
          // 清理失败仍保留 pending，后续 Workspace 恢复不应被阻断。
        }
      }
      return [...entries];
    }
    for (const tab of managed) {
      try {
        await this.adapter.updateTab(tab.id, { active: false });
      } catch (e) {
        logRecovery(`restoreResident: update failed on managed tab (err=${(e as Error).message})`);
        failed.push(tab.entry);
      }
    }
    return failed;
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

  /** 显式成功归档建立新基线时，才允许清除该 Workspace 的旧 pending。 */
  async clearWorkspacePendingRecovery(workspaceId: string): Promise<void> {
    const cleanup = this.saveQueue.then(() => clearPendingWorkspace(this.adapter, workspaceId));
    this.saveQueue = cleanup.catch(() => undefined);
    await cleanup;
  }

  /** 隔离模式切换时同步清理本 ticket 拥有的拓扑元数据，不删除历史会话。 */
  async handleIsolationSettingChanged(): Promise<void> {
    const setting = (await this.adapter.getStorage(ISOLATION_KEY))[ISOLATION_KEY];
    if (!isEnabledSetting(setting)) {
      this.generation++;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      const cleanup = this.saveQueue.then(() =>
        this.adapter.removeStorage([TOPOLOGY_KEY, PENDING_RECOVERY_KEY, RECOVERY_NOTICE_KEY, RECOVERY_TOKEN_KEY]),
      );
      this.saveQueue = cleanup.catch(() => undefined);
      await cleanup;
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
    if (typeof workspaceId !== "string" || !(await this.options.isWorkspaceValid(workspaceId))) return;

    const windows = await this.adapter.getNormalWindows();
    if (windows.length !== 1 || windows[0]?.id == null) return;
    const windowId = windows[0].id;
    const [tabs, groups] = await Promise.all([this.adapter.queryTabs(windowId), this.adapter.queryGroups(windowId)]);
    if (generation !== this.generation || this.recovering) return;

    const currentGroupIds = groups
      .filter((group) => group.title?.endsWith(IDENTITY_SUFFIX(workspaceId)))
      .map((group) => group.id);
    // 标识重复时不任选组，防止用户或其他 Workspace 标签页进入当前快照。
    const currentGroupId = currentGroupIds.length === 1 ? currentGroupIds[0] : null;
    const liveEntries = tabs
      .filter(isRestorable)
      .filter((tab) => tab.groupId == null || tab.groupId === -1 || tab.groupId === currentGroupId)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(toEntry);
    const pendingValue = (await this.adapter.getStorage(PENDING_RECOVERY_KEY))[PENDING_RECOVERY_KEY];
    const protectedEntries = isPendingRecovery(pendingValue)
      ? pendingValue.workspaces.find((pending) => pending.workspaceId === workspaceId && !pending.resident)?.entries ??
        []
      : [];
    const entries = mergeEntries(liveEntries, protectedEntries);
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

  /** 恢复成功后清理窗口内的原生「新标签页」噪声 tab，避免它占据折叠组前的位置。部分失败不阻断。 */
  private async removeNativeNewTabs(windowId: number): Promise<void> {
    const tabs = await this.adapter.queryTabs(windowId);
    const newTabIds = tabs.filter(isNativeNewTab).map((tab) => tab.id);
    if (!newTabIds.length) return;
    try {
      await this.adapter.removeTabs(newTabIds);
    } catch {
      // 部分失败不阻断：newtab 清理是体验优化，非性能/数据正确性依赖。
    }
  }
}

type SessionStorageAdapter = Pick<SessionContinuityAdapter, "getStorage" | "setStorage" | "removeStorage">;

function createStorageAdapter(): SessionStorageAdapter | null {
  const chrome = (globalThis as Record<string, unknown>)["chrome"];
  if (!chrome || typeof chrome !== "object") return null;
  const local = ((chrome as Record<string, unknown>)["storage"] as Record<string, unknown> | undefined)?.["local"];
  if (!local || typeof local !== "object") return null;
  const storage = local as ChromeStorageLocal;
  return {
    getStorage: (keys) => storage.get(keys),
    setStorage: (values) => storage.set(values),
    removeStorage: (keys) => storage.remove(keys),
  };
}

async function clearPendingWorkspace(adapter: SessionStorageAdapter, workspaceId: string): Promise<void> {
  const stored = await adapter.getStorage([PENDING_RECOVERY_KEY, RECOVERY_NOTICE_KEY]);
  const pendingValue = stored[PENDING_RECOVERY_KEY];
  if (!isPendingRecovery(pendingValue)) return;
  const workspaces = pendingValue.workspaces.filter((pending) => pending.workspaceId !== workspaceId);
  if (!workspaces.length) {
    await adapter.removeStorage([PENDING_RECOVERY_KEY, RECOVERY_NOTICE_KEY]);
  } else if (workspaces.length !== pendingValue.workspaces.length) {
    const notice = stored[RECOVERY_NOTICE_KEY];
    const failedCount = workspaces.reduce((count, pending) => count + pending.entries.length, 0);
    await adapter.setStorage({
      [PENDING_RECOVERY_KEY]: { workspaces },
      ...(isRecoveryNotice(notice) ? { [RECOVERY_NOTICE_KEY]: { ...notice, failedCount } } : {}),
    });
  }
}

async function clearWorkspaceStorage(adapter: SessionStorageAdapter, workspaceId: string): Promise<void> {
  const topology = (await adapter.getStorage(TOPOLOGY_KEY))[TOPOLOGY_KEY];
  await adapter.removeStorage(tabSessionKey(workspaceId));
  await clearPendingWorkspace(adapter, workspaceId);
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
    getAll(details: { windowTypes: string[] }): Promise<
      Array<{
        id?: number;
        incognito?: boolean;
        type?: string;
      }>
    >;
  };
  tabs: {
    query(details: { windowId: number }): Promise<SessionContinuityTab[]>;
    create(details: {
      url: string;
      pinned: boolean;
      windowId: number;
      index: number;
      active: boolean;
    }): Promise<SessionContinuityTab>;
    update(tabId: number, details: { active: boolean }): Promise<void>;
    discard(tabId: number): Promise<void>;
    group(details: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }): Promise<number>;
    ungroup(tabIds: number[]): Promise<void>;
    remove(tabIds: number[]): Promise<void>;
  };
  tabGroups: {
    query(details: { windowId: number }): Promise<SessionContinuityGroup[]>;
    update(groupId: number, details: { title?: string; collapsed?: boolean }): Promise<void>;
  };
  runtime: { getURL(path: string): string };
}

function getChrome(): ChromeApi | null {
  const chrome = (globalThis as Record<string, unknown>)["chrome"];
  if (!chrome || typeof chrome !== "object") return null;
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
      const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
      return windows.flatMap((window) =>
        window.id != null && !window.incognito && window.type === "normal" ? [{ id: window.id, incognito: false }] : [],
      );
    },
    queryTabs: (windowId) => chrome.tabs.query({ windowId }),
    queryGroups: (windowId) => chrome.tabGroups.query({ windowId }),
    createTab: (details) => chrome.tabs.create(details),
    updateTab: (tabId, details) => chrome.tabs.update(tabId, details),
    discardTab: (tabId) => chrome.tabs.discard(tabId),
    groupTabs: (tabIds, windowId, groupId) =>
      chrome.tabs.group(groupId == null ? { tabIds, createProperties: { windowId } } : { tabIds, groupId }),
    ungroupTabs: (tabIds) => chrome.tabs.ungroup(tabIds),
    removeTabs: (tabIds) => chrome.tabs.remove(tabIds),
    updateGroup: (groupId, details) => chrome.tabGroups.update(groupId, details),
    getHomeUrl: () => chrome.runtime.getURL("home.html"),
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

/** Home 只消费计数 notice；读取后标记，避免 reload 重复弹出。 */
export async function takeRecoveryNotice(): Promise<RecoveryNotice | null> {
  const adapter = createProductionChromeAdapter() ?? createStorageAdapter();
  if (!adapter) return null;
  const notice = (await adapter.getStorage(RECOVERY_NOTICE_KEY))[RECOVERY_NOTICE_KEY];
  if (!isRecoveryNotice(notice) || notice.shown) return null;
  await adapter.setStorage({ [RECOVERY_NOTICE_KEY]: { ...notice, shown: true } });
  return notice;
}

/** Home 的重试动作只委托深模块，不在 UI 侧接触恢复 entry 或 URL。 */
export async function retryPendingRecovery(): Promise<void> {
  if (sessionContinuity) await sessionContinuity.retryPendingRecovery();
}

/** 显式 archive 成功建立新基线后清理该 Workspace 的 pending。 */
export async function clearWorkspacePendingRecovery(workspaceId: string): Promise<void> {
  if (sessionContinuity) {
    await sessionContinuity.clearWorkspacePendingRecovery(workspaceId);
    return;
  }
  const adapter = createProductionChromeAdapter() ?? createStorageAdapter();
  if (adapter) await clearPendingWorkspace(adapter, workspaceId);
}

/** 删除 Workspace 时通过生产 coordinator 串行清理 session 与冷恢复 topology。 */
export async function clearWorkspaceSessionContinuityState(workspaceId: string): Promise<void> {
  if (sessionContinuity) {
    await sessionContinuity.clearWorkspaceState(workspaceId);
    return;
  }
  const adapter = createProductionChromeAdapter() ?? createStorageAdapter();
  if (adapter) await clearWorkspaceStorage(adapter, workspaceId);
}
