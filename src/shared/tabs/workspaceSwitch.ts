/**
 * 工作区切换编排：离开工作区时归档其标签 → 关闭 → 恢复目标工作区标签 → 更新窗口绑定。
 *
 * 设计 rev4：单命令 requestWorkspaceSwitch(toId, windowId)，AppRail / Sidebar 共用。
 * selectWorkspace 保持纯 UI，不编排 tab——切换走本命令。
 *
 * 顺序硬约束：archive（失败必中止，硬屏障）→ dispose → restore → 绑定。无原子性，
 * 靠 archive 的硬屏障 + per-tab 处置集 + undo Toast 兜底。
 *
 * 【安全锚】（设计 Assignment）：archive 失败时 chrome.tabs.remove 绝不被调用——
 * 绝不无归档关闭 tab，防丢数据。此 invariant 有专门回归测试守护。
 *
 * v1.1：performSwitch 加 mode（close/hide/hide-discard）+ 失败状态机（archive/dispose/restore
 * 三失败路径，M2 restore try/catch）。undo = buildUndo（generation 校验 + 按 mode 反转）包
 * queuedUndo（走 per-window 串行队列，防 undo 与下一次切换交错）。
 *
 * chrome 引用在函数体内读取（参考 focusOrCreateHomeTab.ts），测试覆盖 chrome 后生效。
 */
import type { TabEntry } from '@/shared/types';
import { saveTabSession, getTabSession } from '@/services/TabSessionService';
import { getWorkspaceBinding, setWorkspaceBinding } from '@/shared/windowWorkspaceBinding';
import type { TabIsolationSetting } from '@/shared/tabIsolationSetting';
import { findGroupByIdentity, makeGroupTitle, wsHash } from '@/shared/tabs/tabGroupIdentity';
import { Toast } from '@/components/ui/toast';

declare const chrome: unknown;

/** 切换编排的阶段（T8 进度反馈消费）。 */
export type SwitchPhase = 'archive' | 'dispose' | 'restore' | 'done';

/** 切换进度事件：phase + 已处理 count + 该阶段总数 total。 */
export interface SwitchProgress {
  phase: SwitchPhase;
  count: number;
  total: number;
}

/** 切换选项：onProgress 进度回调（T8 两层进度反馈消费）。 */
export interface SwitchOptions {
  onProgress?: (progress: SwitchProgress) => void;
}

/** 切换快照（T6）：undo 前校验目标组结构未变（generation），按 mode 反转。
 *  targetGroupId = restoreByMode 命中/新建的目标组 id（close=None）。 */
interface UndoSnapshot {
  fromId: string;
  toId: string;
  mode: TabIsolationMode;
  /** restore 命中/新建的目标组 id（close=None）；undo 前校验 findGroupByIdentity(toId) 未变。 */
  targetGroupId: number | null;
  /** 本次 restore 重开的 tab id 集（close 档 undo 时 dispose）。 */
  openedIds: number[];
}

/** 切换结果：undo 回滚本次切换（generation 校验 → 按 mode 反转 → 回滚 binding）。
 *  fromId/closedCount 供 T4 切换结果 Toast（「已切换到 X / 已关闭 N / 切回 Y」）。 */
export interface SwitchResult {
  undo: () => Promise<void>;
  /** 切换前的工作区 id（T4「切回 Y」）；未实际切换（off/同 ws/archive 失败）为 null。 */
  fromId: string | null;
  /** 本次关闭的 content tab 数（T4「已关闭 N」）；N=0 不弹 Toast。 */
  closedCount: number;
}

interface ChromeTab {
  id?: number;
  windowId: number;
  url?: string;
  pinned?: boolean;
  /** 浏览器 tab 位置（0 起），archive 时作为 order 落盘 */
  index?: number;
  /** 所属 tabGroup id（-1 / 缺省 = 无组，hide 模式按此过滤当前 ws 组）。 */
  groupId?: number;
}

