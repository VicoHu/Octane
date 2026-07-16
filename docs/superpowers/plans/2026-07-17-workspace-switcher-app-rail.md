# Workspace Switcher App Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将桌面端工作区显示、切换与新建入口迁移到 app-rail，同时保留移动端 Sidebar 回退入口。

**Architecture:** 新增 `AppRail` 组件直接订阅 `useWorkspace` 并渲染工作区按钮；提取 `WorkspaceCreateButton` 复用新建表单。Sidebar 仅通过响应式区块保留移动端 Select，原有 store、PinnedArea 与分类数据流不变。

**Tech Stack:** React 19、TypeScript、Zustand、shadcn/ui Base UI、Lucide、CSS、Vitest、Testing Library、user-event。

---

## 文件结构

- 创建 `src/entrypoints/home/components/WorkspaceCreateButton/index.tsx`：共享新建工作区按钮与 Dialog。
- 创建 `src/entrypoints/home/components/WorkspaceCreateButton/__tests__/index.test.tsx`：验证新建工作区用户链路。
- 创建 `src/entrypoints/home/components/AppRail/index.tsx`：桌面 rail、工作区直接切换、分隔线与预留导航。
- 创建 `src/entrypoints/home/components/AppRail/__tests__/index.test.tsx`：验证切换、当前状态、Tooltip 与结构。
- 创建 `src/entrypoints/home/components/AppRail/__tests__/styles.test.ts`：验证滚动、Logo/Avatar 锚点与移动端回退样式契约。
- 修改 `src/entrypoints/home/App.tsx`：挂载 `AppRail`，保留移动端菜单。
- 修改 `src/entrypoints/home/App.css`：加入工作区 rail 布局与滚动样式。
- 修改 `src/entrypoints/home/components/Sidebar/index.tsx`：移除桌面工作区创建逻辑，复用共享控件并包裹移动端区块。
- 修改 `src/entrypoints/home/components/Sidebar/index.module.css`：桌面隐藏、移动端显示工作区区块。
- 修改 `src/entrypoints/home/__tests__/App.broadcast.test.tsx`：将新增 `AppRail` 作为已独立覆盖的装配子组件隔离。
- 修改 `TODOS.md`：记录 app-rail 移动端展示待办。

## Task 1: 提取共享新建工作区控件

**Files:**
- Create: `src/entrypoints/home/components/WorkspaceCreateButton/__tests__/index.test.tsx`
- Create: `src/entrypoints/home/components/WorkspaceCreateButton/index.tsx`

- [ ] **Step 1: 写新建工作区失败测试**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/WorkspaceCreateButton/__tests__/index.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkspace } from '@/store/useWorkspace';
import { WorkspaceCreateButton } from '../index';

const createWorkspace = vi.fn(async () => undefined);

beforeEach(() => {
  createWorkspace.mockClear();
  useWorkspace.setState({ createWorkspace });
});

