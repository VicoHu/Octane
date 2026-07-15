# Shadcn Visual Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Semi 迁移到 shadcn/ui 后的 token、共享原语、Home、Settings、popup 与 sidepanel 视觉和交互回归，同时保持业务行为不变。

**Architecture:** 先把 `DESIGN.md` 的语义 token 单向映射到 Tailwind/shadcn，再由 `src/components/ui/*` 提供一致的尺寸、状态和变体。页面层只保留网格、纵横导航和复杂列表项的专属结构；所有用户交互继续调用现有 store、service 与回调。

**Tech Stack:** React 19、TypeScript 6、WXT、Tailwind CSS v4、shadcn/ui（Base UI）、CSS Modules、Vitest 4、Testing Library、Playwright。

---

## 文件结构

- `src/styles/tailwind-theme.css`：shadcn/Tailwind 语义 token 与暗色 token。
- `src/styles/global.css`：项目业务 token，只保留不与 shadcn 冲突的别名和全局排版。
- `src/components/ui/*`：共享原语视觉、尺寸、焦点和 Tabs/Alert 变体。
- `src/entrypoints/home/components/*`：Home 专属网格、卡片、Settings 布局和复杂列表操作区。
- `src/components/UnlockModal/*`：全局解锁弹窗的业务模式与共享 Dialog 组合。
- `src/entrypoints/popup/*`、`src/entrypoints/sidepanel/*`：紧凑入口中的可见按钮语义。
- 各组件相邻 `__tests__` / `*.test.tsx`：只测试用户可观察行为，真实渲染 shadcn/Base UI。

## Task 1: 统一 token 与共享原语

**Files:**
- Modify: `src/styles/tailwind-theme.css`
- Modify: `src/styles/global.css`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/textarea.tsx`
- Modify: `src/components/ui/select.tsx`
- Modify: `src/components/ui/dialog.tsx`
- Modify: `src/components/ui/tabs.tsx`
- Modify: `src/components/ui/alert.tsx`
- Create: `src/components/ui/__tests__/primitives.test.tsx`

- [ ] **Step 1: 写共享原语行为红测**

```tsx
// /Users/vicohu/project/open-source/octane/src/components/ui/__tests__/primitives.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

describe('共享 UI 原语', () => {
  it('纵向 line tabs 保持可访问方向并可切换内容', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="a" orientation="vertical">
        <TabsList variant="line" aria-label="设置分类">
          <TabsTrigger value="a">常规</TabsTrigger>
          <TabsTrigger value="b">安全</TabsTrigger>
        </TabsList>
        <TabsContent value="a">常规内容</TabsContent>
        <TabsContent value="b">安全内容</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole('tablist', { name: '设置分类' })).toHaveAttribute(
      'aria-orientation',
      'vertical',
    );
    await user.click(screen.getByRole('tab', { name: '安全' }));
    expect(screen.getByText('安全内容')).toBeVisible();
  });

  it('info alert 以提示语义呈现正文', () => {
    render(
      <Alert variant="info">
        <AlertDescription>备份文件包含加密密文</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('备份文件包含加密密文');
  });
});
```

- [ ] **Step 2: 运行红测并确认新增 API 尚不存在**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run src/components/ui/__tests__/primitives.test.tsx
```

Expected: FAIL，TypeScript/运行时指出 `TabsList.variant="line"` 或 `Alert.variant="info"` 尚未定义。

- [ ] **Step 3: 消除 token 双义与旧值覆盖**

```css
/* /Users/vicohu/project/open-source/octane/src/styles/global.css */
:root {
  --sidebar-width: 260px;
  --header-height: 56px;
  --content-bg: var(--background);
  --surface-secondary: var(--secondary);
  --card-bg: var(--card);
  --text-primary: var(--foreground);
  --text-secondary: #475569;
  --text-muted: var(--muted-foreground);
  --border-color: var(--border);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --font-xs: 12px;
  --font-md: 14px;
  --font-lg: 16px;
  --font-xl: 20px;
  --font-2xl: 24px;
  --font-display: 32px;
}

.semi-always-dark {
  --sidebar-bg: var(--background);
  --sidebar-text: var(--foreground);
  --sidebar-text-muted: var(--muted-foreground);
  --sidebar-active-bg: var(--card);
  --sidebar-hover-bg: var(--accent);
  --sidebar-border: var(--border);
  --sidebar-surface: var(--card);
}

html, body, #root {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Helvetica Neue', Arial, sans-serif;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

同步把业务 CSS 中作为文本色的 `var(--muted)` 改为 `var(--text-muted)`；`tailwind-theme.css` 继续持有 `--muted` 表面色和 `--muted-foreground` 文本色。

- [ ] **Step 4: 实现原语视觉映射与 Tabs/Alert 变体**

```tsx
// /Users/vicohu/project/open-source/octane/src/components/ui/tabs.tsx
import { cva, type VariantProps } from 'class-variance-authority';