interface ChromeLike {
  /** runtime.getURL（补丁：dispose hide 激活 home tab 时派生 home url）。可选防御。 */
  runtime?: { getURL(path: string): string };
  tabs: {
    query(info: { windowId?: number }): Promise<ChromeTab[]>;
    create(props: {
      url: string;
      pinned?: boolean;
      windowId?: number;
      index?: number;
      active?: boolean;
    }): Promise<unknown>;
    remove(id: number): Promise<unknown>;
    /** hide 模式：恢复时切换激活态 / discard 后唤起（后续 task 用）。 */
    update(id: number, props: { active?: boolean }): Promise<unknown>;
    /** hide-discard 模式：丢弃 tab 内存（不关闭，保留占位）。 */
    discard(id: number): Promise<unknown>;
    /** hide 模式：把散 tab 并入当前 ws 组（restore 重组用）。 */
    group(opts: {
      tabIds: number[];
      groupId?: number;
      createProperties?: { windowId: number };
    }): Promise<number>;
    /** hide 模式：解散组（切换回 close 或清理用）。 */
    ungroup(tabIds: number[]): Promise<unknown>;
  };
  tabGroups: {
    get(gid: number): Promise<{ id: number; windowId: number; title?: string }>;
    query(info: { windowId?: number }): Promise<{ id: number; windowId: number; title?: string }[]>;
    update(
      gid: number,
      props: { collapsed?: boolean; title?: string; color?: string },
    ): Promise<unknown>;
  };
}

function getChrome(): ChromeLike | null {
  const c = chrome as unknown as ChromeLike | undefined;
  if (!c?.tabs?.query) return null;
  return c;
}

/**
 * tab 是否可恢复（archive/restore 用）。
 * 排除浏览器内部页 + 扩展页（含 pinned home tab——home 是 app shell，全程排除）。
 * 注：devtools: / 受限 file: 的过滤扩展为 T6 范围，此处先排除内部页。
 */
function isRestorable(tab: ChromeTab): boolean {
  if (tab.id == null || !tab.url) return false;
  const url = tab.url;
  return !(
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://') ||
    // T6：devtools:（开发者工具页）/ file:（受限，tabs.create 需 file:///* 权限，未授权 restore 失败）
    // 不可恢复——不进 archive/dispose/计数集（切换时保留，避免关了恢复不了丢 tab）
    url.startsWith('devtools://') ||
    url.startsWith('file://')
  );
}

function toEntry(tab: ChromeTab): TabEntry {
  return { url: tab.url!, pinned: tab.pinned ?? false, order: tab.index ?? 0 };
}

/**
 * 隔离模式（内部，与 TabIsolationSetting 三档对应：close 全窗关 / hide-discard 保留壳丢内存 / hide 保留可见）。
 * archiveByMode 只区分 close（全窗 restorable）与 hide（按 groupId 过滤当前 ws 组 + 散 tab）；
 * hide-discard 与 hide 在 archive 阶段同路径（差异在 dispose/restore，后续 task）。
 */
export type TabIsolationMode = 'close' | 'hide-discard' | 'hide';

/**
 * 按 mode 归档窗口内当前 ws 的 tab（archiveByMode）。
 * - close：全窗 restorable tab（v1 行为）。
 * - hide / hide-discard：当前 ws 标识组（findGroupByIdentity 回找）的 tab + 散 tab
 *   （groupId=-1/null，含 pinned，视为当前 ws），**不取别 ws 组**（防污染）。
 *   找不到当前 ws 组时只收散 tab（兜底前保全，不任选别组防关错）。
 * 任何异常返回 null（硬屏障信号，调用方不 dispose）。返回 {tabs: {id, entry}[]} 供 dispose/restore。
 */
export async function archiveByMode(
  c: ChromeLike,
  windowId: number,
  fromId: string,
  mode: TabIsolationMode,
  onProgress?: (p: SwitchProgress) => void,
): Promise<{ tabs: { id: number; entry: TabEntry }[] } | null> {
  try {
    const tabs = await c.tabs.query({ windowId });
    const restorable = tabs.filter(isRestorable);
    let mine: ChromeTab[];
    if (mode === 'close') {
      mine = restorable;
    } else {
      // hide / hide-discard：只收当前 ws 组 + 散 tab（groupId -1/null），不取别 ws 组
      const gid = await findGroupByIdentity(windowId, fromId);
      mine = restorable.filter((t) => t.groupId === gid || t.groupId === -1 || t.groupId == null);
    }
    const entries = mine.map((t) => ({ id: t.id!, entry: toEntry(t) }));
    await saveTabSession(fromId, entries.map((e) => e.entry));
    onProgress?.({ phase: 'archive', count: entries.length, total: entries.length });
    return { tabs: entries };
  } catch {
    return null; // 硬屏障
  }
}

