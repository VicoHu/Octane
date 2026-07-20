# tab 视图「存为常驻标签」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 home「标签页」视图每个 tab 卡片新增「存为常驻标签」按钮,点按弹 Modal(预填 tab.url + tab.title),确定后存入当前工作区的 `PinnedTab`。

**Architecture:** 提取共享 `AddPinnedTabDialog`(从 `PinnedArea` 内联 Modal 抽出,`PinnedArea` 与 `Content` 复用);导出 `normalizePinnedTabUrl` 供 `TabList` 前置 dedup;`TabList`/`TabCard` 加常驻按钮 + dedup/cap 前置;`Content` 接线 `usePinnedTabs` + Dialog。

**Tech Stack:** React 19 + TypeScript + WXT + shadcn/ui(Base UI `Dialog`)+ zustand(`usePinnedTabs`)+ vitest + @testing-library/react + fake-indexeddb。

## Global Constraints

- 强制中文:UI 文案、代码注释、测试描述、commit message 均中文。
- 测试遵循 `docs/standards/testing.md`:真实渲染 `@/components/ui/*` 与被测组件,只 mock 副作用边界(`PinnedTabService`/`useFavicon`/`Toast`);query 用 `getByRole`/`getByText`/`getByPlaceholderText`,交互用 `userEvent`,断言用 jest-dom matcher(禁 `.toBeTruthy()`)。
- 提交前 `pnpm run typecheck` + `pnpm run test` 双绿(husky pre-push 强制 typecheck + test;pre-commit 强制 lint)。
- 外科手术:只改本计划列出的文件,不顺手优化相邻代码。
- 既有约束不变:`PINNED_TAB_CAP = 8`、`BACKUP_VERSION = 4`、service 层 scheme/dedup/cap 逻辑不动。
- 单文件测试命令:`pnpm vitest run <path>`(如 `pnpm vitest run src/services/__tests__/PinnedTabService.test.ts`)。

---

## File Structure

- `src/services/PinnedTabService.ts` —— 私有 `normalizeUrl` 重命名为 `export normalizePinnedTabUrl`(dedup 真源单一),内部调用点同步改名。
- `src/entrypoints/home/components/AddPinnedTabDialog/index.tsx` —— **新建**共享 Modal 组件(受控)。
- `src/entrypoints/home/components/AddPinnedTabDialog/index.module.css` —— **新建**(`modalForm`/`previewRow` 从 PinnedArea 迁入)。
- `src/entrypoints/home/components/AddPinnedTabDialog/__tests__/index.test.tsx` —— **新建**测试。
- `src/entrypoints/home/components/PinnedArea/index.tsx` —— 重构:移除内联 Modal,改用 `AddPinnedTabDialog`(行为不变)。
- `src/entrypoints/home/components/PinnedArea/index.module.css` —— 移除 `modalForm`/`previewRow`(已迁出)。
- `src/entrypoints/home/components/TabList/index.tsx` —— props 加 `pinnedTabs`/`onPinTab`;`TabCard` 加常驻按钮 + dedup/cap。
- `src/entrypoints/home/components/TabList/__tests__/index.test.tsx` —— 所有 render 补新 props + 新增常驻 describe。
- `src/entrypoints/home/components/Content/index.tsx` —— 接线 `usePinnedTabs` + `AddPinnedTabDialog` + `openPinForTab`。
- `src/entrypoints/home/components/Content/__tests__/Content.test.tsx` —— mock `usePinnedTabs`/`useFavicon` + 新增接线测试。

---

## Task 1: 导出 `normalizePinnedTabUrl`

**Files:**
- Modify: `src/services/PinnedTabService.ts`(normalizeUrl 定义 + createPinnedTab 内 2 处调用)
- Test: `src/services/__tests__/PinnedTabService.test.ts`

**Interfaces:**
- Produces: `export function normalizePinnedTabUrl(raw: string): string`(小写 protocol+host、pathname 缺省补 `/`、保留 query、去 hash;非法 URL 回退原串)。Task 4 的 `TabList` 依赖此签名。