const tabsListVariants = cva('inline-flex w-fit items-center text-muted-foreground', {
  variants: {
    variant: {
      segmented:
        'gap-1 rounded-md bg-muted p-1 [&_[data-slot=tabs-trigger][data-active]]:bg-background [&_[data-slot=tabs-trigger][data-active]]:shadow-sm',
      line:
        'gap-1 bg-transparent p-0 [&_[data-slot=tabs-trigger]]:justify-start [&_[data-slot=tabs-trigger][data-active]]:text-foreground',
    },
  },
  defaultVariants: { variant: 'segmented' },
});

function TabsList({
  className,
  variant = 'segmented',
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}
```

```tsx
// /Users/vicohu/project/open-source/octane/src/components/ui/alert.tsx
const alertVariants = cva(
  'group/alert relative grid w-full gap-1 rounded-md border px-4 py-3 text-left text-sm',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        info: 'border-sky-200 bg-sky-50 text-slate-700',
        destructive: 'bg-card text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
```

将 `Button/Input/Textarea/SelectTrigger` 的根圆角改为 `rounded-sm`，`SelectContent` 改为 `rounded-md`，`DialogContent` 改为 `rounded-lg`；Button 默认状态使用 `hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]`，link 使用 `text-[var(--primary-text)]`。Dialog overlay 改为 `bg-black/35` 并删除 backdrop blur。

- [ ] **Step 5: 运行原语测试、类型检查和构建**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run src/components/ui/__tests__/primitives.test.tsx
pnpm run typecheck
pnpm run build
```

Expected: 原语测试 PASS，typecheck PASS，WXT build PASS。

- [ ] **Step 6: 提交 Task 1**

```bash
# /Users/vicohu/project/open-source/octane
git add src/styles/tailwind-theme.css src/styles/global.css src/components/ui src/components/ui/__tests__/primitives.test.tsx
git commit -m "fix(ui): align shadcn primitives with design tokens"
```

## Task 2: 恢复 Home 书签卡片与内容密度

**Files:**
- Modify: `src/entrypoints/home/components/BookmarkCard/index.tsx`
- Modify: `src/entrypoints/home/components/BookmarkCard/index.module.css`
- Modify: `src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx`
- Modify: `src/entrypoints/home/components/Content/index.tsx`
- Modify: `src/entrypoints/home/components/Content/index.module.css`
- Modify: `src/entrypoints/home/components/Content/__tests__/Content.test.tsx`
- Modify: `src/entrypoints/home/components/Sidebar/index.module.css`

- [ ] **Step 1: 把旧 BookmarkCard 点击测试改为真实按钮语义红测**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx
it('点击书签主操作 → 打开书签，且编辑按钮不触发打开', async () => {
  const user = userEvent.setup();
  const onClick = vi.fn();
  const onEditBookmark = vi.fn();
  renderCard({}, { onClick, onEditBookmark });

  await user.click(screen.getByRole('button', { name: '打开书签 GitHub' }));
  expect(onClick).toHaveBeenCalledWith(bookmark);

  await user.click(screen.getByRole('button', { name: '编辑书签' }));
  expect(onEditBookmark).toHaveBeenCalledWith(bookmark);
  expect(onClick).toHaveBeenCalledTimes(1);
});
```

同时把本文件本次触及的 `fireEvent.click`、`.toBeTruthy()` 和 container query 改为 `userEvent`、jest-dom 与语义 query；保留图片 `error` 底层事件时加中文注释说明例外。

- [ ] **Step 2: 运行 BookmarkCard 红测**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx
```

Expected: FAIL，找不到名称为“打开书签 GitHub”的按钮。

- [ ] **Step 3: 将 BookmarkCard 拆为同级主操作与工具操作**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/BookmarkCard/index.tsx
<Card
  role="listitem"
  aria-label={hasOpenTab ? `${bookmark.name}，已打开` : bookmark.name}
  className={`${styles.card} ${hasOpenTab ? styles.cardHasOpenTab : ''} ${pulsing ? styles.pulsing : ''}`}
>
  <button
    type="button"
    className={styles.mainAction}
    aria-label={`打开书签 ${bookmark.name}`}
    onClick={() => {
      onClick(bookmark);
      if (hasOpenTab) {
        setPulsing(true);
        window.setTimeout(() => setPulsing(false), 400);
      }
    }}
  />
  {grip && <div className={styles.gripSlot}>{grip}</div>}
</Card>
```

从 `Card` 删除现有 `onClick`，把上述透明主操作 button 插入为第一个 child；现有 favicon、徽章、信息和 actions 保持当前 sibling 顺序。这样不移动 Tooltip/AlertDialog，也不改变回调与删除确认逻辑。

```css
/* /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/BookmarkCard/index.module.css */
.card {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 70px;
  padding: 0 var(--space-lg);
  border-radius: var(--radius-md);
}

.mainAction {
  position: absolute;
  inset: 0;
  z-index: 1;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.mainAction:focus-visible {
  outline: 3px solid var(--primary-focus);
  outline-offset: -3px;
}

.gripSlot,
.actions,
.contextBadge {
  position: relative;
  z-index: 2;
}

.name { font-size: var(--font-lg); }
.url { font-size: var(--font-xs); }
```

- [ ] **Step 4: 收紧 Content 网格并把搜索清除改为 shadcn Button**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/Content/index.tsx
{query && (
  <Button
    type="button"
    variant="ghost"
    size="icon-xs"
    onClick={() => setQuery('')}
    className="absolute top-1/2 right-1 -translate-y-1/2"
    aria-label="清除搜索"
  >
    <X />
  </Button>
)}
```

```css
/* /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/Content/index.module.css */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-lg);
}

@media (max-width: 1080px) {
  .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

保留 Sidebar 宽度；只把删除 SVG 设为 16px，并用 `:hover`、`:focus-within` 与 pointer coarse 媒体查询控制显隐。

- [ ] **Step 5: 运行 Home 相关测试**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run \
  src/entrypoints/home/components/BookmarkCard/__tests__/BookmarkCard.test.tsx \
  src/entrypoints/home/components/Content/__tests__/Content.test.tsx \
  src/entrypoints/home/components/Content/__tests__/ContentDrag.test.tsx
```

Expected: 全部 PASS，拖拽测试保持原行为。

- [ ] **Step 6: 提交 Task 2**

```bash
# /Users/vicohu/project/open-source/octane
git add src/entrypoints/home/components/BookmarkCard src/entrypoints/home/components/Content src/entrypoints/home/components/Sidebar/index.module.css
git commit -m "fix(home): restore bookmark density and card semantics"
```

## Task 3: 恢复 Settings 两级导航与提示层级

**Files:**
- Modify: `src/entrypoints/home/components/SettingsModal/index.tsx`
- Create: `src/entrypoints/home/components/SettingsModal/index.module.css`
- Modify: `src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx`
- Modify: `src/components/backup/BackupSyncTabs.tsx`
- Modify: `src/components/backup/LocalBackupSection.tsx`
- Modify: `src/entrypoints/home/components/SettingsModal/sections/EncryptionTtlSection.tsx`
- Modify: `src/entrypoints/home/components/SettingsModal/sections/__tests__/EncryptionTtlSection.test.tsx`

- [ ] **Step 1: 写 Settings 导航和 TTL 单位红测**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx
it('一级设置导航纵向呈现，备份二级导航横向呈现', async () => {
  const user = userEvent.setup();
  render(<SettingsModal visible={true} onCancel={() => {}} />);

  expect(screen.getByRole('tablist', { name: '设置分类' })).toHaveAttribute(
    'aria-orientation',
    'vertical',
  );
  await user.click(screen.getByRole('tab', { name: '数据备份和同步' }));
  expect(screen.getByRole('tablist', { name: '备份方式' })).toHaveAttribute(
    'aria-orientation',
    'horizontal',
  );
  expect(screen.getByRole('alert')).toHaveTextContent('导出文件含加密笔记的密文');
});
```

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/SettingsModal/sections/__tests__/EncryptionTtlSection.test.tsx
it('两个时长输入都显示秒单位', async () => {
  render(<EncryptionTtlSection />);
  expect(await screen.findByLabelText('自动锁定宽限期（秒）')).toBeEnabled();
  expect(screen.getByLabelText('最长解锁时长（秒）')).toBeEnabled();
});
```

删除 Settings 测试文件内的 `vi.mock('lottie-web')`，并把本次触及的 `fireEvent`、`.toBeTruthy()`、container query 更新为测试规范要求的写法。

- [ ] **Step 2: 运行红测**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run \
  src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx \
  src/entrypoints/home/components/SettingsModal/sections/__tests__/EncryptionTtlSection.test.tsx
```

Expected: FAIL，缺少命名 tablist、纵向方向或 TTL label。

- [ ] **Step 3: 实现 Settings 桌面布局**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/SettingsModal/index.tsx
<DialogContent className={styles.dialogContent}>
  <DialogHeader>
    <DialogTitle>系统设置</DialogTitle>
  </DialogHeader>
  <Tabs defaultValue="shortcuts" orientation="vertical" className={styles.settingsTabs}>
    <TabsList variant="line" aria-label="设置分类" className={styles.settingsNav}>
      <TabsTrigger value="shortcuts">快捷键</TabsTrigger>
      <TabsTrigger value="backup">数据备份和同步</TabsTrigger>
      <TabsTrigger value="maintenance">数据维护</TabsTrigger>
      <TabsTrigger value="password">主密码</TabsTrigger>
    </TabsList>
    <div className={styles.settingsContent}>
      <TabsContent value="shortcuts"><ShortcutsSection /></TabsContent>
      <TabsContent value="backup"><BackupSyncTabs /></TabsContent>
      <TabsContent value="maintenance"><FaviconCacheSection /></TabsContent>
      <TabsContent value="password">
        <PasswordSection />
        <EncryptionTtlSection />
      </TabsContent>
    </div>
  </Tabs>
</DialogContent>
```

```css
/* /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/SettingsModal/index.module.css */
.dialogContent { width: min(720px, calc(100vw - 32px)); max-width: 720px; }
.settingsTabs { min-height: 260px; max-height: 70vh; overflow: hidden; }
.settingsNav {
  width: 136px;
  flex: 0 0 136px;
  flex-direction: column;
  align-items: stretch;
  border-right: 1px solid var(--border-color);
  padding-right: var(--space-lg);
}
.settingsContent { min-width: 0; flex: 1; overflow: auto; padding-left: var(--space-xl); }
```

- [ ] **Step 4: 实现二级 tabs、Info Alert 与 TTL label**

```tsx
// /Users/vicohu/project/open-source/octane/src/components/backup/BackupSyncTabs.tsx
<Tabs defaultValue="local" orientation="horizontal">
  <TabsList variant="segmented" aria-label="备份方式">
    <TabsTrigger value="local">本地备份</TabsTrigger>
    <TabsTrigger value="cloud">云端同步</TabsTrigger>
    <TabsTrigger value="share">分享</TabsTrigger>
  </TabsList>
  <TabsContent value="local"><LocalBackupSection /></TabsContent>
  <TabsContent value="cloud"><CloudBackupSection /></TabsContent>
  <TabsContent value="share"><ShareSection /></TabsContent>
</Tabs>
```

```tsx
// /Users/vicohu/project/open-source/octane/src/components/backup/LocalBackupSection.tsx
<Alert variant="info">
  <Info aria-hidden="true" />
  <AlertDescription>
    导出文件含加密笔记的密文（非明文）。在另一台设备恢复时，需要使用相同的主密码解锁。
  </AlertDescription>
</Alert>
```

TTL 输入使用真实 `<label htmlFor>` 与 `Input id`，文案分别为“自动锁定宽限期（秒）”和“最长解锁时长（秒）”；删除 13px 与 `--semi-*` 裸写，但不改变秒到毫秒、clamp 或持久化逻辑。

- [ ] **Step 5: 运行 Settings 与备份相关测试**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run \
  src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx \
  src/entrypoints/home/components/SettingsModal/sections/__tests__/EncryptionTtlSection.test.tsx \
  src/components/backup/__tests__/LocalBackupSection.test.tsx
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交 Task 3**

```bash
# /Users/vicohu/project/open-source/octane
git add src/entrypoints/home/components/SettingsModal src/components/backup/BackupSyncTabs.tsx src/components/backup/LocalBackupSection.tsx
git commit -m "fix(settings): restore two-level navigation hierarchy"
```

## Task 4: 收口 Home 其余可见交互控件

**Files:**
- Modify: `src/components/IconPicker/index.tsx`
- Modify: `src/entrypoints/home/components/ContextEditor/index.tsx`
- Modify: `src/entrypoints/home/components/ManagePanel/index.tsx`
- Modify: `src/entrypoints/home/components/PinnedArea/index.tsx`
- Modify: `src/entrypoints/home/components/Sidebar/index.tsx`
- Modify: `src/entrypoints/home/components/ContextList/index.tsx`
- Modify: `src/entrypoints/home/components/TabList/index.tsx`
- Modify: `src/components/IconPicker/__tests__/IconPicker.test.tsx`
- Modify: `src/entrypoints/home/components/ManagePanel/__tests__/ManagePanel.test.tsx`
- Modify: `src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx`
- Modify: `src/entrypoints/home/components/Sidebar/__tests__/category.test.tsx`
- Modify: `src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx`
- Modify: `src/entrypoints/home/components/TabList/__tests__/index.test.tsx`

- [ ] **Step 1: 为复杂列表项写键盘交互红测**

在 `ManagePanel.test.tsx`、`PinnedArea.test.tsx`、`Sidebar/category.test.tsx`、`ContextList.test.tsx` 和 `TabList/index.test.tsx` 中使用同一用户行为口径：Tab 聚焦主操作，Enter 激活主操作，删除/编辑按钮只触发自己的回调。

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ManagePanel/__tests__/ManagePanel.test.tsx
it('键盘聚焦工作区主操作并进入编辑', async () => {
  const user = userEvent.setup();
  render(<ManagePanel visible={true} onCancel={vi.fn()} />);
  const editWorkspace = screen.getByRole('button', { name: /编辑工作区 Personal/ });
  await user.tab();
  while (document.activeElement !== editWorkspace) await user.tab();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: /编辑工作区/ })).toBeVisible();
});
```

每个测试使用该文件已有 render helper 和现有可见文案，不引入私有 testid，不整体 mock 被测组件。

- [ ] **Step 2: 运行 Home 控件测试并确认伪按钮导致失败**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run \
  src/entrypoints/home/components/ManagePanel/__tests__/ManagePanel.test.tsx \
  src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx \
  src/entrypoints/home/components/Sidebar/__tests__/category.test.tsx \
  src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx \
  src/entrypoints/home/components/TabList/__tests__/index.test.tsx
```