/** 关闭窗口内 content tab（dispose）。ids 来自 archive 的可恢复集（已排除 home）。部分失败不阻断。 */
async function disposeTabs(
  c: ChromeLike,
  ids: number[],
  onProgress?: (p: SwitchProgress) => void,
): Promise<void> {
  let i = 0;
  for (const id of ids) {
    try {
      await c.tabs.remove(id);
    } catch {
      // 部分失败：记录但不阻断（设计 #3：有处置集记录，编排层 Toast 提示）
    }
    onProgress?.({ phase: 'dispose', count: i + 1, total: ids.length });
    i++;
  }
}

/** 在窗口内重开 tab（restore / undo / 首启存量收纳复用）。active:false 防 restore 抢焦点闪烁。
 *  返回新建 tab 的 id 集供 undo dispose。 */
async function openTabsInWindow(
  c: ChromeLike,
  windowId: number,
  tabs: TabEntry[],
  onProgress?: (p: SwitchProgress) => void,
): Promise<number[]> {
  const ids: number[] = [];
  let i = 0;
  for (const t of tabs) {
    const created = (await c.tabs.create({
      url: t.url,
      pinned: t.pinned,
      windowId,
      index: t.order,
      active: false,
    })) as { id?: number } | undefined;
    if (created?.id != null) ids.push(created.id);
    onProgress?.({ phase: 'restore', count: i + 1, total: tabs.length });
    i++;
  }
  return ids;
}

const noopUndo = async () => {};

/**
 * 查窗口内 home tab（runtime.getURL 派生 url）并激活。查不到 / update 失败静默
 *（home 可能未开，补丁不阻断主流程）。
 *
 * 补丁目的：dispose hide/hide-discard 开头先把 active 切到 home，避免
 * ① active tab 在待折叠组里致 discard 抛错；② 切换过程抢用户焦点。
 */
async function activateHomeIfPresent(c: ChromeLike, windowId: number): Promise<void> {
  try {
    const homeUrl = c.runtime?.getURL('home.html');
    if (!homeUrl) return;
    const tabs = await c.tabs.query({ windowId });
    const home = tabs.find((t) => t.id != null && t.url === homeUrl);
    if (home?.id != null) await c.tabs.update(home.id, { active: true });
  } catch {
    /* home 未开 / update 失败：静默，不阻断 dispose */
  }
}

/**
 * 按 mode 处置（dispose）。返回 `{ ok }`：false=关键失败（collapse/group 抛错），
 * 调用方据此不更新 binding。
 *
 * - close：remove（v1 disposeTabs，部分失败不阻断）。
 * - hide / hide-discard：补丁激活 home → pinned（除 home，archive 已排除）remove
 *   → 散 tab（groupId=-1/null 的 restorable 非 pinned）tabs.group 纳入当前 ws 组
 *   （无组则建组 + update title=makeGroupTitle('', fromId)）→ collapse 组
 *   → hide-discard 档逐 tab discard（单 tab 失败 try/catch 跳过，部分失败不阻断 ok）。
 *
 * archive 已排除 home / isInternalPage；toDispose 的 id 是 restorable tab。
 */