- [ ] **Step 1: 写失败测试**

在 `src/services/__tests__/PinnedTabService.test.ts` 末尾(`describe('PinnedTabService')` 外层之内或之后均可)新增:

```ts
  describe('normalizePinnedTabUrl', () => {
    it('小写 protocol+host、补 pathname、保留 query、去 hash', () => {
      expect(PinnedTabService.normalizePinnedTabUrl('HTTPS://GitHub.com/foo?a=1#top'))
        .toBe('https://github.com/foo?a=1');
      expect(PinnedTabService.normalizePinnedTabUrl('https://a.com'))
        .toBe('https://a.com/');
    });

    it('非法 URL 回退原串', () => {
      expect(PinnedTabService.normalizePinnedTabUrl('not-a-url')).toBe('not-a-url');
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/services/__tests__/PinnedTabService.test.ts -t normalizePinnedTabUrl`
Expected: FAIL(`PinnedTabService.normalizePinnedTabUrl is not a function`)

- [ ] **Step 3: 重命名并导出**

在 `src/services/PinnedTabService.ts`:

把
```ts
function normalizeUrl(raw: string): string {
```
改为
```ts
export function normalizePinnedTabUrl(raw: string): string {
```

把 `createPinnedTab` 内两处调用:
```ts
    const targetUrl = normalizeUrl(data.url);
    if (existing.some((p) => normalizeUrl(p.url) === targetUrl)) {
```
改为
```ts
    const targetUrl = normalizePinnedTabUrl(data.url);
    if (existing.some((p) => normalizePinnedTabUrl(p.url) === targetUrl)) {
```

同步更新函数上方注释里的 "normalizeUrl" 字样为 "normalizePinnedTabUrl"(如有)。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/services/__tests__/PinnedTabService.test.ts`
Expected: PASS(新增 2 例 + 既有 createPinnedTab/reorder 全绿)

- [ ] **Step 5: 提交**

```bash
git add src/services/PinnedTabService.ts src/services/__tests__/PinnedTabService.test.ts
git commit -m "refactor: 导出 normalizePinnedTabUrl 供前置 dedup 复用"
```

---

## Task 2: 新建共享组件 `AddPinnedTabDialog`

**Files:**
- Create: `src/entrypoints/home/components/AddPinnedTabDialog/index.tsx`
- Create: `src/entrypoints/home/components/AddPinnedTabDialog/index.module.css`
- Test: `src/entrypoints/home/components/AddPinnedTabDialog/__tests__/index.test.tsx`

**Interfaces:**
- Consumes: `usePinnedTabs`(`pinnedTabs` / `createPinnedTab`)、`PINNED_TAB_CAP`(from Task 1 的 PinnedTabService)、`BookmarkFaviconPreview`。
- Produces: `AddPinnedTabDialog` 组件,props:
  ```ts
  {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: string;
    initialUrl?: string;   // 默认 ''
    initialName?: string;  // 默认 ''
    onCreated?: (pin: PinnedTab) => void;
  }
  ```
  Task 3(PinnedArea)与 Task 5(Content)依赖此组件。

- [ ] **Step 1: 写失败测试**

创建 `src/entrypoints/home/components/AddPinnedTabDialog/__tests__/index.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toast } from '@/components/ui/toast';

// 副作用边界 mock:service(DB) + favicon hook(DB) + Toast
vi.mock('@/services/PinnedTabService', () => ({
  listByWorkspace: vi.fn(async () => [] as never[]),
  createPinnedTab: vi.fn(async (_ws: string, data: { name: string; url: string }) =>
    ({ id: 'new-pin', workspaceId: _ws, name: data.name, url: data.url, order: 99, createdAt: 0 } as never),
  ),
  deletePinnedTab: vi.fn(async () => undefined),
  reorderPinnedTabs: vi.fn(async () => undefined),
  normalizePinnedTabUrl: vi.fn((raw: string) => raw),
  PINNED_TAB_CAP: 8,
}));
vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => ({ kind: 'third-party', src: 'blob:test', onError: vi.fn() })),
}));
vi.mock('@/components/ui/toast', () => ({
  Toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), close: vi.fn() },
}));

