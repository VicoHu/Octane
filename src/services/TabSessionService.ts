/**
 * 工作区标签会话服务：per-workspace 标签快照的 chrome.storage.local 分键 CRUD。
 *
 * 设计 rev4：存 storage.local（非 IndexedDB）分键 `tabSession.<workspaceId>`，每 workspace
 * 独立 key——多 home 实例并发归档不互相覆盖（区别于单 map 的 RMW 竞态）。仅存可恢复字段
 * {url, pinned, order}（见 TabEntry）。
 *
 * 安全访问 chrome.storage.local（参考 UnlockSession.getChromeStorage 范式）：非扩展环境
 * 返回 null/空操作，由调用方容错（home 首屏关键路径不抛）。
 */
import type { TabEntry, TabSession } from '@/shared/types';

const TAB_SESSION_KEY_PREFIX = 'tabSession.';

function key(workspaceId: string): string {
  return `${TAB_SESSION_KEY_PREFIX}${workspaceId}`;
}

interface ChromeStorageLocal {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (data: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

/** 安全读取 chrome.storage.local（非扩展环境返回 null）。 */
function getLocal(): ChromeStorageLocal | null {
  const g = globalThis as Record<string, unknown>;
  const chrome = g['chrome'];
  if (chrome && typeof chrome === 'object') {
    const storage = (chrome as Record<string, unknown>)['storage'];
    if (storage && typeof storage === 'object') {
      const local = (storage as Record<string, unknown>)['local'];
      if (local && typeof local === 'object') {
        return local as ChromeStorageLocal;
      }
    }
  }
  return null;
}

/** 读取某工作区的标签会话；不存在或非扩展环境返回 null。 */
export async function getTabSession(workspaceId: string): Promise<TabSession | null> {
  const local = getLocal();
  if (!local) return null;
  const k = key(workspaceId);
  const r = await local.get([k]);
  return (r[k] as TabSession | undefined) ?? null;
}

/** 归档某工作区的标签会话（分键覆盖写）。 */
export async function saveTabSession(workspaceId: string, tabs: TabEntry[]): Promise<void> {
  const local = getLocal();
  if (!local) return;
  const session: TabSession = { tabs, savedAt: Date.now() };
  await local.set({ [key(workspaceId)]: session });
}

/** 清除某工作区的标签会话（删 ws 时清隐私：不留已删 ws 的 tab URL）。 */
export async function clearTabSession(workspaceId: string): Promise<void> {
  const local = getLocal();
  if (!local) return;
  await local.remove([key(workspaceId)]);
}