export async function disposeByMode(
  c: ChromeLike,
  windowId: number,
  fromId: string,
  mode: TabIsolationMode,
  toDispose: { id: number; entry: TabEntry }[],
  onProgress?: (p: SwitchProgress) => void,
): Promise<{ ok: boolean }> {
  if (mode === 'close') {
    await disposeTabs(c, toDispose.map((t) => t.id), onProgress);
    return { ok: true };
  }
  // hide / hide-discard
  try {
    // 补丁：先激活 home tab（避 active tab 在待折叠组致 discard 失败 + 避抢焦点）
    await activateHomeIfPresent(c, windowId);

    // pinned tab 无法入组（Chrome 限制 C4b）→ remove（archive 已排除 home，toDispose 不含 home）
    const pinnedIds = toDispose.filter((t) => t.entry.pinned).map((t) => t.id);
    for (const id of pinnedIds) {
      try { await c.tabs.remove(id); } catch { /* 部分失败不阻断 */ }
    }

    // 散 tab（groupId=-1/null 的 restorable 非 pinned；isRestorable 自动排除 home 等内部页）
    // → 纳入当前 ws 组
    const existingGid = await findGroupByIdentity(windowId, fromId);
    const allTabs = await c.tabs.query({ windowId });
    const looseTabIds = allTabs
      .filter(
        (t) =>
          t.id != null &&
          (t.groupId === -1 || t.groupId == null) &&
          isRestorable(t) &&
          !t.pinned,
      )
      .map((t) => t.id!);

    let gid = existingGid;
    if (gid == null && looseTabIds.length) {
      // 无当前 ws 组但有散 tab → 建组 + update 标识
      gid = await c.tabs.group({ tabIds: looseTabIds, createProperties: { windowId } });
      await c.tabGroups.update(gid, { title: makeGroupTitle('', fromId), color: 'grey' });
    } else if (gid != null && looseTabIds.length) {
      await c.tabs.group({ tabIds: looseTabIds, groupId: gid });
    }

    if (gid != null) {
      // collapse 组（关键失败 → 外层 catch → ok=false）
      await c.tabGroups.update(gid, { collapsed: true });
      if (mode === 'hide-discard') {
        // 逐 tab discard：active/受限 tab 抛错 try/catch 跳过，部分失败不阻断 ok
        const groupTabs = (await c.tabs.query({ windowId })).filter(
          (t) => t.groupId === gid && t.id != null,
        );
        for (const t of groupTabs) {
          try { await c.tabs.discard(t.id!); } catch { /* active/受限 tab 跳过 */ }
        }
      }
    }
    onProgress?.({ phase: 'dispose', count: toDispose.length, total: toDispose.length });
    return { ok: true };
  } catch {
    return { ok: false }; // collapse/group 关键失败 → 调用方不更新 binding
  }
}

/**
 * 按 mode 恢复目标 ws。返回 `{ opened, failed, groupId }`。
 *
 * - close：openTabsInWindow（v1）。
 * - hide / hide-discard：标识回找命中 → expand（collapsed:false）；未命中 → 兜底 restore
 *   （TabSession 重开 + tabs.group 建组 + tabGroups.update(title=makeGroupTitle,
 *   collapsed:false)）。
 *
 * 补丁：返回值含 groupId（供 T6 undo generation 校验组结构）。
 * binding 只在调用方确认 opened/failed 可接受后写（见 performSwitch）。
 */
export async function restoreByMode(
  c: ChromeLike,
  windowId: number,
  toId: string,
  toName: string,
  mode: TabIsolationMode,
  onProgress?: (p: SwitchProgress) => void,
): Promise<{ opened: number[]; failed: TabEntry[]; groupId: number | null }> {
  if (mode === 'close') {
    const session = await getTabSession(toId);
    const opened = session ? await openTabsInWindow(c, windowId, session.tabs, onProgress) : [];
    return { opened, failed: [], groupId: null };
  }
  // hide / hide-discard
  const gid = await findGroupByIdentity(windowId, toId);
  if (gid != null) {
    await c.tabGroups.update(gid, { collapsed: false }); // expand
    onProgress?.({ phase: 'restore', count: 0, total: 0 });
    return { opened: [], failed: [], groupId: gid };
  }
  // 兜底 restore：重开 + 建组
  const session = await getTabSession(toId);
  if (!session || !session.tabs.length) {
    return { opened: [], failed: [], groupId: null };
  }
  const opened: number[] = [];
  const failed: TabEntry[] = [];
  for (const t of session.tabs) {
    try {
      const created = (await c.tabs.create({
        url: t.url,
        pinned: t.pinned,
        windowId,
        index: t.order,
        active: false,
      })) as { id?: number } | undefined;
      if (created?.id != null) opened.push(created.id);
      else failed.push(t);
    } catch {
      failed.push(t);
    }
  }
  // C4b：Chrome tabs.group 拒绝 pinned tab。opened[i] 与 session.tabs[i] 按序对应，
  // 过滤掉 pinned（留 pinned 不入组，与 dispose 路径一致）；opened 返回值仍含全部重开 id。
  const groupable = opened.filter((_, i) => !session.tabs[i]?.pinned);
  let newGid: number | null = null;
  if (groupable.length) {
    newGid = await c.tabs.group({ tabIds: groupable, createProperties: { windowId } });
    await c.tabGroups.update(newGid, {
      title: makeGroupTitle(toName, toId),
      color: 'grey',
      collapsed: false,
    });
  }
  onProgress?.({ phase: 'restore', count: opened.length, total: session.tabs.length });
  return { opened, failed, groupId: newGid };
}

