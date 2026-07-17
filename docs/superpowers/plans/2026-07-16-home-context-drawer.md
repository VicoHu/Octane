# Home 上下文抽屉实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Home 书签上下文面板改为桌面 1000px 右侧 Sheet、移动端 100dvh 底部 Drawer，并统一列表态与编辑态的 Home 视觉语言。

**Architecture:** 新增 `useMediaQuery` 作为浏览器媒体查询边界；新增 `ContextPanelShell` 封装 Sheet/Drawer 的响应式选择、标题和关闭控件；`ContextList` 保留全部业务状态并把内容交给外壳；`ContextEditor` 只调整可伸缩布局和可访问控件。数据服务、store、自动保存及加密流程保持不变。

**Tech Stack:** React 19、TypeScript、shadcn/ui Base UI、CSS Modules、Vitest 4、Testing Library、WXT。

---

## 文件结构

- Create: `src/components/ui/drawer.tsx` — shadcn Base UI Drawer 生成组件。
- Create: `src/hooks/useMediaQuery.ts` — 响应式媒体查询订阅。
- Create: `src/hooks/__tests__/useMediaQuery.test.tsx` — 媒体查询初始值和变化测试。
- Create: `src/entrypoints/home/components/ContextPanelShell/index.tsx` — 响应式 Sheet/Drawer 外壳。
- Create: `src/entrypoints/home/components/ContextPanelShell/index.module.css` — 面板尺寸、背景、标题区、触控目标和安全区。
- Create: `src/entrypoints/home/components/ContextPanelShell/__tests__/ContextPanelShell.test.tsx` — 桌面与移动外壳测试。
- Modify: `src/entrypoints/home/components/ContextList/index.tsx` — 接入共享外壳并统一列表内容结构。
- Modify: `src/entrypoints/home/components/ContextList/index.module.css` — Home 风格列表、状态区和底部操作区。
- Modify: `src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx` — 使用真实编辑器验证列表到编辑态。
- Modify: `src/entrypoints/home/components/ContextEditor/index.tsx` — 可访问标签、Lucide 加密图标和可伸缩 Tabs。
- Modify: `src/entrypoints/home/components/ContextEditor/index.module.css` — 平铺编辑器、滚动和移动布局。
- Modify: `src/entrypoints/home/components/ContextEditor/__tests__/ContextEditor.test.tsx` — 控件语义和预览切换测试。

### Task 1: 引入官方 shadcn Drawer

**Files:**
- Create: `src/components/ui/drawer.tsx`

- [ ] **Step 1: 再次确认 registry 变更范围**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm dlx shadcn@latest add drawer --dry-run
```

Expected: 仅计划新增 `src/components/ui/drawer.tsx`；依赖 `@base-ui/react` 已存在，不应新增第二套 Drawer 依赖。

- [ ] **Step 2: 安装生成组件**

此文件由 shadcn CLI 生成，属于 TDD 的生成代码例外。

```bash
# /Users/vicohu/project/open-source/octane
pnpm dlx shadcn@latest add drawer
```

Expected: 新增 `src/components/ui/drawer.tsx`，导出 `Drawer`、`DrawerContent`、`DrawerClose`、`DrawerHeader`、`DrawerTitle`、`DrawerDescription`、`DrawerFooter`。

- [ ] **Step 3: 检查生成文件并统一注释语言**

将生成文件中的分组注释按以下固定映射改为中文：`Base` → `基础样式`、`Nested` → `嵌套抽屉`、`Bleed` → `边缘延伸`、`Sizing` → `尺寸`、`Stack` → `堆叠`、`Transitions` → `过渡`、`Axis` → `轴向`、`Direction` → `方向`。不修改 registry 的类名或 primitive 行为。

Run:

```bash
# /Users/vicohu/project/open-source/octane
rg -n "@/registry|// (Base|Nested|Bleed|Sizing|Stack|Transitions|Axis|Direction)|export \{" src/components/ui/drawer.tsx
pnpm run typecheck
```

Expected: 无 `@/registry` 或英文分组注释残留；Drawer 无额外图标依赖；类型检查退出码为 0。

- [ ] **Step 4: 提交生成组件**

```bash
# /Users/vicohu/project/open-source/octane
git add src/components/ui/drawer.tsx package.json pnpm-lock.yaml
git commit -m "chore(ui): add responsive drawer primitive"
```

### Task 2: 以 TDD 新增媒体查询 hook

**Files:**
- Create: `src/hooks/useMediaQuery.ts`
- Create: `src/hooks/__tests__/useMediaQuery.test.tsx`

- [ ] **Step 1: 写入失败测试**

```tsx
// /Users/vicohu/project/open-source/octane/src/hooks/__tests__/useMediaQuery.test.tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from '../useMediaQuery';

