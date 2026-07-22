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
import { Toast } from '@/components/ui/toast';

declare const chrome: unknown;

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
): Promise<{ id: number }[] | null> {
  const c = getChrome();
  if (!c) return null;
  try {
    const tabs = await c.tabs.query({ windowId });
    const restorable = tabs.filter(isRestorable);
    await saveTabSession(fromId, restorable.map(toEntry));
    return restorable.map((t) => ({ id: t.id! }));
  } catch {
    return null; // 硬屏障：归档失败，不返回处置集
  }
}

/** 关闭窗口内 content tab（dispose）。ids 来自 archive 的可恢复集（已排除 home）。部分失败不阻断。 */
async function disposeTabs(c: ChromeLike, ids: number[]): Promise<void> {
  for (const id of ids) {
    try {
      await c.tabs.remove(id);
    } catch {
      // 部分失败：记录但不阻断（设计 #3：有处置集记录，编排层 Toast 提示）
    }
  }
}

/** 在窗口内重开 tab（restore / undo / 首启存量收纳复用）。active:false 防 restore 抢焦点闪烁。 */
async function openTabsInWindow(
  c: ChromeLike,
  windowId: number,
  tabs: TabEntry[],
): Promise<void> {
  for (const t of tabs) {
    await c.tabs.create({ url: t.url, pinned: t.pinned, windowId, index: t.order, active: false });
  }
}

/**
 * 切换窗口的工作区：归档当前 → 关闭 content tab → 恢复目标 → 更新绑定。
 * archive 失败时绝不 dispose（硬屏障），Toast 报错后中止——绝不无归档关闭 tab。
 */
export async function requestWorkspaceSwitch(toId: string, windowId: number): Promise<void> {
  const c = getChrome();
  if (!c) return;
  const fromId = await getWorkspaceBinding(windowId);
  if (!fromId || fromId === toId) return;

  // 1. archive（失败 = 硬屏障，不动 tab）
  const toDispose = await archive(windowId, fromId);
  if (toDispose === null) {
    Toast.error('切换中止：无法保存当前标签');
    return;
  }

  // 2. dispose（保 home：toDispose 已排除 home tab）
  await disposeTabs(c, toDispose.map((t) => t.id));

  // 3. restore 目标工作区标签（active:false 防闪烁）
  const targetSession = await getTabSession(toId);
  if (targetSession) {
    await openTabsInWindow(c, windowId, targetSession.tabs);
  }

  // 4. 更新窗口绑定
  await setWorkspaceBinding(windowId, toId);
}