/**
 * 切换窗口的工作区：归档当前 → 关闭 content tab → 恢复目标 → 更新绑定。
 * v1.1：按 mode 委托 archiveByMode/disposeByMode/restoreByMode，引入失败状态机。
 *
 * 失败状态机（核心）：
 * - archive null（硬屏障）→ 不 dispose + 不更新 binding + fromId:null。
 * - dispose ok=false（hide 折叠/建组关键失败）→ 不 restore + 不更新 binding + fromId:null。
 * - restore 抛错（M2 try/catch 兜底 group/update 抛错）→ 不更新 binding + fromId:null
 *   （源已 dispose 的中间态由 undo/手动切回兜底）。
 * - restore failed 非空（部分 tab 重开失败）→ 仍更新 binding（部分成功）+ Toast「未完成 N 个」。
 *
 * archive 失败时绝不 dispose（硬屏障），Toast 报错后中止——绝不无归档关闭 tab。
 * undo = buildUndo 包 queuedUndo（T6）：generation 校验目标组结构 → 按 mode 反转 → 回滚 binding，
 * 走 per-window 串行队列防与下一次切换交错。
 */
export async function performSwitch(
  toId: string,
  toName: string,
  windowId: number,
  mode: TabIsolationMode,
  options?: SwitchOptions,
): Promise<SwitchResult> {
  const onProgress = options?.onProgress;
  const c = getChrome();
  if (!c) return { undo: noopUndo, fromId: null, closedCount: 0 };
  const fromId = await getWorkspaceBinding(windowId);
  if (!fromId || fromId === toId) return { undo: noopUndo, fromId: null, closedCount: 0 };

  // 1. archive（硬屏障：失败绝不再向下走，绝不无归档关闭 tab）
  const archived = await archiveByMode(c, windowId, fromId, mode, onProgress);
  if (archived === null) {
    Toast.error('切换中止：无法保存当前标签');
    return { undo: noopUndo, fromId: null, closedCount: 0 };
  }

  // 2. dispose（hide：collapse/建组关键失败 ok=false → 不更新 binding）
  const disposed = await disposeByMode(c, windowId, fromId, mode, archived.tabs, onProgress);
  if (!disposed.ok) {
    Toast.error('切换中止：无法收起当前标签，已保留');
    return { undo: noopUndo, fromId: null, closedCount: 0 };
  }

  // 3. restore 目标 ws（M2：try/catch 兜底 restoreByMode 内 group/update 抛错；
  //    restoreByMode close 路径的 openTabsInWindow 抛错也在此兜住）
  let restored: { opened: number[]; failed: TabEntry[]; groupId: number | null } = {
    opened: [],
    failed: [],
    groupId: null,
  };
  try {
    restored = await restoreByMode(c, windowId, toId, toName, mode, onProgress);
  } catch {
    // restore 抛错（非 failed 非空）→ 不更新 binding；源已 dispose 的中间态由 undo/手动切回兜底
    Toast.error('切换未完成：恢复目标标签时出错');
    return { undo: noopUndo, fromId: null, closedCount: 0 };
  }

  // 4. 更新绑定（dispose.ok 后；restore failed 非空仍更新 = 部分成功）
  await setWorkspaceBinding(windowId, toId);
  onProgress?.({ phase: 'done', count: 0, total: 0 });

  if (restored.failed.length) {
    Toast.error(`切换未完成：还有 ${restored.failed.length} 个标签未恢复`);
  }

  // T6: buildUndo（generation 校验 + 按 mode 反转）包 queuedUndo（走 per-window 串行队列）
  const snapshot: UndoSnapshot = {
    fromId,
    toId,
    mode,
    targetGroupId: restored.groupId,
    openedIds: restored.opened,
  };
  const undo = queueUndo(windowId, buildUndo(c, windowId, snapshot, onProgress));
  return { undo, fromId, closedCount: archived.tabs.length };
}