Expected: 至少一个测试 FAIL，原因是点击式 `div/li` 不在 button 语义树中。

- [ ] **Step 3: 用 shadcn Button/Textarea 替换直接控件**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextEditor/index.tsx
<Button variant="ghost" size="sm" className={styles.backBtn} onClick={handleBack}>
  <ChevronLeft />
  返回
</Button>

<Textarea
  aria-label="上下文内容"
  value={content}
  onChange={(event) => setContent(event.target.value)}
  className={styles.editor}
/>
```

```tsx
// /Users/vicohu/project/open-source/octane/src/components/IconPicker/index.tsx
<Button
  type="button"
  variant="ghost"
  size="icon"
  aria-label={`选择图标 ${icon}`}
  aria-pressed={value === icon}
  className={value === icon ? styles.selected : undefined}
  onClick={() => onChange(icon)}
>
  <span aria-hidden="true">{icon}</span>
</Button>
```

PinnedArea 的添加、打开、删除按钮分别使用 `ghost/icon` 变体；Content Toast 内“添加上下文”使用 `Button variant="link" size="sm"`，不再使用 `<a role="button">`。

- [ ] **Step 4: 重组复杂列表项，不产生嵌套按钮**

Sidebar、ContextList、TabList 与 ManagePanel 的每个条目保持 `<li>` 作为容器，容器内部放一个占据剩余空间的 `Button variant="ghost"` 作为主操作，再放独立的编辑/删除图标 Button。主操作与工具按钮必须是兄弟节点。

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/Sidebar/index.tsx
<li className={styles.cat}>
  <Button
    type="button"
    variant="ghost"
    className={styles.categoryMainAction}
    aria-current={isActive ? 'page' : undefined}
    onClick={onSelect}
  >
    <span aria-hidden="true">{cat.icon}</span>
    <span className={styles.categoryName}>{cat.name}</span>
  </Button>
  <Button
    type="button"
    variant="ghost"
    size="icon-sm"
    aria-label={`删除分类 ${cat.name}`}
    onClick={onDelete}
  >
    <Trash2 />
  </Button>
</li>
```

