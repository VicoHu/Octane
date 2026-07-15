// ESLint flat config —— 测试规范 §9.3 机械门
// 目标：最小可用集，存量 fireEvent 等高冲突点降级为 warn（不阻断 CI）
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import testingLibrary from 'eslint-plugin-testing-library';
import vitest from 'eslint-plugin-vitest';

export default tseslint.config(
  // 1. 全局 ignore —— 生成代码/构建产物/桩，不 lint
  {
    ignores: [
      '.wxt/**',
      '.output/**',
      'dist/**',
      'node_modules/**',
      '.worktrees/**', // 本地 git worktree 工作区，避免 lint 扫到临时副本
      'tests/stubs/**',
    ],
  },

  // 2. JS 基线（根目录 config 文件等）
  {
    files: ['*.config.ts', '*.config.js', '*.mjs'],
    extends: [js.configs.recommended],
  },

  // 3. TS 文件（src + tests + 根 config）
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended, // 非 type-aware，避免慢
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // 浏览器扩展环境
        window: 'readonly',
        document: 'readonly',
        chrome: 'readonly',
        browser: 'readonly',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // no-unused-vars 与 TS 重复（TS 已有 noUnusedLocals），降级
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      // 扩展环境常需 any 容器，存量较多，先 warn
      '@typescript-eslint/no-explicit-any': 'warn',
      // 基础质量规则存量遗留，降 warn 不阻断（机械门核心在 testing-library）
      '@typescript-eslint/no-unused-expressions': 'warn',
      'prefer-const': 'warn',
      // 源码存量 hooks 依赖问题（exhaustive-deps / set-state-in-effect），不在本期修复范围，降 warn
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // 4. 测试文件叠加 —— testing-library + vitest 规则
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'tests/**',
    ],
    extends: [
      testingLibrary.configs['flat/react'],
      vitest.configs.recommended,
    ],
    rules: {
      // 关键策略：高冲突规则降级为 warn，避免一次性炸存量文件
      'testing-library/prefer-user-event': 'warn',
      'testing-library/no-container': 'warn',
      'testing-library/no-node-access': 'warn',
      'testing-library/prefer-screen-queries': 'warn',
      'testing-library/no-wait-for-side-effects': 'warn',
      // 以下 recommended 自带 error，存量冲突量大，统一降 warn
      'testing-library/no-await-sync-queries': 'warn',
      'testing-library/render-result-naming-convention': 'warn',
      'testing-library/prefer-find-by': 'warn',
      // tests/setup.ts 手动 cleanup（vitest 自动清理前保留），存量降 warn
      'testing-library/no-manual-cleanup': 'warn',
      // vitest 推荐里若干规则在现有测试集会冲突，先放宽
      'vitest/expect-expect': 'off',
      'vitest/no-done-callback': 'off',
    },
  },
);
