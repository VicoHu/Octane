# 全局主按钮炭灰化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将所有 shadcn `Button default` 主操作统一为 A 方案的炭灰底、浅色文字和品牌绿图标，同时保留导航与状态控件的品牌绿色。

**Architecture:** 保持 `--primary` 作为品牌 accent，新增 `--action-primary-*` 语义 token，并在 Tailwind theme 中映射。共享 `buttonVariants.default` 只引用主操作 token，使所有调用方自动同步且不影响其他 variant。

**Tech Stack:** React 19、TypeScript、shadcn/ui Base UI、Tailwind CSS v4、CVA、Vitest、Testing Library。

---

### Task 1: 用共享组件测试锁定 A 方案视觉契约

**Files:**
- Modify: `src/components/ui/__tests__/primitives.test.tsx`

- [x] **Step 1: 写失败测试**

在现有 import 中加入 `Plus` 与 `Button`：

```tsx
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
```

在 `describe('共享 UI 原语')` 中加入：

```tsx
it('默认按钮使用炭灰主操作语义且不影响描边按钮', () => {
  render(
    <>
      <Button>
        <Plus data-icon="inline-start" />
        添加书签
      </Button>
      <Button variant="outline">取消</Button>
    </>,
  );

  const primary = screen.getByRole('button', { name: '添加书签' });
  const outline = screen.getByRole('button', { name: '取消' });

  expect(primary).toHaveClass(
    'bg-action-primary',
    'text-action-primary-foreground',
    'hover:bg-action-primary-hover',
    'active:bg-action-primary-active',
    '[&_svg]:text-action-primary-icon',
  );
  expect(primary).not.toHaveClass('bg-primary', 'text-primary-foreground');
  expect(outline).not.toHaveClass(
    'bg-action-primary',
    'text-action-primary-foreground',
  );
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run: `pnpm exec vitest run src/components/ui/__tests__/primitives.test.tsx`

Expected: FAIL，默认按钮仍包含 `bg-primary text-primary-foreground`，且缺少 `bg-action-primary`。

### Task 2: 实现主操作 token 与共享 Button variant

**Files:**
- Modify: `src/styles/global.css`
- Modify: `src/styles/tailwind-theme.css`
- Modify: `src/components/ui/button.tsx`

- [x] **Step 1: 新增主操作语义 token**

在 `src/styles/global.css` 的品牌色 token 后加入：

```css
  /* === 主操作：A 方案炭灰实色，品牌绿仅作图标与焦点信号 === */
  --action-primary: #202829;
  --action-primary-hover: #2b3634;
  --action-primary-active: #17201e;
  --action-primary-foreground: #f6f8f7;
  --action-primary-icon: #55efc4;
```

- [x] **Step 2: 映射 Tailwind v4 theme**

在 `src/styles/tailwind-theme.css` 的 `@theme inline` 颜色映射中加入：

```css
  --color-action-primary: var(--action-primary);
  --color-action-primary-hover: var(--action-primary-hover);
  --color-action-primary-active: var(--action-primary-active);
  --color-action-primary-foreground: var(--action-primary-foreground);
  --color-action-primary-icon: var(--action-primary-icon);
```

- [x] **Step 3: 修改共享默认 variant**

将 `src/components/ui/button.tsx` 的 `default` variant 替换为：

```tsx
default:
  "bg-action-primary text-action-primary-foreground hover:bg-action-primary-hover active:bg-action-primary-active [&_svg]:text-action-primary-icon",
```

不修改 `outline`、`secondary`、`ghost`、`destructive` 与 `link`。

- [x] **Step 4: 运行针对性测试并确认 GREEN**

Run: `pnpm exec vitest run src/components/ui/__tests__/primitives.test.tsx`

Expected: PASS，5 个共享 UI 原语测试全部通过。

- [x] **Step 5: 提交组件实现**

```bash
git add src/components/ui/__tests__/primitives.test.tsx src/components/ui/button.tsx src/styles/global.css src/styles/tailwind-theme.css
git commit -m "style: redesign primary buttons with charcoal actions"
```

### Task 3: 同步设计规范并完成全量验收

**Files:**
- Modify: `DESIGN.md`
- Modify: `docs/design-guidelines.md`

- [x] **Step 1: 更新 token 说明**

在两份规范的颜色章节中明确增加：

```text
主操作 action-primary = #202829，hover = #2B3634，active = #17201E，
foreground = #F6F8F7，icon = #55EFC4。品牌绿 primary 继续用于图标、focus、
选中指示和状态控件，不再作为默认主按钮的大面积底色。
```

- [x] **Step 2: 更新组件与 Do/Don't 规则**

将原“绿底 + 炭灰字”的主按钮规则替换为：

```text
主按钮使用炭灰 action-primary 底 + 浅色文字；有图标时图标使用 action-primary-icon。
每个功能区仍只保留一个主操作。禁止逐页覆写颜色，也禁止把 Rail/Checkbox/Switch/
Badge 等导航或状态绿色改成主操作炭灰。
```

- [x] **Step 3: 运行格式与静态检查**

Run: `git diff --check && pnpm run typecheck`

Expected: 两条命令 exit 0，无空白错误或 TypeScript 错误。

- [x] **Step 4: 运行全量测试**

Run: `pnpm run test`

Expected: exit 0，全部测试通过。

- [x] **Step 5: 启动开发服务器并做视觉验收**

Run: `pnpm run dev`

在 Home 页面确认：

- “添加书签”为炭灰底、浅色文字、浅绿 Plus 图标。
- 弹窗“确定/保存”使用同一炭灰主操作风格。
- Rail 当前项、Checkbox、Switch、Badge 与 Tabs 指示仍为品牌绿。
- Hover、Active、Focus-visible、Disabled 状态无布局位移。

- [x] **Step 6: 提交规范更新**

```bash
git add DESIGN.md docs/design-guidelines.md
git commit -m "docs: update primary action button tokens"
```

### Task 4: 最终复核

**Files:**
- Verify: all files changed by Tasks 1–3

- [x] **Step 1: 检查变更范围**

Run: `git status --short && git diff HEAD~2 --stat && git diff HEAD~2 -- src/components/ui/button.tsx src/styles/global.css src/styles/tailwind-theme.css DESIGN.md docs/design-guidelines.md`

Expected: 只包含共享 Button、token、测试与设计规范；没有逐页业务组件颜色覆写。

- [x] **Step 2: 重新运行最终验证**

Run: `pnpm run typecheck && pnpm run test`

Expected: exit 0，TypeScript 与全量测试双绿。
