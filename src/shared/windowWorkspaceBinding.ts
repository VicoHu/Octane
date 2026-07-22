/**
 * 窗口↔工作区绑定：chrome.storage.local 分键 `windowWorkspaceBinding.<windowId>` → workspaceId。
 *
 * 设计 rev4 #7：分键（非单 map `{[windowId]:wsId}`），多 home 实例并发不互相覆盖（避 RMW 竞态）。
 * windows.onRemoved 清对应 key。语义=「当前窗口正在浏览的工作区」，区别于 lastWorkspaceId
 * （全局，「保存目标」，popup 写）——home 绑定后用 binding 而非 lastWorkspaceId。
 *
 * 安全访问 chrome.storage.local（参考 UnlockSession.getChromeStorage 范式）：非扩展环境返回
 * null/空操作，由调用方容错。
 */
const WINDOW_BINDING_PREFIX = 'windowWorkspaceBinding.';

function key(windowId: number): string {
  return `${WINDOW_BINDING_PREFIX}${windowId}`;
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

/** 读取窗口绑定的工作区；不存在或非扩展环境返回 null。 */
export async function getWorkspaceBinding(windowId: number): Promise<string | null> {
  const local = getLocal();
  if (!local) return null;
  const k = key(windowId);
  const r = await local.get([k]);
  return (r[k] as string | undefined) ?? null;
}

/** 绑定窗口到工作区（分键覆盖写）。 */
export async function setWorkspaceBinding(windowId: number, workspaceId: string): Promise<void> {
  const local = getLocal();
  if (!local) return;
  await local.set({ [key(windowId)]: workspaceId });
}

/** 清除窗口绑定（windows.onRemoved / 删最后 ws deleteBinding 时）。 */
export async function clearWorkspaceBinding(windowId: number): Promise<void> {
  const local = getLocal();
  if (!local) return;
  await local.remove([key(windowId)]);
}
