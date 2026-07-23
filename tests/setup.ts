import '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// lottie-web 由 vitest.config.ts 的 resolve.alias 全局指向 tests/stubs/lottie-web.ts，
// 解决 Semi barrel 静态依赖 lottie-web 在 jsdom 模块评估期崩溃的问题。详见规范 §4.4。

// jsdom 缺 ResizeObserver / IntersectionObserver，Semi 的 TextArea(autosize)/Collapse 等
// 组件在 layout effect 里调用它们。补全为空操作的 polyfill，让真实渲染在 jsdom 下不崩。
// 这是对 jsdom 环境缺失的补全，不是 mock 任何被测组件或 Semi 行为。
class ResizeObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverPolyfill;
}
if (!('IntersectionObserver' in globalThis)) {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    IntersectionObserverPolyfill;
}

// jsdom 无 chrome 扩展 API；Sidebar / usePendingUpdate 等组件读取 chrome.runtime.getManifest
// 与 chrome.storage.onChanged。补全最小 polyfill，让不专门 mock chrome 的组件测试能渲染。
// 专门测 chrome 副作用的测试用 installChromeStorageLocal（@/test/storageMock）覆盖。
// WXT fake-browser 注入 chrome，但 runtime.getManifest 是未实现 stub（抛 not implemented），
// storage.onChanged 也未实现。Sidebar（版本号）/ usePendingUpdate 依赖它们。
// 在每个 test 前覆盖为可用实现（vitest 全局 beforeEach FIFO：fake-browser reset 先，
// 本 setup 的 beforeEach 后，故覆盖 reset）。测试自建 chrome mock 覆盖时自行补全。
beforeEach(() => {
  const c = (globalThis as Record<string, unknown>).chrome as
    | { runtime?: Record<string, unknown>; storage?: Record<string, unknown> }
    | undefined;
  if (c?.runtime) c.runtime.getManifest = () => ({ version: '0.0.0' });
  if (c?.storage) {
    c.storage.onChanged = { addListener: () => {}, removeListener: () => {} };
    // usePendingUpdate → readPendingUpdate 读 storage.local.get；fake-browser 未实现，提供空实现。
    // 测 storage 副作用的测试用 installChromeStorageLocal 覆盖。
    c.storage.local = {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    };
  }

  // T0: hide 模式依赖 chrome.tabGroups + tabs.group/ungroup/discard/update。
  // WXT fake-browser 未实现这些（memory wxt-fake-browser-test-stub），注入最小内存实现。
  // FIFO：fake-browser reset 先，本 beforeEach 后，故覆盖 reset。
  // 测试自建 chrome mock 覆盖时自行补全（参考 installChromeStorageLocal 范式）。
  if (c) {
    const chromeAny = c as Record<string, any>;
    // tabGroups 内存态：groupId → {id, windowId, title, color, collapsed}
    const groups = new Map<number, any>();
    let nextGroupId = 1;
    chromeAny.tabGroups = {
      get: async (gid: number) => {
        const g = groups.get(gid);
        if (!g) throw new Error(`Group ${gid} not found`);
        return { ...g };
      },
      query: async (info: { windowId?: number } = {}) =>
        Array.from(groups.values()).filter(
          (g) => info.windowId == null || g.windowId === info.windowId,
        ),
      update: async (gid: number, props: Partial<{ collapsed: boolean; title: string; color: string }>) => {
        const g = groups.get(gid);
        if (!g) throw new Error(`Group ${gid} not found`);
        Object.assign(g, props);
        return { ...g };
      },
    };
    // tabs 内存态：tabId → {id, windowId, url, groupId, active, pinned, ...}
    const tabsStore = new Map<number, any>();
    let nextTabId = 1;
    // chrome.tabs 可能已由 fake-browser 提供部分；补齐 group/ungroup/discard/update/query/create/remove。
    chromeAny.tabs = chromeAny.tabs ?? {};
    const t = chromeAny.tabs;
    t.query = t.query ?? (async (info: any = {}) =>
      Array.from(tabsStore.values()).filter(
        (tab: any) =>
          (info.windowId == null || tab.windowId === info.windowId),
      ));
    t.create = t.create ?? (async (props: any) => {
      const id = nextTabId++;
      const tab = { id, groupId: -1, active: false, ...props };
      tabsStore.set(id, tab);
      return { ...tab };
    });
    t.remove = t.remove ?? (async (id: number) => {
      tabsStore.delete(id);
    });
    t.update = t.update ?? (async (id: number, props: any) => {
      const tab = tabsStore.get(id);
      if (!tab) throw new Error(`Tab ${id} not found`);
      Object.assign(tab, props);
      return { ...tab };
    });
    t.discard = async (id: number) => {
      const tab = tabsStore.get(id);
      if (!tab) throw new Error(`Tab ${id} not found`);
      if (tab.active) throw new Error('Cannot discard active tab');
      return { ...tab, discarded: true };
    };
    t.group = async (opts: { tabIds: number[]; groupId?: number; createProperties?: { windowId: number } }) => {
      let gid = opts.groupId;
      if (gid == null) {
        gid = nextGroupId++;
        groups.set(gid, { id: gid, windowId: opts.createProperties?.windowId ?? -1, title: '', color: 'grey', collapsed: false });
      }
      for (const tid of opts.tabIds) {
        const tab = tabsStore.get(tid);
        if (tab) tab.groupId = gid;
      }
      return gid;
    };
    t.ungroup = async (tabIds: number[]) => {
      for (const tid of tabIds) {
        const tab = tabsStore.get(tid);
        if (tab) tab.groupId = -1;
      }
    };
    t.move = async (ids: number[], props: { index: number }) => {
      const entries = Array.from(tabsStore.entries());
      const idSet = new Set(ids);
      const moving = entries.filter(([id]) => idSet.has(id));
      const rest = entries.filter(([id]) => !idSet.has(id));
      const pos = Math.min(Math.max(props.index, 0), rest.length);
      const reordered = [...rest.slice(0, pos), ...moving, ...rest.slice(pos)];
      tabsStore.clear();
      for (const [id, tab] of reordered) tabsStore.set(id, tab);
    };
    // 暴露给测试重置/种子（测试通过 globalThis.chrome.tabs 访问）
    (chromeAny as any).__testGroups = groups;
    (chromeAny as any).__testTabs = tabsStore;
  }
});

afterEach(() => {
  cleanup();
});