// per-window 串行队列（rev4 #2）：同窗并发切换按序执行，防 archive/dispose 交错覆盖 session/关错 tab。
// 不同窗口各自独立 inflight，互不阻塞。undo（queuedUndo）也走本队列，防 undo 与下一次切换交错。
const inflight = new Map<number, Promise<void>>();

/**
 * 把 undo 包进 per-window 串行队列（T6）。undo 不绕过 inflight，防 undo 与下一次切换
 * 交错（archive/dispose/undo 互相覆盖 session 或关错 tab）。模式与 requestWorkspaceSwitch 同构。
 */
function queueUndo(windowId: number, undoFn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const prev = inflight.get(windowId) ?? Promise.resolve();
    const task = prev.then(undoFn, undoFn); // Promise<void>
    const voidTask = task.then(noopUndo, noopUndo);
    inflight.set(windowId, voidTask);
    try {
      await task;
    } finally {
      if (inflight.get(windowId) === voidTask) inflight.delete(windowId);
    }
  };
}

/**
 * 构造 undo 函数（T6）：generation 校验 + 按 mode 反转。
 *
 * generation 校验：undo 前查 findGroupByIdentity(toId) === snapshot.targetGroupId？
 * 不等（组被删/标题改/重建为新 gid）→ 拒绝 undo（Toast「工作区已变化，可手动切回」）+ 不回滚。
 *
 * 反转（按 mode）：
 * - close：dispose 本次 opened（restore 集）+ restoreByMode(fromId, close) + 回滚 binding。
 * - hide / hide-discard：collapse 目标组 + restoreByMode(fromId, hide)（命中 expand 源组 /
 *   未命中兜底重开）+ 回滚 binding。
 */
function buildUndo(
  c: ChromeLike,
  windowId: number,
  snapshot: UndoSnapshot,
  onProgress?: (p: SwitchProgress) => void,
): () => Promise<void> {
  return async () => {
    // generation 校验：目标组结构未变（groupId 仍存、标识回找一致）。
    // M1（T7 顺手补）：close 档无 group 概念（targetGroupId=null），跳过校验——
    // 即使目标 ws 存在残留 hide 标识组（findGroupByIdentity 命中非 null）也不误拒，
    // 直接反转（dispose opened + restore 源 + 回滚 binding）。
    const gid = await findGroupByIdentity(windowId, snapshot.toId);
    if (snapshot.mode !== 'close' && gid !== snapshot.targetGroupId) {
      Toast.error('工作区已变化，无法撤销，可手动切回');
      return;
    }
    // 反转：collapse 目标组（hide / hide-discard；close 路径 gid=null 跳过）
    if (gid != null) {
      try {
        await c.tabGroups.update(gid, { collapsed: true });
      } catch {
        /* 组已不存在等：忽略，继续回滚 binding */
      }
    }
    // close：dispose 本次 restore 重开的 tab（opened 集）
    if (snapshot.mode === 'close' && snapshot.openedIds.length) {
      await disposeTabs(c, snapshot.openedIds);
    }
    // 源工作区：restoreByMode（hide 命中→expand 源组 / 未命中→兜底重开；close→重开 session）
    await restoreByMode(c, windowId, snapshot.fromId, '', snapshot.mode, onProgress);
    // 回滚 binding 到源工作区
    await setWorkspaceBinding(windowId, snapshot.fromId);
  };
}

/**
 * 切换窗口的工作区（单命令入口，AppRail/Sidebar 共用）。selectWorkspace 保持纯 UI。
 * 同窗并发请求串行化排队；archive 硬屏障保证绝不无归档关闭 tab。
 * toName 由上层（能访问 store）传入，供 restoreByMode 建 group title。
 * options.onProgress 发各阶段进度（T8 消费）；返回 undo 回调（T4 消费；T6 buildUndo 包 queuedUndo）。
 */
export async function requestWorkspaceSwitch(
  toId: string,
  toName: string,
  windowId: number,
  mode: TabIsolationMode,
  options?: SwitchOptions,
): Promise<SwitchResult> {
  const run = () => performSwitch(toId, toName, windowId, mode, options);
  const prev = inflight.get(windowId) ?? Promise.resolve();
  const task = prev.then(run, run); // Promise<SwitchResult>
  const voidTask = task.then(noopUndo, noopUndo);
  inflight.set(windowId, voidTask);
  try {
    return await task;
  } finally {
    if (inflight.get(windowId) === voidTask) inflight.delete(windowId);
  }
}