拖拽 listeners 仍只挂在现有 GripButton；本任务不替换 GripButton，不改变 dnd-kit ref、listener 或激活距离。

- [ ] **Step 5: 运行 Home 控件与拖拽测试**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run \
  src/components/IconPicker/__tests__/IconPicker.test.tsx \
  src/entrypoints/home/components/ManagePanel/__tests__/ManagePanel.test.tsx \
  src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx \
  src/entrypoints/home/components/Sidebar/__tests__/category.test.tsx \
  src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx \
  src/entrypoints/home/components/TabList/__tests__/index.test.tsx \
  src/entrypoints/home/components/dnd/__tests__/GripButton.test.tsx
```

Expected: 全部 PASS，拖拽手柄行为不变。

- [ ] **Step 6: 提交 Task 4**

```bash
# /Users/vicohu/project/open-source/octane
git add src/components/IconPicker src/entrypoints/home/components
git commit -m "refactor(home): use accessible shadcn interaction controls"
```

## Task 5: 将 UnlockModal 接入共享 Dialog

**Files:**
- Modify: `src/components/UnlockModal/index.tsx`
- Modify: `src/components/UnlockModal/index.module.css`
- Create: `src/components/UnlockModal/__tests__/UnlockModal.test.tsx`

- [ ] **Step 1: 写可关闭与强制重设行为红测**

```tsx
// /Users/vicohu/project/open-source/octane/src/components/UnlockModal/__tests__/UnlockModal.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnlockModal } from '../index';

