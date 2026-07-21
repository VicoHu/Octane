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
});

afterEach(() => {
  cleanup();
});
