import { vi } from 'vitest';

/**
 * chrome.storage.local 内存 mock（共享 test util）。
 *
 * 提取自 CloudStorageService.test.ts 的 installChromeStorageLocal，新增：
 * - initial：注入初始数据（测"上次选中恢复"）。
 * - getImpl / setImpl：覆盖默认实现，用于注入 reject（测 storage 异常容错）。
 *
 * 用法：
 *   const { store, local } = installChromeStorageLocal({ initial: { lastWorkspaceId: 'w2' } });
 *   // 业务代码调用 chrome.storage.local.get/set → 读写 store
 *   expect(store.lastWorkspaceId).toBe('w2');
 *
 *   // 测容错：get 抛错
 *   installChromeStorageLocal({ getImpl: async () => { throw new Error('quota') } });
 */
type LocalStore = Record<string, unknown>;

interface InstallOptions {
  initial?: LocalStore;
  getImpl?: (keys: string | string[] | null) => Promise<LocalStore>;
  setImpl?: (data: LocalStore) => Promise<void>;
}

export function installChromeStorageLocal(options: InstallOptions = {}) {
  const store: LocalStore = { ...(options.initial ?? {}) };

  const local = {
    get: vi.fn(
      options.getImpl ??
        (async (keys: string | string[] | null) => {
          // null = 全量（chrome.storage.local.get(null) 语义；listAllBindings 扫所有绑定用）
          if (keys === null) return { ...store };
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: LocalStore = {};
          for (const k of arr) if (k in store) out[k] = store[k];
          return out;
        }),
    ),
    set: vi.fn(
      options.setImpl ??
        (async (data: LocalStore) => {
          Object.assign(store, data);
        }),
    ),
    remove: vi.fn(async (keys: string | string[]) => {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) delete store[k];
    }),
  };

  (globalThis as Record<string, unknown>).chrome = {
    storage: { local },
  };

  return { store, local };
}