import { AddPinnedTabDialog } from '../index';
import * as PinnedTabService from '@/services/PinnedTabService';
import { usePinnedTabs } from '@/store/usePinnedTabs';

beforeEach(() => {
  vi.clearAllMocks();
  usePinnedTabs.setState({ pinnedTabs: [], loading: false });
});

describe('AddPinnedTabDialog', () => {
  it('open=true 且传 initialUrl/initialName → 输入框预填', () => {
    render(
      <AddPinnedTabDialog
        open onOpenChange={() => {}} workspaceId="ws-1"
        initialUrl="https://github.com" initialName="GitHub"
      />,
    );
    expect(screen.getByPlaceholderText(/url|链接/i)).toHaveValue('https://github.com');
    expect(screen.getByPlaceholderText(/名称/)).toHaveValue('GitHub');
  });

  it('填表点确定 → createPinnedTab(workspaceId, {name,url}) + Toast.success', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AddPinnedTabDialog
        open onOpenChange={onOpenChange} workspaceId="ws-1"
        initialUrl="https://chat.openai.com" initialName="ChatGPT" onCreated={onCreated}
      />,
    );
    await user.click(screen.getByRole('button', { name: /确定/i }));

    await waitFor(() => {
      expect(PinnedTabService.createPinnedTab).toHaveBeenCalledWith('ws-1', {
        name: 'ChatGPT', url: 'https://chat.openai.com',
      });
    });
    expect(Toast.success).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('createPinnedTab 失败 → Toast.warning 且不关闭', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    vi.mocked(PinnedTabService.createPinnedTab).mockRejectedValueOnce(new Error('该 URL 已是该工作区的常驻标签'));
    render(
      <AddPinnedTabDialog
        open onOpenChange={onOpenChange} workspaceId="ws-1"
        initialUrl="https://x.com" initialName="X"
      />,
    );
    await user.click(screen.getByRole('button', { name: /确定/i }));

    await waitFor(() => expect(Toast.warning).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('atCap(pinnedTabs.length>=8) → 确定按钮 disabled', () => {
    usePinnedTabs.setState({
      pinnedTabs: Array.from({ length: 8 }, (_, i) =>
        ({ id: `p${i}`, workspaceId: 'ws-1', name: `T${i}`, url: `https://t${i}.com`, order: i, createdAt: 0 })),
      loading: false,
    });
    render(<AddPinnedTabDialog open onOpenChange={() => {}} workspaceId="ws-1" />);
    expect(screen.getByRole('button', { name: /确定/i })).toBeDisabled();
  });

  it('open 由 false→true → 用最新 initialUrl/initialName 重置(防上次残留)', () => {
    const { rerender } = render(
      <AddPinnedTabDialog open={false} onOpenChange={() => {}} workspaceId="ws-1"
        initialUrl="https://a.com" initialName="A" />,
    );
    // 打开时换成 B:输入框应为 B 而非 A
    rerender(
      <AddPinnedTabDialog open onOpenChange={() => {}} workspaceId="ws-1"
        initialUrl="https://b.com" initialName="B" />,
    );
    expect(screen.getByPlaceholderText(/url|链接/i)).toHaveValue('https://b.com');
    expect(screen.getByPlaceholderText(/名称/)).toHaveValue('B');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/entrypoints/home/components/AddPinnedTabDialog/__tests__/index.test.tsx`
Expected: FAIL(组件文件不存在,import 解析失败)

- [ ] **Step 3: 创建样式文件**

创建 `src/entrypoints/home/components/AddPinnedTabDialog/index.module.css`:

```css
.modalForm {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.previewRow {
  margin-top: var(--space-xs);
}
```

- [ ] **Step 4: 实现组件**

创建 `src/entrypoints/home/components/AddPinnedTabDialog/index.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { BookmarkFaviconPreview } from '@/components/BookmarkFaviconPreview';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { PINNED_TAB_CAP } from '@/services/PinnedTabService';
import type { PinnedTab } from '@/shared/types';
import styles from './index.module.css';

interface AddPinnedTabDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** 预填 URL(tab 入口传 tab.url;PinnedArea 入口传空串) */
  initialUrl?: string;
  /** 预填名称(tab 入口传 tab.title;PinnedArea 入口传空串) */
  initialName?: string;
  /** 创建成功回调(可选) */
  onCreated?: (pin: PinnedTab) => void;
}

/**
 * 添加常驻标签 Modal(共享组件)。
 *
 * PinnedArea 的「+」入口与 home 标签页视图的「存为常驻标签」入口共用。
 * - 预填:open 由 false→true 时一次性写入 initialUrl/initialName(只依赖 open,
 *   避免开着手 initialUrl 变化误触);Dialog 模态,打开期间背后点不到其他 tab。
 * - atCap(>=PINNED_TAB_CAP):确定按钮 disabled(兜底;主入口应已在调用前拦截)。
 * - 失败(dedup/cap/scheme):Toast.warning,不关闭,让用户改后重试。
 */
export function AddPinnedTabDialog({
  open,
  onOpenChange,
  workspaceId,
  initialUrl = '',
  initialName = '',
  onCreated,
}: AddPinnedTabDialogProps) {
  const pinnedTabs = usePinnedTabs((s) => s.pinnedTabs);
  const createPinnedTab = usePinnedTabs((s) => s.createPinnedTab);
  const [url, setUrl] = useState(initialUrl);
  const [name, setName] = useState(initialName);

  // open 翻为 true 时一次性预填;依赖 [open] 以避免开着手 initialUrl 变化误触
  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setName(initialName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const atCap = pinnedTabs.length >= PINNED_TAB_CAP;

  const handleCreate = async () => {
    const u = url.trim();
    const n = name.trim();
    if (!u || !n) return;
    try {
      const pin = await createPinnedTab(workspaceId, { url: u, name: n });
      Toast.success(`已常驻「${n}」`);
      onCreated?.(pin);
      onOpenChange(false);
    } catch (e) {
      // cap/dedup/scheme 错误:Toast 提示,不关闭(让用户改后重试)
      Toast.warning((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加常驻标签</DialogTitle>
        </DialogHeader>
        <div className={styles.modalForm}>
          <Input placeholder="链接 URL" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="常驻标签 URL" />
          <Input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} aria-label="常驻标签名称" />
          <div className={styles.previewRow}>
            <BookmarkFaviconPreview url={url} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="default" disabled={atCap} onClick={handleCreate}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run src/entrypoints/home/components/AddPinnedTabDialog/__tests__/index.test.tsx`
Expected: PASS(5 例全绿)

- [ ] **Step 6: 提交**

```bash
git add src/entrypoints/home/components/AddPinnedTabDialog
git commit -m "feat: 新建共享 AddPinnedTabDialog 组件"
```

---

## Task 3: 重构 `PinnedArea` 改用 `AddPinnedTabDialog`

**Files:**
- Modify: `src/entrypoints/home/components/PinnedArea/index.tsx`
- Modify: `src/entrypoints/home/components/PinnedArea/index.module.css`(移除 modalForm/previewRow)

**Interfaces:**
- Consumes: `AddPinnedTabDialog`(Task 2)。
- Produces: 行为不变的 `PinnedArea`(回归测试保绿,硬指标)。

- [ ] **Step 1: 先跑回归基线(确认当前绿)**

Run: `pnpm vitest run src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx`
Expected: PASS(重构前的绿基线)

- [ ] **Step 2: 重构组件**

在 `src/entrypoints/home/components/PinnedArea/index.tsx`:

(a) 删除不再需要的 import(`Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter`/`Input`/`BookmarkFaviconPreview`),新增:
```ts
import { AddPinnedTabDialog } from '../AddPinnedTabDialog';
```

(b) 把内联 Modal state:
```ts
  const [modalOpen, setModalOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
```
替换为:
```ts
  const [addOpen, setAddOpen] = useState(false);
```

(c) `handleAddClick` 改为(去掉 setUrl/setName):
```ts
  const handleAddClick = () => {
    if (atCap) {
      Toast.warning(`该工作区常驻标签已满 (${PINNED_TAB_CAP}/${PINNED_TAB_CAP})`);
      return;
    }
    setAddOpen(true);
  };
```

(d) 删除整个 `handleCreate` 函数。

(e) 删除 JSX 里的 `<Dialog>...</Dialog>` 整块,在 `chipRow` 的 `</div>` 之后(return 内最末、`</div>` 闭合 area 之前)插入:
```tsx
      <AddPinnedTabDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        workspaceId={workspaceId}
        initialUrl=""
        initialName=""
      />
```

- [ ] **Step 3: 迁出样式**

在 `src/entrypoints/home/components/PinnedArea/index.module.css` 删除这两个规则(已迁入 AddPinnedTabDialog):
```css
.modalForm {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.previewRow {
  margin-top: var(--space-xs);
}
```

- [ ] **Step 4: 跑回归测试**

Run: `pnpm vitest run src/entrypoints/home/components/PinnedArea/__tests__/PinnedArea.test.tsx`
Expected: PASS(行为不变,含「点击+→Modal 打开→填表→createPinnedTab」「cap 满 + disabled」「createPinnedTab 失败 → Toast.warning」等既有用例)

- [ ] **Step 5: 提交**

```bash
git add src/entrypoints/home/components/PinnedArea/index.tsx src/entrypoints/home/components/PinnedArea/index.module.css
git commit -m "refactor: PinnedArea 改用共享 AddPinnedTabDialog"
```

---

## Task 4: `TabList` 新增「存为常驻标签」按钮 + 前置 dedup/cap

**Files:**
- Modify: `src/entrypoints/home/components/TabList/index.tsx`
- Modify: `src/entrypoints/home/components/TabList/__tests__/index.test.tsx`

**Interfaces:**
- Consumes: `normalizePinnedTabUrl` + `PINNED_TAB_CAP`(Task 1)。
- Produces: `TabList` props 新增 `pinnedTabs: PinnedTab[]` 与 `onPinTab: (tab: OpenTab) => void`(Task 5 的 Content 依赖)。

- [ ] **Step 1: 更新现有测试 render 调用(补新必填 props)**

在 `src/entrypoints/home/components/TabList/__tests__/index.test.tsx`,把所有现有 `<TabList ... />` 调用补上 `pinnedTabs={[]}` 和 `onPinTab={() => {}}`。共 9 处 render,示例(第一处):
```tsx
    render(
      <TabList tabs={[tab]} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={onTabClick} onSaveTab={() => {}}
        pinnedTabs={[]} onPinTab={() => {}} />,
    );
```
其余 8 处同样在 `onSaveTab={...}` 之后追加 `pinnedTabs={[]} onPinTab={() => {}}`。

- [ ] **Step 2: 新增失败测试**

在 `index.test.tsx` 顶部 import 块加(在现有 `import type { Bookmark }` 之后):
```ts
import type { PinnedTab } from '@/shared/types';
```

在 `makeBookmark` helper 之后追加 helper:
```ts
function makePin(id: string, url: string): PinnedTab {
  return { id, workspaceId: 'ws-1', name: id, url, order: 0, createdAt: 0 };
}
```

在文件末尾(`describe` 闭合之后)新增:
```ts
describe('TabList — 存为常驻标签', () => {
  it('命中常驻标签(同规范 URL) → 按钮禁用', () => {
    const tabs = [makeTab({ tabId: 1, url: 'HTTPS://GitHub.com/foo?a=1#top', title: '示例' })];
    const pinnedTabs = [makePin('p1', 'https://github.com/foo?a=1')];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}}
        pinnedTabs={pinnedTabs} onPinTab={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /存为常驻标签|已常驻/ })).toBeDisabled();
  });

  it('未命中且未满 → 按钮可用', () => {
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com', title: '示例' })];
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}}
        pinnedTabs={[]} onPinTab={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /存为常驻标签/ })).toBeEnabled();
  });

  it('cap 满(8) → 按钮禁用', () => {
    const tabs = [makeTab({ tabId: 1, url: 'https://example.com', title: '示例' })];
    const pinnedTabs = Array.from({ length: 8 }, (_, i) => makePin(`p${i}`, `https://t${i}.com`));
    render(
      <TabList tabs={tabs} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}}
        pinnedTabs={pinnedTabs} onPinTab={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /常驻已满/ })).toBeDisabled();
  });

  it('点击启用按钮 → 调用 onPinTab(对应 tab)', async () => {
    const user = userEvent.setup();
    const onPinTab = vi.fn();
    const tab = makeTab({ tabId: 7, url: 'https://example.com', title: '示例' });
    render(
      <TabList tabs={[tab]} bookmarks={[]} currentCategoryId="cat-1"
        onTabClick={() => {}} onSaveTab={() => {}}
        pinnedTabs={[]} onPinTab={onPinTab} />,
    );
    await user.click(screen.getByRole('button', { name: /存为常驻标签/ }));
    expect(onPinTab).toHaveBeenCalledWith(tab);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run src/entrypoints/home/components/TabList/__tests__/index.test.tsx`
Expected: FAIL(`pinnedTabs`/`onPinTab` 不在 TabListProps;「存为常驻标签」按钮不存在)

- [ ] **Step 4: 实现 TabList 改动**

在 `src/entrypoints/home/components/TabList/index.tsx`:

(a) import 行:把
```ts
import { MapPin, Plus, Bookmark as BookmarkIcon } from 'lucide-react';
```
改为
```ts
import { MapPin, Plus, Bookmark as BookmarkIcon, Pin } from 'lucide-react';
```
在 `import type { Bookmark } from '@/shared/types';` 之后加:
```ts
import type { PinnedTab } from '@/shared/types';
```
在 `import { bookmarkMatchesOpenTab } from '@/shared/tabs/matchUrl';` 之后加:
```ts
import { normalizePinnedTabUrl, PINNED_TAB_CAP } from '@/services/PinnedTabService';
```

(b) `TabListProps` 接口追加两个字段:
```ts
  /** 当前工作区常驻标签(前置 dedup 数据源) */
  pinnedTabs: PinnedTab[];
  onPinTab: (tab: OpenTab) => void;
```

(c) `TabList` 组件解构参数追加 `pinnedTabs, onPinTab`,并在 `canSave` 之后加:
```ts
  const atCap = pinnedTabs.length >= PINNED_TAB_CAP;
```
`tabs.map` 内的 `<TabCard ... />` 追加 props(在 `onSave={() => onSaveTab(tab)}` 之后):
```tsx
            pinned={pinnedTabs.some((p) => normalizePinnedTabUrl(p.url) === normalizePinnedTabUrl(tab.url))}
            canPin={!atCap}
            onPin={() => onPinTab(tab)}
```

(d) `TabCardProps` 追加:
```ts
  pinned: boolean;
  canPin: boolean;
  onPin: () => void;
```

(e) `TabCard` 解构参数追加 `pinned, canPin, onPin`;在 `saveHint` 之后加:
```ts
  const pinDisabled = pinned || !canPin;
  const pinHint = pinned ? '已常驻' : canPin ? '存为常驻标签' : `常驻已满(${PINNED_TAB_CAP}/${PINNED_TAB_CAP})`;
```

(f) 在 actions 区、「存为书签」的 `</Tooltip>` 之后(`</div>` 闭合 actions 之前)插入:
```tsx
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                disabled={pinDisabled}
                className={cn(styles.saveBtn, 'text-base')}
                onClick={onPin}
              />
            }
          >
            <Pin />
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>{pinHint}</TooltipContent>
        </Tooltip>
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run src/entrypoints/home/components/TabList/__tests__/index.test.tsx`
Expected: PASS(现有 11 例 + 新增 4 例全绿)

- [ ] **Step 6: 提交**

```bash
git add src/entrypoints/home/components/TabList/index.tsx src/entrypoints/home/components/TabList/__tests__/index.test.tsx
git commit -m "feat: TabList 新增存为常驻标签按钮 + 前置 dedup/cap"
```

---

## Task 5: `Content` 接线常驻数据流 + Dialog

**Files:**
- Modify: `src/entrypoints/home/components/Content/index.tsx`
- Modify: `src/entrypoints/home/components/Content/__tests__/Content.test.tsx`

**Interfaces:**
- Consumes: `usePinnedTabs`、`AddPinnedTabDialog`(Task 2)、`TabList` 新 props(Task 4)。
- Produces: tab 视图 tab 卡片可用「存为常驻标签」。

- [ ] **Step 1: 更新 Content 测试 mock + 写失败测试**

在 `src/entrypoints/home/components/Content/__tests__/Content.test.tsx`:

(a) 在现有 `vi.mock('@/store/useSearch', ...)` 之后追加:
```ts
// 常驻标签 store:可控切片 + 空实现方法
let pinnedTabsState: Record<string, unknown>;
vi.mock('@/store/usePinnedTabs', () => ({
  usePinnedTabs: (sel: (s: Record<string, unknown>) => unknown) => sel(pinnedTabsState),
}));
// AddPinnedTabDialog 内 BookmarkFaviconPreview 走 useFavicon(副作用 hook)
vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => ({ kind: 'third-party', src: 'blob:test', onError: vi.fn() })),
}));
```

(b) 在 `beforeEach` 内(`useWorkspace.setState(...)` 之后)追加:
```ts
  pinnedTabsState = {
    pinnedTabs: [],
    loading: false,
    loadPinnedTabs: vi.fn(),
    createPinnedTab: vi.fn(async (_ws: string, data: { name: string; url: string }) =>
      ({ id: 'p1', workspaceId: _ws, name: data.name, url: data.url, order: 0, createdAt: 0 }) as never),
    deletePinnedTab: vi.fn(),
    reorderPinnedTabs: vi.fn(),
  };
```

(c) 在文件末尾新增接线测试:
```ts
describe('Content 存为常驻标签', () => {
  it('标签页视图点「存为常驻标签」→ 弹 Dialog 预填 tab.url/title', async () => {
    const user = userEvent.setup();
    const openTabs: OpenTab[] = [{
      url: 'https://github.com', tabId: 1, lastAccessed: 0, title: 'GitHub',
    }];
    render(<Content openTabs={openTabs} />);
    await user.click(screen.getByRole('tab', { name: '标签页 1' }));
    await user.click(screen.getByRole('button', { name: /存为常驻标签/ }));

    expect(screen.getByPlaceholderText(/url|链接/i)).toHaveValue('https://github.com');
    expect(screen.getByPlaceholderText(/名称/)).toHaveValue('GitHub');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/entrypoints/home/components/Content/__tests__/Content.test.tsx`
Expected: FAIL(`Content` 未渲染「存为常驻标签」按钮 / 未接 Dialog)

- [ ] **Step 3: 实现 Content 接线**

在 `src/entrypoints/home/components/Content/index.tsx`:

(a) 在现有 import 区(其他 `@/store/*` 附近)加:
```ts
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { AddPinnedTabDialog } from '../AddPinnedTabDialog';
```

(b) 在 `Content` 组件内现有 hooks 之后(`const loadAllByWorkspace = ...` 附近)加:
```ts
  const pinnedTabs = usePinnedTabs((s) => s.pinnedTabs);
  const loadPinnedTabs = usePinnedTabs((s) => s.loadPinnedTabs);
```

(c) 在现有 `saveFromTab` state 附近加:
```ts
  const [pinFromTab, setPinFromTab] = useState<OpenTab | null>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
```

(d) 在 `openAddForTab`/`openAddManual` 附近加:
```ts
  const openPinForTab = (tab: OpenTab) => {
    setPinFromTab(tab);
    setPinDialogOpen(true);
  };
```

(e) 在 `loadAllByWorkspace` 那个 useEffect 之后追加:
```ts
  // 常驻标签切片:进入工作区即 load(per-workspace;与 PinnedArea 各自 load,store loadSeq guard 保平安)
  useEffect(() => {
    if (currentWorkspaceId) void loadPinnedTabs(currentWorkspaceId);
  }, [currentWorkspaceId, loadPinnedTabs]);
```

(f) 把 `<TabsContent value="tabs">` 内的 `<TabList ... />` 追加两个 props(在 `onSaveTab={openAddForTab}` 之后):
```tsx
            pinnedTabs={pinnedTabs}
            onPinTab={openPinForTab}
```

(g) 在 `Content` 的 return JSX 最末(`</div>` 闭合 `styles.content` 之前)追加:
```tsx
      <AddPinnedTabDialog
        open={pinDialogOpen}
        onOpenChange={setPinDialogOpen}
        workspaceId={currentWorkspaceId}
        initialUrl={pinFromTab?.url ?? ''}
        initialName={pinFromTab?.title ?? ''}
      />
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/entrypoints/home/components/Content/__tests__/Content.test.tsx`
Expected: PASS(现有 6 例 + 新增 1 例全绿)

- [ ] **Step 5: 提交**

```bash
git add src/entrypoints/home/components/Content/index.tsx src/entrypoints/home/components/Content/__tests__/Content.test.tsx
git commit -m "feat: Content 接线常驻标签数据流与 Dialog"
```

---

## Task 6: 全量回归 + 双绿收尾

**Files:** 无(仅验证)

- [ ] **Step 1: 全量 typecheck**

Run: `pnpm run typecheck`
Expected: 无错误(重点:TabList 新 props 在所有 caller —— 仅 Content —— 已正确传入)

- [ ] **Step 2: 全量测试**

Run: `pnpm run test`
Expected: 全绿(重点回归:PinnedArea / TabList / Content / PinnedTabService / usePinnedTabs;AddPinnedTabDialog 新增)

- [ ] **Step 3: 如有失败,定位修复后回到对应 Task 重跑,再回到本 Step 1**

- [ ] **Step 4: 推送(可选,触发 husky pre-push 双绿)**

```bash
git push -u origin feature/0.1.13.1
```
注:pre-push hook 自动跑 typecheck + test;若 vitest 慢导致 push tag 超时,push tag 单独用 `git push --no-verify`(见 [[wxt-build-zombie-process]] memory)。普通 commit push 不受影响。

---

## Self-Review 记录

- **Spec 覆盖**:§4(a) AddPinnedTabDialog → Task 2;§4(b) PinnedArea 重构 → Task 3;§4(c) TabList dedup/cap/按钮 + normalizePinnedTabUrl 导出 → Task 1 + Task 4;§4(d) Content 接入 → Task 5;§7 测试场景(预填/失败 Toast/atCap/open 重置/PinnedArea 回归/TabList dedup·cap·onPin/Content 接线)→ 各 Task 测试已覆盖;双绿 → Task 6。无遗漏。
- **占位扫描**:无 TBD/TODO;每步含完整代码或精确改动描述。
- **类型一致性**:`normalizePinnedTabUrl(raw: string): string`(Task 1 定义 → Task 2 mock → Task 4 消费,签名一致);`AddPinnedTabDialog` props(Task 2 定义 → Task 3/Task 5 消费一致);`TabList` 新增 `pinnedTabs`/`onPinTab`(Task 4 定义 → Task 5 消费一致)。
- **测试 mock 一致性**:AddPinnedTabDialog.test 与 PinnedArea.test 同款 mock(service + useFavicon + Toast);Content.test 新增 usePinnedTabs/useFavicon mock 与既有 useBookmarks/useSearch mock 同款 selector 模式。
