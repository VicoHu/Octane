/**
 * Tag 筛选记忆范围配置：chrome.storage.local key `tagFilterMemoryScope`。
 *
 * 三档语义（Issue #54）：
 * - category（默认）= 仅当前分类：离开 Category 时清除该 Category 的 Tag 筛选。
 * - workspace = 当前工作区：同一 Workspace 内分别记忆各 Category 的筛选；离开 Workspace 时清除该 Workspace 全部记忆。
 * - session = 当前会话：页面生命周期内记忆所有 Workspace 下各 Category 的筛选；刷新或重新打开后清空。
 *
 * 仅持久化配置本身；实际筛选记忆只存内存，刷新天然清空。
 *
 * 安全访问 chrome.storage.local（参考 tabIsolationSetting 范式）：非法存储值和非扩展环境回退到 'category'。
 */
export type TagFilterMemoryScope = 'category' | 'workspace' | 'session';

export const DEFAULT_TAG_FILTER_MEMORY_SCOPE: TagFilterMemoryScope = 'category';

const KEY = 'tagFilterMemoryScope';
const VALID: TagFilterMemoryScope[] = ['category', 'workspace', 'session'];

interface ChromeStorageLocal {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (data: Record<string, unknown>) => Promise<void>;
}

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

/** 读记忆范围；不存在/非法/非扩展环境 → 'category'（默认仅当前分类）。 */
export async function getTagFilterMemoryScope(): Promise<TagFilterMemoryScope> {
  const local = getLocal();
  if (!local) return DEFAULT_TAG_FILTER_MEMORY_SCOPE;
  const r = await local.get([KEY]);
  const v = r[KEY];
  return VALID.includes(v as TagFilterMemoryScope)
    ? (v as TagFilterMemoryScope)
    : DEFAULT_TAG_FILTER_MEMORY_SCOPE;
}

/** 写记忆范围。 */
export async function setTagFilterMemoryScope(value: TagFilterMemoryScope): Promise<void> {
  const local = getLocal();
  if (!local) return;
  await local.set({ [KEY]: value });
}