describe('WorkspaceCreateButton — 新建工作区', () => {
  it('填写名称并确认 → 使用默认图标创建并关闭弹窗', async () => {
    const user = userEvent.setup();
    render(<WorkspaceCreateButton />);

    await user.click(screen.getByRole('button', { name: '新建工作区' }));
    await user.type(screen.getByPlaceholderText('工作区名称'), '研究');
    await user.click(screen.getByRole('button', { name: '确定' }));

    expect(createWorkspace).toHaveBeenCalledWith('研究', '📁');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: 运行测试并确认因组件不存在而失败**

Run: `pnpm exec vitest run src/entrypoints/home/components/WorkspaceCreateButton/__tests__/index.test.tsx`

Expected: FAIL，错误包含无法解析 `../index` 或缺少 `WorkspaceCreateButton`。

- [ ] **Step 3: 写最小共享控件实现**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/WorkspaceCreateButton/index.tsx
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { IconPicker } from '@/components/IconPicker';
import { useWorkspace } from '@/store/useWorkspace';

interface WorkspaceCreateButtonProps {
  className?: string;
}

export function WorkspaceCreateButton({ className }: WorkspaceCreateButtonProps) {
  const createWorkspace = useWorkspace((state) => state.createWorkspace);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');

  const handleCreate = async () => {
    if (!name.trim()) return;
    await createWorkspace(name.trim(), icon);
    setName('');
    setIcon('📁');
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={className}
        aria-label="新建工作区"
        onClick={() => setOpen(true)}
      >
        <Plus />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建工作区</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="工作区名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
            }}
          />
          <div style={{ marginTop: 12 }}>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleCreate}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `pnpm exec vitest run src/entrypoints/home/components/WorkspaceCreateButton/__tests__/index.test.tsx`

Expected: PASS，1 test passed。

- [ ] **Step 5: 提交共享控件**

```bash
# /Users/vicohu/project/open-source/octane
git add src/entrypoints/home/components/WorkspaceCreateButton
git commit -m "refactor(home): extract workspace create control"
```

## Task 2: 实现 AppRail 工作区直接切换

**Files:**
- Create: `src/entrypoints/home/components/AppRail/__tests__/index.test.tsx`
- Create: `src/entrypoints/home/components/AppRail/index.tsx`

- [ ] **Step 1: 写工作区切换与可访问性失败测试**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/AppRail/__tests__/index.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkspace } from '@/store/useWorkspace';
import { AppRail } from '../index';

const selectWorkspace = vi.fn(async () => undefined);

beforeEach(() => {
  selectWorkspace.mockClear();
  useWorkspace.setState({
    workspaces: [
      { id: 'w1', name: '主工作区', icon: '📁', createdAt: 0, order: 0 },
      { id: 'w2', name: '研究', icon: '🔬', createdAt: 0, order: 1 },
    ],
    currentWorkspaceId: 'w1',
    selectWorkspace,
  });
});

describe('AppRail — 工作区切换', () => {
  it('渲染全部工作区 → 当前项具有按下状态并显示分隔线', () => {
    render(<AppRail />);

    expect(screen.getByRole('button', { name: '切换到工作区 主工作区' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '切换到工作区 研究' }))
      .toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('点击其他工作区 → 调用现有切换 action', async () => {
    const user = userEvent.setup();
    render(<AppRail />);

    await user.click(screen.getByRole('button', { name: '切换到工作区 研究' }));

    expect(selectWorkspace).toHaveBeenCalledWith('w2');
  });

  it('悬停工作区 → 显示工作区名称 Tooltip', async () => {
    const user = userEvent.setup();
    render(<AppRail />);

    await user.hover(screen.getByRole('button', { name: '切换到工作区 主工作区' }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('主工作区');
  });
});
```

- [ ] **Step 2: 运行测试并确认因 AppRail 不存在而失败**

Run: `pnpm exec vitest run src/entrypoints/home/components/AppRail/__tests__/index.test.tsx`

Expected: FAIL，错误包含无法解析 `../index` 或缺少 `AppRail`。

- [ ] **Step 3: 写最小 AppRail 实现**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/AppRail/index.tsx
import { ExternalLink, Home, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/store/useWorkspace';
import { WorkspaceCreateButton } from '../WorkspaceCreateButton';

export function AppRail() {
  const workspaces = useWorkspace((state) => state.workspaces);
  const currentWorkspaceId = useWorkspace((state) => state.currentWorkspaceId);
  const selectWorkspace = useWorkspace((state) => state.selectWorkspace);

  return (
    <aside className="app-rail dark" aria-label="主导航">
      <img className="app-rail-logo" src="/icons/icon-128.png" alt="Octane" />
      <TooltipProvider>
        <div className="app-rail-workspaces">
          <div className="app-rail-workspace-list" aria-label="工作区">
            {workspaces.map((workspace) => {
              const current = workspace.id === currentWorkspaceId;
              return (
                <Tooltip key={workspace.id}>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn('app-rail-button app-rail-workspace-button', current && 'is-current')}
                        aria-label={`切换到工作区 ${workspace.name}`}
                        aria-pressed={current}
                        onClick={() => void selectWorkspace(workspace.id)}
                      />
                    }
                  >
                    <span className="app-rail-workspace-icon" aria-hidden="true">{workspace.icon}</span>
                  </TooltipTrigger>
                  <TooltipContent side="right">{workspace.name}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <WorkspaceCreateButton className="app-rail-button app-rail-workspace-create" />
        </div>
        <Separator className="app-rail-separator" />
        <div className="app-rail-group">
          <Button variant="ghost" size="icon" className="app-rail-button is-active" aria-label="主页">
            <Home />
          </Button>
          <Button variant="ghost" size="icon" className="app-rail-button" aria-label="搜索">
            <Search />
          </Button>
          <Button variant="ghost" size="icon" className="app-rail-button" aria-label="打开标签页">
            <ExternalLink />
          </Button>
        </div>
      </TooltipProvider>
      <div className="app-rail-spacer" />
      <div className="app-rail-avatar" aria-hidden="true" />
    </aside>
  );
}
```

- [ ] **Step 4: 运行定向测试并确认通过**

Run: `pnpm exec vitest run src/entrypoints/home/components/AppRail/__tests__/index.test.tsx`

Expected: PASS，3 tests passed。

- [ ] **Step 5: 提交 AppRail 行为**

```bash
# /Users/vicohu/project/open-source/octane
git add src/entrypoints/home/components/AppRail
git commit -m "feat(home): add workspace switcher to app rail"
```

## Task 3: 落实 rail 滚动与响应式样式

**Files:**
- Create: `src/entrypoints/home/components/AppRail/__tests__/styles.test.ts`
- Modify: `src/entrypoints/home/App.css`
- Modify: `src/entrypoints/home/components/Sidebar/index.module.css`

- [ ] **Step 1: 写样式契约失败测试**

```ts
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/AppRail/__tests__/styles.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(resolve(process.cwd(), 'src/entrypoints/home/App.css'), 'utf8');
const sidebarCss = readFileSync(
  resolve(process.cwd(), 'src/entrypoints/home/components/Sidebar/index.module.css'),
  'utf8',
);

describe('AppRail 工作区布局样式', () => {
  it('工作区列表独立滚动，Logo 与 Avatar 尺寸保持不变', () => {
    expect(appCss).toMatch(/\.app-rail-workspace-list\s*\{[^}]*overflow-y:\s*auto/s);
    expect(appCss).toMatch(/\.app-rail-logo\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px/s);
    expect(appCss).toMatch(/\.app-rail-avatar\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px/s);
  });

  it('Sidebar 工作区区块默认隐藏，在移动端恢复显示', () => {
    expect(sidebarCss).toMatch(/\.workspaceSection\s*\{[^}]*display:\s*none/s);
    expect(sidebarCss).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*\.workspaceSection\s*\{[^}]*display:\s*flex/s);
  });
});
```

- [ ] **Step 2: 运行样式测试并确认因规则缺失而失败**

Run: `pnpm exec vitest run src/entrypoints/home/components/AppRail/__tests__/styles.test.ts`

Expected: FAIL，缺少 `.app-rail-workspace-list` 或 `.workspaceSection` 规则。

- [ ] **Step 3: 在 App.css 增加工作区布局并调整导航组间距**

```css
/* /Users/vicohu/project/open-source/octane/src/entrypoints/home/App.css */
.app-rail-workspaces {
  display: flex;
  flex: 0 1 auto;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-top: 30px;
}

.app-rail-workspace-list {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  scrollbar-width: none;
}

.app-rail-workspace-list::-webkit-scrollbar { display: none; }

.app-rail-workspace-button { position: relative; flex-shrink: 0; }
.app-rail-workspace-button.is-current { background: var(--neutral); }
.app-rail-workspace-button.is-current::before {
  content: '';
  position: absolute;
  left: -11px;
  width: 3px;
  height: 24px;
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--primary);
}
.app-rail-workspace-icon { font-size: 18px; line-height: 1; }
.app-rail-workspace-create { flex-shrink: 0; }
.app-rail-separator {
  width: 32px;
  margin: 14px 0;
}

.app-rail-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 0;
}
```

保留原有 `.app-rail-logo`、`.app-rail-spacer`、`.app-rail-avatar` 规则，不改变尺寸或底部锚定方式。

- [ ] **Step 4: 在 Sidebar CSS 增加移动端回退规则**

```css
/* /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/Sidebar/index.module.css */
.workspaceSection {
  display: none;
}

@media (max-width: 760px) {
  .workspaceSection {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
}
```

同时删除因结构变化而不再生效的 `.header + .sectionLabel { display: none; }`。

- [ ] **Step 5: 运行样式与 AppRail 测试**

Run: `pnpm exec vitest run src/entrypoints/home/components/AppRail/__tests__/styles.test.ts src/entrypoints/home/components/AppRail/__tests__/index.test.tsx`

Expected: PASS，5 tests passed。

- [ ] **Step 6: 提交样式**

```bash
# /Users/vicohu/project/open-source/octane
git add src/entrypoints/home/App.css src/entrypoints/home/components/Sidebar/index.module.css src/entrypoints/home/components/AppRail/__tests__/styles.test.ts
git commit -m "style(home): lay out workspace rail groups"
```

## Task 4: 集成 AppRail 与移动端 Sidebar 回退

**Files:**
- Modify: `src/entrypoints/home/App.tsx`
- Modify: `src/entrypoints/home/components/Sidebar/index.tsx`
- Modify: `src/entrypoints/home/__tests__/App.broadcast.test.tsx`

- [ ] **Step 1: 更新 App 装配测试，加入 AppRail 隔离桩**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/__tests__/App.broadcast.test.tsx
vi.mock('../components/AppRail', () => ({ AppRail: () => null }));
```

将该行放在现有 Sidebar 与 Content mock 附近。`AppRail` 已有独立行为测试，此处只验证 App 的广播与 openTabs 装配。

- [ ] **Step 2: 在 App.tsx 挂载 AppRail**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/App.tsx
import { Menu, X } from 'lucide-react';
import { AppRail } from './components/AppRail';

return (
  <>
    <UnlockModal />
    <div className="app-frame">
      <div className="app-layout">
        <AppRail />
        <aside className={`app-sidebar${mobileNavOpen ? ' is-mobile-open' : ''}`} id="sidebar-container">
          <div className="app-sidebar-mobile-header">
            <span>导航</span>
            <Button variant="ghost" size="icon-sm" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}>
              <X />
            </Button>
          </div>
          <Sidebar openTabs={openTabs} />
        </aside>
        {mobileNavOpen && (
          <button className="app-mobile-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />
        )}
        <main className="app-content" data-mobile-nav-open={mobileNavOpen}>
          <Button
            variant="outline"
            size="icon"
            className="app-mobile-menu"
            aria-label="打开导航"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu />
          </Button>
          <Content openTabs={openTabs} />
        </main>
      </div>
    </div>
  </>
);
```

删除 `App.tsx` 不再使用的 `Home`、`Search`、`ExternalLink` import；Logo、导航和 Avatar 的标记已原样迁入 `AppRail`。

- [ ] **Step 3: 将 Sidebar 工作区区块改为移动端回退并复用创建控件**

```tsx
// /Users/vicohu/project/open-source/octane/src/entrypoints/home/components/Sidebar/index.tsx
import { WorkspaceCreateButton } from '../WorkspaceCreateButton';

<div className={styles.workspaceSection}>
  <div className={styles.sectionLabel}>工作区</div>
  <div className={styles.workspaceSelect}>
    <Select value={currentWorkspaceId} onValueChange={(value) => value && selectWorkspace(value)}>
      <SelectTrigger className={styles.select}>
        <SelectValue>
          {(value: string | null) => {
            const workspace = workspaces.find((item) => item.id === value);
            if (!workspace) return '选择工作区';
            return (
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true">{workspace.icon}</span>
                <span className="truncate">{workspace.name}</span>
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              {workspace.icon} {workspace.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
    <WorkspaceCreateButton />
  </div>
</div>
```

删除 Sidebar 中已迁移到共享控件的 `createWorkspace` selector、`showNewWorkspace`、`newWorkspaceName`、`newWorkspaceIcon`、`handleCreateWorkspace` 与对应 Dialog。保留 `IconPicker`，因为新建分类仍使用。

- [ ] **Step 4: 运行集成相关测试**

Run: `pnpm exec vitest run src/entrypoints/home/components/AppRail/__tests__ src/entrypoints/home/components/WorkspaceCreateButton/__tests__ src/entrypoints/home/components/Sidebar/__tests__/workspace-select.test.tsx src/entrypoints/home/__tests__/App.broadcast.test.tsx`

Expected: PASS，AppRail、共享新建控件、Sidebar 回退与 App 装配测试全部通过。

- [ ] **Step 5: 提交集成**

```bash
# /Users/vicohu/project/open-source/octane
git add src/entrypoints/home/App.tsx src/entrypoints/home/components/Sidebar/index.tsx src/entrypoints/home/__tests__/App.broadcast.test.tsx
git commit -m "feat(home): integrate workspace app rail"
```

## Task 5: 记录移动端后续项并完成验证

**Files:**
- Modify: `TODOS.md`

- [ ] **Step 1: 在 TODOS.md 追加已确认待办**

```markdown
<!-- /Users/vicohu/project/open-source/octane/TODOS.md -->
## App Rail 移动端适配

- **移动端展示方案**：当前 `<=760px` 隐藏 app-rail，并在 Sidebar 保留工作区 Select 与新建入口。后续需设计 app-rail 在移动端的展示、展开与触控交互，再移除该回退入口。相关：`src/entrypoints/home/components/AppRail`、`src/entrypoints/home/components/Sidebar`、`src/entrypoints/home/App.css`。
```

- [ ] **Step 2: 运行格式与变更检查**

Run: `git diff --check`

Expected: exit 0，无空白错误。

- [ ] **Step 3: 运行 TypeScript 全量验证**

Run: `pnpm run typecheck`

Expected: exit 0。

- [ ] **Step 4: 运行全量测试**

Run: `pnpm run test`

Expected: exit 0，0 failed。

- [ ] **Step 5: 检查需求覆盖与工作区状态**

Run: `git diff HEAD~4 --stat && git status --short`

Expected: 变更仅涉及本计划列出的 app-rail、Sidebar、测试和 `TODOS.md`；无意外文件。

- [ ] **Step 6: 提交 TODO 与验证收尾**

```bash
# /Users/vicohu/project/open-source/octane
git add TODOS.md
git commit -m "docs: track mobile app rail follow-up"
```

## 真机视觉验收

自动化验证完成后不使用 Playwright。用户在真机检查并提供截图，重点确认：

- Logo 与 Avatar 的尺寸和位置未变化。
- 工作区列表、`+`、Separator、导航组无重叠。
- 多工作区时列表可独立滚动，固定元素不移动。
- 桌面 Sidebar 不再显示工作区 Select。
- 移动端 Sidebar 仍可切换和新建工作区。

截图确认前只报告自动化验证结果，不宣称视觉验收完成。
