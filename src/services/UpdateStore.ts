import { compareVersions } from '@/shared/distribution';

// 项目无 @types/chrome：声明全局 chrome，最小子集断言（参考 ShortcutsSection.tsx）。
declare const chrome: unknown;

interface ChromeLike {
  runtime: { getManifest(): { version: string } };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(data: Record<string, unknown>): Promise<void>;
      remove(keys: string[]): Promise<void>;
    };
  };
}

const PENDING_KEY = 'pendingUpdate';
interface PendingUpdate {
  version: string;
}

function chromeLocal(): ChromeLike['storage']['local'] {
  return (chrome as unknown as ChromeLike).storage.local;
}

/** onUpdateAvailable 触发：持久化 Chrome 推送的待装版本，供 home 读取显示。 */
export async function savePendingUpdate(version: string): Promise<void> {
  await chromeLocal().set({ [PENDING_KEY]: { version } });
}

/** onInstalled(update) 触发：更新已装，清除提示。 */
export async function clearPendingUpdate(): Promise<void> {
  await chromeLocal().remove([PENDING_KEY]);
}

/**
 * 读取待装版本；semver 兜底：若 pending.version <= 本地版本（更新已装但未清），
 * 视为无效（返回 null）并清除残留。返回 null = 无提示。
 */
export async function readPendingUpdate(): Promise<string | null> {
  const local = chromeLocal();
  const localVersion = (chrome as unknown as ChromeLike).runtime.getManifest().version;
  const res = await local.get([PENDING_KEY]);
  const pending = res[PENDING_KEY] as PendingUpdate | undefined;
  if (!pending?.version) return null;
  if (compareVersions(pending.version, localVersion) > 0) {
    return pending.version;
  }
  // 残留（版本不超前）→ 清理
  await local.remove([PENDING_KEY]).catch(() => undefined);
  return null;
}