const state = {
  passwordSet: true,
  unlocked: true,
  loading: false,
  unlockModalOpen: true,
  needsReset: false,
  setupMasterPassword: vi.fn(),
  unlockWithPassword: vi.fn(),
  resetPassword: vi.fn(),
  closeUnlockModal: vi.fn(),
};

vi.mock('@/store/useCrypto', () => ({
  useCrypto: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), error: vi.fn() },
}));

describe('UnlockModal — 全局解锁弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.needsReset = false;
    state.unlockModalOpen = true;
  });

  it('手动打开时按 Escape → 请求关闭', async () => {
    const user = userEvent.setup();
    render(<UnlockModal />);
    await user.keyboard('{Escape}');
    expect(state.closeUnlockModal).toHaveBeenCalledTimes(1);
  });

  it('强制重设时按 Escape → 保持弹窗打开', async () => {
    const user = userEvent.setup();
    state.needsReset = true;
    render(<UnlockModal />);
    await user.keyboard('{Escape}');
    expect(state.closeUnlockModal).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '重设主密码' })).toBeVisible();
  });
});
```

- [ ] **Step 2: 运行 UnlockModal 红测**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run src/components/UnlockModal/__tests__/UnlockModal.test.tsx
```

Expected: FAIL，当前手写 dialog 不处理 Escape。

