import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Semi barrel 静态 import lottie-web，jsdom 无 canvas 会在模块评估期崩。
      // 全局指向 stub，让任何测试都能真实渲染 Semi 组件。详见 docs/standards/testing.md §4.4。
      'lottie-web': fileURLToPath(new URL('./tests/stubs/lottie-web.ts', import.meta.url)),
    },
  },
  plugins: [WxtVitest()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
