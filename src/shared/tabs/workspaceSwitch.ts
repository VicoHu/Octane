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
 * v1 范围：close-only。per-window busy 串行队列 / 进度事件 / undo 为后续（T2 余 + T4/T8）。
 *
 * chrome 引用在函数体内读取（参考 focusOrCreateHomeTab.ts），测试覆盖 chrome 后生效。
 */
import type { TabEntry } from '@/shared/types';
import { saveTabSession, getTabSession } from '@/services/TabSessionService';
import { getWorkspaceBinding, setWorkspaceBinding } from '@/shared/windowWorkspaceBinding';
import type { TabIsolationSetting } from '@/shared/tabIsolationSetting';
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

/** 切换结果：undo 回滚本次切换（dispose 本次 restore 集 → restore 原工作区 → 回滚 binding）。 */
export interface SwitchResult {
  undo: () => Promise<void>;
}

interface ChromeTab {
  id?: number;
  windowId: number;
  url?: string;
  pinned?: boolean;
  /** 浏览器 tab 位置（0 起），archive 时作为 order 落盘 */
  index?: number;
}

interface ChromeLike {
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
    url.startsWith('chrome-extension://')
  );
}

function toEntry(tab: ChromeTab): TabEntry {
  return { url: tab.url!, pinned: tab.pinned ?? false, order: tab.index ?? 0 };
}

/**
 * 归档窗口内当前工作区的标签：query → 过滤可恢复 → saveTabSession。
 * 返回可恢复 tab 的 id 集供 dispose；任何异常返回 null——硬屏障信号（调用方据此不 dispose）。
 */
async function archive(
  windowId: number,
  fromId: string,
  onProgress?: (p: SwitchProgress) => void,
): Promise<{ id: number }[] | null> {
  const c = getChrome();
  if (!c) return null;
  try {
    const tabs = await c.tabs.query({ windowId });
    const restorable = tabs.filter(isRestorable);
    await saveTabSession(fromId, restorable.map(toEntry));
    onProgress?.({ phase: 'archive', count: restorable.length, total: restorable.length });
    return restorable.map((t) => ({ id: t.id! }));
  } catch {
    return null; // 硬屏障：归档失败，不返回处置集
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
 * 切换窗口的工作区：归档当前 → 关闭 content tab → 恢复目标 → 更新绑定。
 * archive 失败时绝不 dispose（硬屏障），Toast 报错后中止——绝不无归档关闭 tab。
 * 返回 undo 回调（T4：dispose 本次 restore 集 → restore 原工作区 → 回滚 binding）。
 */
async function performSwitch(
  toId: string,
  windowId: number,
  options?: SwitchOptions,
): Promise<SwitchResult> {
  const onProgress = options?.onProgress;
  const c = getChrome();
  if (!c) return { undo: noopUndo };
  const fromId = await getWorkspaceBinding(windowId);
  if (!fromId || fromId === toId) return { undo: noopUndo };

  // 1. archive（失败 = 硬屏障，不动 tab）
  const toDispose = await archive(windowId, fromId, onProgress);
  if (toDispose === null) {
    Toast.error('切换中止：无法保存当前标签');
    return { undo: noopUndo };
  }

  // 2. dispose（保 home：toDispose 已排除 home tab）
  await disposeTabs(c, toDispose.map((t) => t.id), onProgress);

  // 3. restore 目标工作区标签（active:false 防闪烁）；记 openedIds 供 undo
  const targetSession = await getTabSession(toId);
  let openedIds: number[] = [];
  if (targetSession) {
    openedIds = await openTabsInWindow(c, windowId, targetSession.tabs, onProgress);
  }

  // 4. 更新窗口绑定
  await setWorkspaceBinding(windowId, toId);
  onProgress?.({ phase: 'done', count: 0, total: 0 });

  // undo：dispose 本次 restore 集 → restore 原工作区 → 回滚 binding（仅 token 存活期有效）
  return {
    undo: async () => {
      if (openedIds.length) await disposeTabs(c, openedIds);
      const prevSession = await getTabSession(fromId);
      if (prevSession) await openTabsInWindow(c, windowId, prevSession.tabs);
      await setWorkspaceBinding(windowId, fromId);
    },
  };
}

// per-window 串行队列（rev4 #2）：同窗并发切换按序执行，防 archive/dispose 交错覆盖 session/关错 tab。
// 不同窗口各自独立 inflight，互不阻塞。
const inflight = new Map<number, Promise<void>>();

/**
 * 切换窗口的工作区（单命令入口，AppRail/Sidebar 共用）。selectWorkspace 保持纯 UI。
 * 同窗并发请求串行化排队；archive 硬屏障保证绝不无归档关闭 tab。
 * options.onProgress 发各阶段进度（T8 消费）；返回 undo 回调（T4 消费）。
 */
export async function requestWorkspaceSwitch(
  toId: string,
  windowId: number,
  options?: SwitchOptions,
): Promise<SwitchResult> {
  const run = () => performSwitch(toId, windowId, options);
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
 * selectWorkspace 注入（store 方法），保持本模块不依赖 store。
 */
export async function switchWorkspaceBySetting(params: {
  toId: string;
  setting: TabIsolationSetting;
  windowId: number | null;
  selectWorkspace: (id: string) => Promise<void>;
}): Promise<void> {
  const { toId, setting, windowId, selectWorkspace } = params;
  if (setting === 'close' && windowId != null) {
    await requestWorkspaceSwitch(toId, windowId);
  }
  await selectWorkspace(toId);
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