- [ ] **Step 3: 使用共享 Dialog 并保持受控关闭规则**

```tsx
// /Users/vicohu/project/open-source/octane/src/components/UnlockModal/index.tsx
<Dialog
  open={visible}
  disablePointerDismissal={!canDismiss}
  onOpenChange={(open) => {
    if (!open && canDismiss) closeUnlockModal();
  }}
>
  <DialogContent
    showCloseButton={canDismiss}
    className={styles.card}
    aria-describedby="unlock-subtitle"
  >
    <DialogHeader className={styles.header}>
      <div className={`${styles.badge} ${mode === 'reset' ? styles.badgeDanger : ''}`}>
        {mode === 'reset' ? <TriangleAlert /> : <Lock />}
      </div>
      <DialogTitle>{copy.title}</DialogTitle>
      <DialogDescription id="unlock-subtitle">{copy.subtitle}</DialogDescription>
    </DialogHeader>

    {mode === 'reset' && (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertDescription>
          所有已加密笔记将被清除且无法恢复，请确认后再继续。
        </AlertDescription>
      </Alert>
    )}

    <Input
      type="password"
      placeholder="输入主密码"
      value={password}
      onChange={(event) => setPassword(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void handleSubmit();
      }}
      autoFocus
    />

    {(mode === 'setup' || mode === 'reset') && (
      <Input
        type="password"
        placeholder="确认主密码"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void handleSubmit();
        }}
      />
    )}

    {(mode === 'setup' || mode === 'reset') && (
      <div className={styles.hint}>至少 12 个字符，建议混合字母、数字与符号</div>
    )}

    {error && (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )}

    <Button
      variant={mode === 'reset' ? 'destructive' : 'default'}
      size="lg"
      disabled={loading}
      onClick={handleSubmit}
      className="w-full"
    >
      {copy.cta}
    </Button>
  </DialogContent>
</Dialog>
```

