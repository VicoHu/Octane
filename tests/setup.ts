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

afterEach(() => {
  cleanup();
});