/**
 * 门控分流（T3）：按隔离设置决定切换走 tab 编排（close）还是纯 UI（off）。
 *
 * - close + windowId：先 requestWorkspaceSwitch（archive/dispose/restore + 更新 binding），
 *   再 selectWorkspace。requestWorkspaceSwitch 只改 binding/session 不动 store 选中态，
 *   不调 selectWorkspace 则 UI 高亮与分类停留在旧工作区。
 * - off 或 windowId=null（非扩展环境）：仅 selectWorkspace（当前行为，不碰 tab）。
 *
 * toName 由上层（switchWorkspace）传入，供 restoreByMode 建 group title。
 * mode 暂硬编码 'close'（v1 行为不变）；hide/hide-discard 映射在 T8 由 setting→mode 转换接入。
 * selectWorkspace 注入（store 方法），保持本模块不依赖 store。
 */
export async function switchWorkspaceBySetting(params: {
  toId: string;
  toName: string;
  setting: TabIsolationSetting;
  windowId: number | null;
  selectWorkspace: (id: string) => Promise<void>;
  onProgress?: (p: SwitchProgress) => void;
}): Promise<SwitchResult> {
  const { toId, toName, setting, windowId, selectWorkspace, onProgress } = params;
  if (setting === 'close' && windowId != null) {
    const result = await requestWorkspaceSwitch(
      toId,
      toName,
      windowId,
      'close',
      onProgress ? { onProgress } : undefined,
    );
    await selectWorkspace(toId);
    return result;
  }
  await selectWorkspace(toId);
  return { undo: noopUndo, fromId: null, closedCount: 0 };
}

/**
 * 计数窗口内可归档（可恢复）的 content tab 数（T5 首启告知用：off→close 时告知用户
 * 当前窗口 N 个标签将归入当前工作区，下次切换时自动收纳）。复用 isRestorable 过滤
 *（排除内部页 + home tab）。非扩展环境 / query 异常 → 0。
 */
export async function countRestorableTabsInWindow(windowId: number): Promise<number> {
  const c = getChrome();
  if (!c) return 0;
  try {
    const tabs = await c.tabs.query({ windowId });
    return tabs.filter(isRestorable).length;
  } catch {
    return 0;
  }
}

/**
 * 跨档 normalize（T7）：hide→close 时清窗口内非当前 ws 标识组（tab 已在各自 session），
 * 窗口回归 close「只剩当前 ws tab」干净语义，避免 close 全窗 archive 污染。
 * 其他切档（close→hide / off↔任意）no-op。
 *
 * 只清 Octane 管的标识组（title 含 ` ·xxxxxxxx` wsHash 后缀）且非当前绑定 ws；
 * 用户手动组（无标识格式）不碰。非扩展环境 / 异常静默（不阻断 setting 写入）。
 */
export async function normalizeOnModeChange(
  windowId: number,
  newMode: TabIsolationSetting,
): Promise<void> {
  if (newMode !== 'close') return; // 仅切入 close 触发 normalize
  const c = getChrome();
  if (!c) return;
  try {
    const currentWs = await getWorkspaceBinding(windowId);
    const groups = await c.tabGroups.query({ windowId });
    for (const g of groups) {
      // Octane 标识组：title 以 ` ·xxxxxxxx`（wsHash 8 hex）结尾
      const m = g.title?.match(/ ·([0-9a-f]{8})$/);
      if (!m) continue; // 用户手动组，不碰
      const hash = m[1]!;
      // 当前 ws 组保留（wsHash 一致）
      if (currentWs && wsHash(currentWs) === hash) continue;
      // 非当前 ws 标识组：remove 其所有 tab（内容已在各自 session）
      const groupTabs = (await c.tabs.query({ windowId })).filter(
        (t) => t.groupId === g.id && t.id != null,
      );
      for (const t of groupTabs) {
        try { await c.tabs.remove(t.id!); } catch { /* 部分失败：不阻断 */ }
      }
    }
  } catch {
    /* 异常静默：不阻断 setting 写入 */
  }
}