删除手写 overlay、玻璃渐变与 24px blur，复用共享 overlay 和 16px Dialog 圆角。保留 reset/setup 校验、Toast、store 调用和 Enter 提交。

- [ ] **Step 4: 运行 UnlockModal 与密码相关测试**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run \
  src/components/UnlockModal/__tests__/UnlockModal.test.tsx \
  src/entrypoints/home/components/SettingsModal/__tests__/PasswordSection.test.tsx
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交 Task 5**

```bash
# /Users/vicohu/project/open-source/octane
git add src/components/UnlockModal
git commit -m "refactor(ui): move unlock flow to shared dialog"
```

## Task 6: 收口 popup 与 sidepanel 可见控件

**Files:**
- Modify: `src/entrypoints/popup/views/HomeView.tsx`
- Modify: `src/entrypoints/popup/views/SubPageHeader.tsx`
- Modify: `src/entrypoints/popup/views/HomeView.test.tsx`
- Modify: `src/entrypoints/popup/views/SubPageHeader.test.tsx`
- Modify: `src/entrypoints/sidepanel/App.tsx`
- Modify: `src/entrypoints/sidepanel/components/StickyHeader.tsx`
- Modify: `src/entrypoints/sidepanel/components/BookmarkGroup.tsx`
- Modify: `src/entrypoints/sidepanel/components/ContextCard.tsx`
- Modify: `src/entrypoints/sidepanel/__tests__/App.test.tsx`
- Modify: `src/entrypoints/sidepanel/__tests__/App.pinbutton.test.tsx`
- Modify: `src/entrypoints/sidepanel/components/__tests__/StickyHeader.test.tsx`
- Modify: `src/entrypoints/sidepanel/components/__tests__/BookmarkGroup.test.tsx`
- Modify: `src/entrypoints/sidepanel/components/__tests__/ContextCard.test.tsx`

- [ ] **Step 1: 写 popup/sidepanel 按钮语义红测**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/sidepanel/components/__tests__/StickyHeader.test.tsx
it('Pin 与添加入口都是可键盘激活的按钮', async () => {
  const user = userEvent.setup();
  const onPin = vi.fn();
  const onAdd = vi.fn();
  render(<StickyHeader hostname="example.com" matchCount={1} onPin={onPin} onAdd={onAdd} />);

  await user.click(screen.getByRole('button', { name: 'Pin 当前 Tab' }));
  await user.click(screen.getByRole('button', { name: '添加书签' }));
  expect(onPin).toHaveBeenCalledTimes(1);
  expect(onAdd).toHaveBeenCalledTimes(1);
});
```

在 HomeView 测试查询工作区入口 button，在 SubPageHeader 测试查询“返回”button，在 BookmarkGroup 测试查询“添加上下文”button，在 ContextCard 测试查询书签主操作 button，在 sidepanel App 测试查询“在 Octane 管理”button；ContextCard 不再手动派发 keyDown。

- [ ] **Step 2: 运行入口测试并确认伪按钮/原生样式不符合契约**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run \
  src/entrypoints/popup/views/HomeView.test.tsx \
  src/entrypoints/popup/views/SubPageHeader.test.tsx \
  src/entrypoints/sidepanel/components/__tests__/StickyHeader.test.tsx \
  src/entrypoints/sidepanel/components/__tests__/BookmarkGroup.test.tsx \
  src/entrypoints/sidepanel/components/__tests__/ContextCard.test.tsx \
  src/entrypoints/sidepanel/__tests__/App.test.tsx
```