describe('useMediaQuery — 响应式媒体查询', () => {
  let matches = false;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  beforeEach(() => {
    matches = false;
    listeners.clear();
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      media: query,
      get matches() {
        return matches;
      },
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  it('返回初始匹配结果并响应媒体查询变化', () => {
    const { result } = renderHook(() => useMediaQuery('(max-width: 767px)'));
    expect(result.current).toBe(false);

    act(() => {
      matches = true;
      listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    });

    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm exec vitest run src/hooks/__tests__/useMediaQuery.test.tsx
```

Expected: FAIL，原因是 `../useMediaQuery` 尚不存在。

- [ ] **Step 3: 写入最小实现**

```ts
// /Users/vicohu/project/open-source/octane/src/hooks/useMediaQuery.ts
import { useCallback, useMemo, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  const mediaQuery = useMemo(() => window.matchMedia(query), [query]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      mediaQuery.addEventListener('change', onChange);
      return () => mediaQuery.removeEventListener('change', onChange);
    },
    [mediaQuery],
  );
  const getSnapshot = useCallback(() => mediaQuery.matches, [mediaQuery]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm exec vitest run src/hooks/__tests__/useMediaQuery.test.tsx
```

Expected: 1 test passed。

- [ ] **Step 5: 提交 hook**

```bash
# /Users/vicohu/project/open-source/octane
git add src/hooks/useMediaQuery.ts src/hooks/__tests__/useMediaQuery.test.tsx
git commit -m "feat(home): add responsive media query hook"
```

### Task 3: 以 TDD 新增响应式上下文外壳

**Files:**
- Create: `src/entrypoints/home/components/ContextPanelShell/index.tsx`
- Create: `src/entrypoints/home/components/ContextPanelShell/index.module.css`
- Create: `src/entrypoints/home/components/ContextPanelShell/__tests__/ContextPanelShell.test.tsx`

- [ ] **Step 1: 写入桌面和移动端失败测试**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextPanelShell/__tests__/ContextPanelShell.test.tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextPanelShell } from '../index';

const media = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => media.mobile }));

describe('ContextPanelShell — 响应式上下文面板', () => {
  beforeEach(() => {
    media.mobile = false;
  });

  it('桌面端渲染最大 1000px 的右侧 Sheet', () => {
    render(
      <ContextPanelShell open title="测试书签" onOpenChange={vi.fn()} footer={<button>新增</button>}>
        <p>共享内容</p>
      </ContextPanelShell>,
    );

    expect(screen.getByRole('dialog')).toHaveClass('w-screen', 'max-w-[1000px]', 'sm:max-w-[1000px]');
    expect(screen.getByText('共享内容')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭上下文面板' })).toBeInTheDocument();
  });

  it('移动端渲染 100dvh 的底部 Drawer', () => {
    media.mobile = true;
    render(
      <ContextPanelShell open title="测试书签" onOpenChange={vi.fn()}>
        <p>共享内容</p>
      </ContextPanelShell>,
    );

    expect(screen.getByRole('dialog')).toHaveClass('h-dvh', 'max-h-dvh', 'rounded-none');
    expect(screen.getByText('共享内容')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm exec vitest run src/entrypoints/home/components/ContextPanelShell/__tests__/ContextPanelShell.test.tsx
```

Expected: FAIL，原因是 `ContextPanelShell` 尚不存在。

- [ ] **Step 3: 写入响应式外壳实现**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextPanelShell/index.tsx
import type { ReactNode } from 'react';
import { Lock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import styles from './index.module.css';

interface ContextPanelShellProps {
  open: boolean;
  title: string;
  encrypted?: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  footer?: ReactNode;
}

interface PanelFrameProps {
  title: string;
  encrypted: boolean;
  closeControl: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

function PanelFrame({ title, encrypted, closeControl, children, footer }: PanelFrameProps) {
  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <span className={styles.eyebrow}>书签上下文</span>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{title}</h2>
            {encrypted && <Lock aria-label="包含加密上下文" />}
          </div>
        </div>
        {closeControl}
      </header>
      <main className={styles.content}>{children}</main>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </div>
  );
}

export function ContextPanelShell({
  open,
  title,
  encrypted = false,
  onOpenChange,
  children,
  footer,
}: ContextPanelShellProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const accessibleTitle = `${title} 的上下文`;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="down">
        <DrawerContent className={`${styles.mobileDrawer} h-dvh max-h-dvh rounded-none`}>
          <DrawerTitle className="sr-only">{accessibleTitle}</DrawerTitle>
          <PanelFrame
            title={title}
            encrypted={encrypted}
            footer={footer}
            closeControl={
              <DrawerClose render={<Button variant="ghost" size="icon" aria-label="关闭上下文面板" />}>
                <X />
              </DrawerClose>
            }
          >
            {children}
          </PanelFrame>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={`${styles.desktopSheet} w-screen max-w-[1000px] sm:max-w-[1000px]`}
      >
        <SheetTitle className="sr-only">{accessibleTitle}</SheetTitle>
        <PanelFrame
          title={title}
          encrypted={encrypted}
          footer={footer}
          closeControl={
            <SheetClose render={<Button variant="ghost" size="icon" aria-label="关闭上下文面板" />}>
              <X />
            </SheetClose>
          }
        >
          {children}
        </PanelFrame>
      </SheetContent>
    </Sheet>
  );
}
```

```css
/* /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextPanelShell/index.module.css */
.desktopSheet {
  gap: 0;
  padding: 0;
  background: var(--content-bg);
}

.mobileDrawer {
  --drawer-content-height: 100dvh;
  --drawer-content-max-height: 100dvh;
  background: var(--content-bg);
}

.frame {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
}

.header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-xl);
  border-bottom: 1px solid var(--border-color);
  background: var(--card-bg);
}

.headingGroup {
  min-width: 0;
}

.eyebrow {
  display: block;
  margin-bottom: var(--space-xs);
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.titleRow {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-sm);
}

.title {
  overflow: hidden;
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-xl);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.titleRow svg {
  flex: none;
  color: var(--primary-text);
}

.content {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--space-xl);
}

.footer {
  flex: none;
  padding: var(--space-md) var(--space-xl);
  padding-bottom: max(var(--space-md), env(safe-area-inset-bottom));
  border-top: 1px solid var(--border-color);
  background: var(--card-bg);
}

@media (max-width: 767px) {
  .header,
  .content {
    padding: var(--space-md);
  }

  .header > button {
    min-width: 44px;
    min-height: 44px;
  }

  .footer {
    padding-inline: var(--space-md);
  }
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm exec vitest run src/entrypoints/home/components/ContextPanelShell/__tests__/ContextPanelShell.test.tsx
```

Expected: 2 tests passed；测试真实渲染 Sheet 和 Drawer，不 mock UI primitive。

- [ ] **Step 5: 提交响应式外壳**

```bash
# /Users/vicohu/project/open-source/octane
git add src/entrypoints/home/components/ContextPanelShell
git commit -m "feat(home): add responsive context panel shell"
```

### Task 4: 接入 ContextList 并统一列表态

**Files:**
- Modify: `src/entrypoints/home/components/ContextList/index.tsx`
- Modify: `src/entrypoints/home/components/ContextList/index.module.css`
- Modify: `src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx`

- [ ] **Step 1: 写入统一列表标题的失败测试**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx
it('使用统一列表标题并保持底部新增操作可达', async () => {
  render(<ContextList bookmark={bookmark} visible onClose={vi.fn()} />);

  expect(await screen.findByRole('heading', { name: '上下文' })).toBeInTheDocument();
  expect(screen.getByText('1 条记录')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新增上下文' })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行新增测试并确认 RED**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm exec vitest run src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx
```

Expected: 新测试 FAIL，因为当前列表没有“上下文”内容标题和记录计数。

- [ ] **Step 3: 用 ContextPanelShell 替换原 Sheet 外壳**

在 `ContextList` 中删除 Sheet imports，并引入 `ContextPanelShell`。保留原加载、创建、删除和编辑逻辑；把原 JSX 外壳替换为：

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextList/index.tsx
const listFooter = !editingContext && bookmark ? (
  <Button className={styles.createButton} variant="default" onClick={handleCreate}>
    <Plus data-icon="inline-start" />
    新增上下文
  </Button>
) : undefined;

return (
  <ContextPanelShell
    open={visible && !!bookmark}
    title={bookmark?.name ?? ''}
    encrypted={bookmark?.hasEncryptedContext}
    onOpenChange={(open) => {
      if (!open) handleClose();
    }}
    footer={listFooter}
  >
    {bookmark && (editingContext ? (
      <ContextEditor context={editingContext} onBack={handleEditorBack} />
    ) : (
      <section className={styles.listContainer} aria-labelledby="context-list-heading">
        <div className={styles.listHeading}>
          <div>
            <h3 id="context-list-heading">上下文</h3>
            <p>{contexts.length} 条记录</p>
          </div>
        </div>
        <div className={styles.listScroll}>
          {loading ? (
            <div className={styles.loading}>
              <Spinner />
            </div>
          ) : error ? (
            <div className={styles.error}>
              <Empty>
                <EmptyDescription>{error}</EmptyDescription>
              </Empty>
              <Button variant="outline" onClick={loadContexts}>
                重试
              </Button>
            </div>
          ) : contexts.length === 0 ? (
            <Empty>
              <EmptyDescription>暂无上下文</EmptyDescription>
              <Button variant="default" onClick={handleCreate}>
                <Plus data-icon="inline-start" />
                添加第一条上下文
              </Button>
            </Empty>
          ) : (
            <ul className={styles.contextList}>
              {contexts.map((context) => (
                <li key={context.id} className={styles.contextItem}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start overflow-hidden px-3 py-2"
                    aria-label={`编辑上下文 ${context.title || '无标题'}`}
                    onClick={() => setEditingContext(context)}
                  >
                    <div className={styles.contextInfo}>
                      <div className={styles.contextTitle}>
                        <span className="min-w-0 truncate">{context.title || '无标题'}</span>
                        {context.isEncrypted && <Lock className={styles.contextLock} />}
                      </div>
                      <div className={styles.contextTime}>
                        {new Date(context.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除上下文 ${context.title || '无标题'}`}
                          className={styles.deleteBtn}
                        />
                      }
                    >
                      <Trash2 />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认删除该上下文？</AlertDialogTitle>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleDelete(context.id)}
                        >
                          删除
                        </AlertDialogAction>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    ))}
  </ContextPanelShell>
);
```

- [ ] **Step 4: 写入列表布局样式**

```css
/* /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextList/index.module.css */
.listContainer {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.listHeading {
  display: flex;
  flex: none;
  align-items: end;
  justify-content: space-between;
  margin-bottom: var(--space-lg);
}

.listHeading h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-lg);
  font-weight: 600;
}

.listHeading p {
  margin: var(--space-xs) 0 0;
  color: var(--text-secondary);
  font-size: var(--font-sm);
}

.listScroll {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.contextList {
  display: flex;
  margin: 0;
  padding: 0;
  flex-direction: column;
  gap: var(--space-sm);
  list-style: none;
}

.contextItem {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--card-bg);
  transition: box-shadow var(--transition-fast), background var(--transition-fast);
}

.contextItem:hover {
  background: var(--surface-secondary);
  box-shadow: var(--shadow-soft);
}

.createButton {
  width: 100%;
}

.loading,
.error {
  display: flex;
  min-height: 240px;
  align-items: center;
  justify-content: center;
}

.error {
  flex-direction: column;
  gap: var(--space-md);
}

.contextInfo {
  min-width: 0;
  flex: 1;
  text-align: left;
}

.contextTitle {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--space-xs);
  color: var(--text-primary);
  font-size: var(--font-md);
  font-weight: 600;
}

.contextLock {
  flex: none;
  color: var(--primary-text);
}

.contextTime {
  margin-top: var(--space-xs);
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.deleteBtn:hover {
  color: var(--danger);
}

@media (max-width: 767px) {
  .contextItem button {
    min-height: 44px;
  }
}
```

- [ ] **Step 5: 运行 ContextList 测试**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm exec vitest run src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx
```

Expected: ContextList 测试全部通过，列表、键盘和删除行为保持不变。

- [ ] **Step 6: 提交 ContextList 接入**

```bash
# /Users/vicohu/project/open-source/octane
git add src/entrypoints/home/components/ContextList
git commit -m "feat(home): align context list with home layout"
```

### Task 5: 以 TDD 统一 ContextEditor 编辑态

**Files:**
- Modify: `src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx`
- Modify: `src/entrypoints/home/components/ContextEditor/index.tsx`
- Modify: `src/entrypoints/home/components/ContextEditor/index.module.css`
- Modify: `src/entrypoints/home/components/ContextEditor/__tests__/ContextEditor.test.tsx`

- [ ] **Step 1: 改为真实编辑器集成测试并扩展失败测试**

删除 ContextList 测试中的 `vi.mock('../../ContextEditor', ...)`，把 ContextService fixture 补全为真实编辑器需要的数据，并增加 store 边界 mock：

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx
vi.mock('@/services/ContextService', () => ({
  getContexts: vi.fn().mockResolvedValue([
    {
      id: 'ctx1',
      bookmarkId: 'b1',
      title: '上下文一',
      content: '正文内容',
      isEncrypted: false,
      updatedAt: 0,
      type: 'note',
      order: 0,
      createdAt: 0,
    },
  ]),
  createContext: vi.fn(),
  deleteContext: vi.fn().mockResolvedValue(undefined),
  updateContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store/useCrypto', () => ({
  useCrypto: (selector: (state: { unlocked: boolean }) => unknown) => selector({ unlocked: true }),
}));

it('从列表进入编辑态时在同一面板渲染真实编辑器', async () => {
  const user = userEvent.setup();
  render(<ContextList bookmark={bookmark} visible onClose={vi.fn()} />);

  await user.click(await screen.findByRole('button', { name: '编辑上下文 上下文一' }));

  expect(screen.getByRole('textbox', { name: '上下文标题' })).toHaveValue('上下文一');
  expect(screen.getByRole('textbox', { name: '上下文内容' })).toHaveValue('正文内容');
});
```

同时扩展 ContextEditor 测试：

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextEditor/__tests__/ContextEditor.test.tsx
it('标题、加密开关和预览可通过用户语义操作', async () => {
  const user = userEvent.setup();
  render(<ContextEditor context={context} onBack={vi.fn()} />);

  expect(screen.getByRole('textbox', { name: '上下文标题' })).toHaveValue('测试上下文');
  expect(screen.getByRole('switch', { name: '加密上下文' })).not.toBeChecked();

  await user.click(screen.getByRole('tab', { name: '预览' }));
  expect(screen.getByText('正文')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm exec vitest run \
  src/entrypoints/home/components/ContextEditor/__tests__/ContextEditor.test.tsx \
  src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx
```

Expected: 两个文件均因标题输入缺少 `上下文标题` 可访问名称而 FAIL；ContextEditor 测试还会报告 Switch 缺少 `加密上下文` 名称。

- [ ] **Step 3: 添加语义标签并替换 emoji 图标**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextEditor/index.tsx
import { ChevronLeft, LockKeyhole } from 'lucide-react';

<Input
  value={title}
  onChange={(event) => handleTitleChange(event.target.value)}
  placeholder="上下文标题"
  aria-label="上下文标题"
  className={styles.titleInput}
/>

<div className={styles.encryptRow}>
  <span className={`${styles.encryptLabel} ${isEncrypted ? styles.encryptActive : styles.encryptInactive}`}>
    {isEncrypted && <LockKeyhole aria-hidden="true" />}
    {isEncrypted ? '加密' : '普通'}
  </span>
  <Switch
    checked={isEncrypted}
    onCheckedChange={handleEncryptionToggle}
    aria-label="加密上下文"
    size="sm"
  />
</div>

<Tabs className={styles.tabs} value={tab} onValueChange={(value) => setTab(value as 'edit' | 'preview')}>
  <TabsList>
    <TabsTrigger value="edit">编辑</TabsTrigger>
    <TabsTrigger value="preview">预览</TabsTrigger>
  </TabsList>
  <TabsContent className={styles.tabContent} value="edit">
    <Textarea
      value={content}
      onChange={(event) => handleContentChange(event.target.value)}
      placeholder="点击开始记录...（支持 Markdown）"
      aria-label="上下文内容"
      className={styles.textarea}
    />
  </TabsContent>
  <TabsContent className={`${styles.tabContent} ${styles.previewScroll}`} value="preview">
    <div
      className={`markdown-body ${styles.previewBody}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  </TabsContent>
</Tabs>
```

- [ ] **Step 4: 写入可伸缩编辑器样式**

```css
/* /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/ContextEditor/index.module.css */
.editor {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--space-md);
}

.header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}

.backBtn {
  color: var(--primary-text);
}

.meta,
.encryptRow,
.encryptLabel {
  display: flex;
  align-items: center;
}

.meta,
.encryptRow {
  gap: var(--space-sm);
}

.encryptRow {
  justify-content: space-between;
}

.encryptLabel {
  gap: var(--space-xs);
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.encryptActive {
  color: var(--primary-text);
}

.typeTag,
.saveStatus {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.typeTag {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-secondary);
}

.titleInput {
  flex: none;
  font-size: var(--font-lg);
  font-weight: 600;
}

.tabs {
  min-height: 0;
  flex: 1;
}

.tabContent {
  min-height: 0;
  overflow: hidden;
}

.textarea {
  width: 100%;
  height: 100%;
  min-height: 280px;
  resize: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-md);
  line-height: 1.7;
}

.previewScroll {
  overflow-y: auto;
  overscroll-behavior: contain;
}

.previewBody {
  min-height: 100%;
  padding: var(--space-md);
}

@media (max-width: 767px) {
  .header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .backBtn {
    min-height: 44px;
  }

  .meta {
    min-height: 44px;
  }

  .textarea {
    min-height: 220px;
    font-size: var(--font-lg);
  }
}
```

- [ ] **Step 5: 运行编辑器与列表测试并确认 GREEN**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm exec vitest run \
  src/entrypoints/home/components/ContextEditor/__tests__/ContextEditor.test.tsx \
  src/entrypoints/home/components/ContextList/__tests__/ContextList.test.tsx
```

Expected: 两个测试文件全部通过，控制台无 act warning 或无障碍错误。

- [ ] **Step 6: 提交列表与编辑器改造**

```bash
# /Users/vicohu/project/open-source/octane
git add \
  src/entrypoints/home/components/ContextList \
  src/entrypoints/home/components/ContextEditor
git commit -m "feat(home): align context drawer with home layout"
```

### Task 6: 全量验证与真实浏览器验收

**Files:**
- Modify only if verification exposes an in-scope defect.

- [ ] **Step 1: 执行静态检查和完整测试**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm run typecheck
pnpm run test
```

Expected: 两条命令退出码均为 0，测试 0 failed。

- [ ] **Step 2: 启动 Home 开发环境**

Run:

```bash
# /Users/vicohu/project/open-source/octane
pnpm dev
```

Expected: WXT 启动 Chromium 扩展开发环境；记录 Home 页可访问 URL。若默认端口被占用，使用 WXT 输出的实际端口。

- [ ] **Step 3: 用真实浏览器检查响应式布局**

在以下视口打开包含上下文的书签并进入编辑态：

- `1440 × 900`：右侧 Sheet 宽 1000px，背景、标题、列表和编辑器与 Home 对齐。
- `900 × 900`：Sheet 铺满视口，无横向滚动或裁切。
- `768 × 900`：仍使用右侧 Sheet。
- `390 × 844`：从底部进入 100dvh Drawer，关闭/返回触控目标至少 44px，底部安全区正常。
- `375 × 667`：标题、保存状态、Tabs 和正文不重叠，编辑区可滚动。

使用 Playwright 截图和 DOM 尺寸断言确认：桌面 `dialog.width <= 1000` 且宽视口时等于 1000；移动端 `dialog.height === viewport height`；页面无水平溢出。

- [ ] **Step 4: 检查交互与可访问性**

- 键盘 Tab 顺序与视觉顺序一致，Escape 可关闭。
- 列表项 Enter/Space 进入编辑态，删除按钮只打开确认框。
- 编辑/预览切换、加密开关、自动保存状态和返回列表保持工作。
- 动画遵循现有 shadcn overlay 时长；系统 `prefers-reduced-motion` 下无额外自定义动画。
- 移动端相邻触控目标间距不少于 8px，关键触控目标至少 44px。

- [ ] **Step 5: 最终差异检查**

Run:

```bash
# /Users/vicohu/project/open-source/octane
git diff --check
git status --short
```

Expected: `git diff --check` 无输出；工作区只包含本计划范围内的预期文件。
