import { vi } from 'vitest';
import { getDB } from '@/shared/db/database';

/** 清空所有 object store，保证测试隔离。 */
export async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const names = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) await tx.objectStore(n).clear();
  await tx.done;
}

/**
 * 覆盖 chrome 全局为可控 mock（覆盖 WxtVitest 的 fakeBrowser，使返回值确定）。
 */
export function mockChrome(activeTab: { url: string; title: string }): void {
  const storage: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: { query: vi.fn().mockResolvedValue([activeTab]) },
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in storage) out[k] = storage[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storage, items);
        }),
      },
    },
    runtime: { getURL: vi.fn().mockReturnValue('chrome-extension://x/newtab.html') },
  };
}