Expected: 新增主操作 button 查询至少一处 FAIL。

- [ ] **Step 3: 使用 Button 替换可见控件**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/sidepanel/components/StickyHeader.tsx
<Button variant="ghost" size="icon" onClick={onPin} aria-label="Pin 当前 Tab" title="Pin 当前 Tab">
  <Pin />
</Button>
<Button variant="ghost" size="icon" onClick={onAdd} aria-label="添加书签" title="添加书签">
  <Plus />
</Button>
```

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/popup/views/SubPageHeader.tsx
<Button variant="ghost" size="icon" onClick={onBack} aria-label="返回">
  <ChevronLeft />
</Button>
```

HomeView 的点击式 `<li>` 改为 `<li>` 内完整宽度 Button；ContextCard 的 `div role="button"` 改为 Button；BookmarkGroup、sidepanel App 的 Pin、添加与“在 Octane 管理”分别使用 icon/ghost/outline 变体。保留现有 className 以维持紧凑布局，只删除已被 Button 覆盖的边框、背景和键盘手写逻辑。

- [ ] **Step 4: 运行 popup/sidepanel 全部组件测试**

```bash
# /Users/vicohu/project/open-source/octane
pnpm vitest run src/entrypoints/popup src/entrypoints/sidepanel
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交 Task 6**

```bash
# /Users/vicohu/project/open-source/octane
git add src/entrypoints/popup src/entrypoints/sidepanel
git commit -m "refactor(entries): standardize visible shadcn controls"
```

## Task 7: 全量验证与视觉验收

**Files:**
- Modify only if verification exposes a regression directly caused by Tasks 1–6.

- [ ] **Step 1: 搜索残留可见原生控件**

```bash
# /Users/vicohu/project/open-source/octane
rg -n '<button|role="button"|<textarea' \
  src/components src/entrypoints/home src/entrypoints/popup src/entrypoints/sidepanel \
  --glob '!src/components/ui/**' --glob '!**/*test*'
```

Expected: 仅隐藏文件 input、经验证保留的 dnd Grip 原生 button，以及残留 Semi Form/Tree 范围；每个其他命中都应追溯到设计文档的明确例外。

- [ ] **Step 2: 运行静态检查、全量测试与构建**

```bash
# /Users/vicohu/project/open-source/octane
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

Expected: lint 0 error，typecheck PASS，全部测试 PASS，WXT build PASS。已有 lint warning 可记录但不做无关清理。

- [ ] **Step 3: 启动开发服务器并加载扩展入口**

```bash
# /Users/vicohu/project/open-source/octane
pnpm run dev
```

Expected: WXT dev server 启动，无编译错误；记录实际端口与 Chrome 扩展输出目录。

- [ ] **Step 4: 使用 Playwright 做多视口视觉验收**

Home 分别设置 1024×768、1200×800、1440×900；Settings 在每个视口打开“系统设置 → 数据备份和同步”；popup 使用 360×560；sidepanel 使用 420×800。每个视口保存截图并检查：

- 页面无水平滚动或内容重叠；
- 1200px Home 为三列横向卡片，1024px 至少两列；
- Dialog 遮罩不强 blur，Settings 一级纵向、二级横向；
- 文本不溢出按钮，hover/focus/disabled 状态不引发布局跳动；
- canvas/页面像素非空，favicon 与图标正常渲染。

- [ ] **Step 5: 最终提交仅包含验收发现的必要修复**

```bash
# /Users/vicohu/project/open-source/octane
git add src
git commit -m "fix(ui): resolve visual verification regressions"
```

若 Step 4 未发现需修代码的问题，则跳过该提交，不创建空 commit。
