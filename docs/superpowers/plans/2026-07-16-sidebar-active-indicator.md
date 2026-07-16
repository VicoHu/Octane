# Sidebar 分类选中指示条一体化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Sidebar 分类选中态的绿色竖条沿用选中背景的左侧圆角轮廓，不再呈现为独立贴附元素。

**Architecture:** 保留现有 `.catActive::before` 伪元素和全部布局/token，只调整其四角圆角值。新增一个源码级 CSS 契约测试，确保外侧圆角引用项目 token、内侧保持直角；组件 DOM 和交互不变。

**Tech Stack:** CSS Modules、Vitest 4、Node.js `fs`

---

### Task 1: 锁定并实现选中指示条外侧圆角

**Files:**
- Create: `src/entrypoints/home/components/Sidebar/__tests__/styles.test.ts`
- Modify: `src/entrypoints/home/components/Sidebar/index.module.css:123`

- [ ] **Step 1: 编写失败的 CSS 契约测试**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.module.css', import.meta.url), 'utf8');

describe('Sidebar 分类选中态样式', () => {
  it('绿色指示条沿用选中项左侧圆角，内侧保持直角', () => {
    const activeIndicator = css.match(/\.catActive::before\s*\{([^}]*)\}/)?.[1];

    expect(activeIndicator).toContain(
      'border-radius: var(--radius-sm) 0 0 var(--radius-sm);',
    );
  });
});
```

- [ ] **Step 2: 运行定向测试并确认先失败**

Run: `pnpm exec vitest run src/entrypoints/home/components/Sidebar/__tests__/styles.test.ts`

Expected: FAIL，提示 `.catActive::before` 未包含 `border-radius: var(--radius-sm) 0 0 var(--radius-sm);`。

- [ ] **Step 3: 最小修改绿色指示条圆角**

将 `src/entrypoints/home/components/Sidebar/index.module.css` 中 `.catActive::before` 的圆角改为：

```css
.catActive::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--primary);
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}
```

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `pnpm exec vitest run src/entrypoints/home/components/Sidebar/__tests__/styles.test.ts`

Expected: PASS，1 个测试通过。

- [ ] **Step 5: 运行项目验证**

Run: `pnpm run typecheck`

Expected: PASS，无 TypeScript 错误。

Run: `pnpm run test`

Expected: PASS，全量测试无失败。

- [ ] **Step 6: 浏览器视觉验证**

在 home 页面选择任一分类，确认：

- 绿色指示条覆盖选中背景完整高度。
- 指示条左上、左下与选中背景形成连续的 8px 外轮廓。
- 指示条右侧为直线，分类项尺寸、文字位置、hover 和操作按钮没有变化。

- [ ] **Step 7: 提交实现**

```bash
git add src/entrypoints/home/components/Sidebar/__tests__/styles.test.ts \
  src/entrypoints/home/components/Sidebar/index.module.css
git commit -m "fix(home): integrate sidebar selection indicator"
```
