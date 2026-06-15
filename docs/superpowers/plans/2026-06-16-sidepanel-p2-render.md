# Side Panel P2 组件渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 side panel `App.tsx` 从占位扩展为四状态 UI（联动正常态 / 空 / 加密 / 加载）+ 按书签分组渲染，接通完整数据流。

**Architecture:** 自底向上分层——`useHostBookmarks(hostname)` hook 做全局匹配取数 → `ContextCard`（纯展示）→ `BookmarkGroup`（单书签四态，内调 `useEncryptedContexts`）→ `StickyHeader` → `App` 编排四状态。测试全部 `vi.mock` 边界，不碰 IndexedDB。

**Tech Stack:** React + TypeScript + WXT + Vitest + @testing-library/react + Semi Icons

**Spec:** `docs/superpowers/specs/2026-06-16-sidepanel-p2-render-design.md`

---

## File Structure

| 文件 | 责任 | 类型 |
|------|------|------|
| `src/entrypoints/sidepanel/hooks/useHostBookmarks.ts` | `(hostname) => { matched, loading }`，全局 getAll + findBookmarksByHost | 新增 |
| `src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts` | null→[]、有值→命中、hostname 变化重匹配 | 新增 |
| `src/entrypoints/sidepanel/components/ContextCard.tsx` | 单条上下文：标题 + markdown 预览（纯展示） | 新增 |
| `src/entrypoints/sidepanel/components/ContextCard.module.css` | ContextCard 样式 | 新增 |
| `src/entrypoints/sidepanel/components/__tests__/ContextCard.test.tsx` | 渲染标题 + markdown | 新增 |
| `src/entrypoints/sidepanel/components/BookmarkGroup.tsx` | 单书签四态（locked/loading/error/contexts），内调 useEncryptedContexts | 新增 |
| `src/entrypoints/sidepanel/components/BookmarkGroup.module.css` | BookmarkGroup 样式 | 新增 |
| `src/entrypoints/sidepanel/components/__tests__/BookmarkGroup.test.tsx` | 四态渲染 | 新增 |
| `src/entrypoints/sidepanel/components/StickyHeader.tsx` | favicon + hostname + 命中数 + 添加按钮（占位） | 新增 |
| `src/entrypoints/sidepanel/components/StickyHeader.module.css` | StickyHeader 样式 | 新增 |
| `src/entrypoints/sidepanel/App.tsx` | 占位 → 四状态编排 + 分组渲染 | 改 |
| `src/entrypoints/sidepanel/App.module.css` | App 样式 | 新增 |
| `src/entrypoints/sidepanel/__tests__/App.test.tsx` | #21 四状态 + 分组渲染（mock 两个 hook） | 新增 |
| `src/entrypoints/sidepanel/main.tsx` | + `openPanelOnActionClick` 配置 | 改 |

**命名说明：** sidepanel 用 `BookmarkGroup`（贴合 design"按书签分组"），与 newtab 的 `src/newtab/components/BookmarkCard/` 区分。

**spec 偏离说明（分类 Tag）：** spec 写"header（书签名 + 分类 Tag + 命中数）"。分类 Tag 显示分类**名**需额外 `getAll('categories')` 取数，增加异步复杂度。P2 简化为：书签名 + 加密锁标识（`bookmark.hasEncryptedContext`）+ 命中数。分类名 Tag 列后续。此偏离在 self-review 标记，建议同步回写 spec"不在范围内"。

---

## Task 1: useHostBookmarks hook

**Files:**
- Create: `src/entrypoints/sidepanel/hooks/useHostBookmarks.ts`
- Test: `src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts`

- [ ] **Step 1: Write the failing test**

`src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/shared/db/database', () => ({
  getAll: vi.fn(),
}));
vi.mock('@/services/BookmarkService', async () => {
  const actual = await vi.importActual<typeof import('@/services/BookmarkService')>('@/services/BookmarkService');
  return { ...actual, findBookmarksByHost: vi.fn() };
});

import { useHostBookmarks } from '../useHostBookmarks';
import { getAll } from '@/shared/db/database';
import { findBookmarksByHost } from '@/services/BookmarkService';
import type { Bookmark } from '@/shared/types';

function makeBookmark(id: string, url: string): Bookmark {
  return {
    id, workspaceId: 'w1', categoryId: 'c1', name: id, url,
    description: '', faviconUrl: '', contextCount: 0,
    hasEncryptedContext: false, createdAt: 0, updatedAt: 0,
  };
}

describe('useHostBookmarks — 全局 hostname 匹配', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hostname 为 null → matched=[]，不调 getAll', () => {
    const { result } = renderHook(() => useHostBookmarks(null));
    expect(result.current.matched).toEqual([]);
    expect(getAll).not.toHaveBeenCalled();
  });

  it('hostname 有值 → getAll(bookmarks) + findBookmarksByHost 返回命中', async () => {
    const all = [makeBookmark('b1', 'https://a.com'), makeBookmark('b2', 'https://b.com')];
    const hit = [all[0]];
    (getAll as ReturnType<typeof vi.fn>).mockResolvedValue(all);
    (findBookmarksByHost as ReturnType<typeof vi.fn>).mockReturnValue(hit);

    const { result } = renderHook(() => useHostBookmarks('a.com'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getAll).toHaveBeenCalledWith('bookmarks');
    expect(findBookmarksByHost).toHaveBeenCalledWith(all, 'a.com');
    expect(result.current.matched).toBe(hit);
  });

  it('hostname 变化 → 重新匹配，结果更新', async () => {
    const all = [makeBookmark('b1', 'https://a.com')];
    (getAll as ReturnType<typeof vi.fn>).mockResolvedValue(all);
    (findBookmarksByHost as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce([all[0]])
      .mockReturnValueOnce([]);

    const { result, rerender } = renderHook(({ h }) => useHostBookmarks(h), { initialProps: { h: 'a.com' } });
    await waitFor(() => expect(result.current.matched).toHaveLength(1));

    rerender({ h: 'z.com' });
    await waitFor(() => expect(result.current.matched).toHaveLength(0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts`
Expected: FAIL — `Cannot find module '../useHostBookmarks'`

- [ ] **Step 3: Write minimal implementation**

`src/entrypoints/sidepanel/hooks/useHostBookmarks.ts`:

```ts
import { useState, useEffect } from 'react';
import { getAll } from '@/shared/db/database';
import { findBookmarksByHost } from '@/services/BookmarkService';
import type { Bookmark } from '@/shared/types';

export interface HostBookmarksState {
  /** hostname 命中的书签（跨所有 workspace） */
  matched: Bookmark[];
  loading: boolean;
}

/**
 * 按 hostname 全局匹配书签（跨所有 workspace，不限定 workspace 范围）。
 *
 * - hostname 为 null（非 http(s) 页面）→ matched=[]，不调 getAll
 * - hostname 有值 → getAll('bookmarks') + findBookmarksByHost
 * - hostname 变化 → 重新匹配（active flag 丢弃过期结果）
 *
 * 全局匹配的理由：side panel 入口语义是"当前页面"，不是"某个工作区"；
 * 用户在不同 workspace 存了同 host 的书签都应可见。来源信息由书签名/锁标识体现。
 *
 * @param hostname 当前 tab 的 hostname（null 表示不可用）
 */
export function useHostBookmarks(hostname: string | null): HostBookmarksState {
  const [matched, setMatched] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hostname) {
      setMatched([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      const all = await getAll<Bookmark>('bookmarks');
      if (!active) return;
      setMatched(findBookmarksByHost(all, hostname));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [hostname]);

  return { matched, loading };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/sidepanel/hooks/useHostBookmarks.ts src/entrypoints/sidepanel/hooks/__tests__/useHostBookmarks.test.ts
git commit -m "feat(sidepanel): 新增 useHostBookmarks hook（全局 hostname 匹配）"
```

---

## Task 2: ContextCard（纯展示）

**Files:**
- Create: `src/entrypoints/sidepanel/components/ContextCard.tsx`
- Create: `src/entrypoints/sidepanel/components/ContextCard.module.css`
- Test: `src/entrypoints/sidepanel/components/__tests__/ContextCard.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/entrypoints/sidepanel/components/__tests__/ContextCard.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextCard } from '../ContextCard';
import { ContextType } from '@/shared/types';
import type { Context } from '@/shared/types';

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    id: 'c1', bookmarkId: 'b1', type: ContextType.NOTE,
    title: '我的笔记', content: '**粗体**', isEncrypted: false,
    order: 0, createdAt: 0, updatedAt: 0, ...overrides,
  };
}

describe('ContextCard — 纯展示', () => {
  it('渲染标题', () => {
    render(<ContextCard context={makeContext()} />);
    expect(screen.getByText('我的笔记')).toBeInTheDocument();
  });

  it('content 渲染为 markdown（**粗体** → <strong>）', () => {
    render(<ContextCard context={makeContext()} />);
    expect(document.querySelector('strong')).toHaveTextContent('粗体');
  });

  it('标题为空时显示"无标题"', () => {
    render(<ContextCard context={makeContext({ title: '' })} />);
    expect(screen.getByText('无标题')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/entrypoints/sidepanel/components/__tests__/ContextCard.test.tsx`
Expected: FAIL — `Cannot find module '../ContextCard'`

- [ ] **Step 3: Write minimal implementation**

`src/entrypoints/sidepanel/components/ContextCard.tsx`:

```tsx
import { renderMarkdown } from '@/shared/utils/markdown';
import type { Context } from '@/shared/types';
import styles from './ContextCard.module.css';

interface ContextCardProps {
  context: Context;
}

/**
 * 单条上下文卡片：标题 + markdown 预览。纯展示组件。
 * 复用 newtab 同款 renderMarkdown（marked + DOMPurify 净化）。
 */
export function ContextCard({ context }: ContextCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.title}>{context.title || '无标题'}</div>
      <div
        className={styles.content}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(context.content) }}
      />
    </div>
  );
}
```

`src/entrypoints/sidepanel/components/ContextCard.module.css`:

```css
.card {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--semi-color-bg-1, #fff);
  border: 1px solid var(--semi-color-border, #e5e5e5);
}
.title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
  color: var(--semi-color-text-0, #1c1c1c);
}
.content {
  font-size: 13px;
  line-height: 1.5;
  color: var(--semi-color-text-1, #444);
  word-break: break-word;
}
.content :global(code) {
  background: var(--semi-color-fill-0, #f5f5f5);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/entrypoints/sidepanel/components/__tests__/ContextCard.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/sidepanel/components/ContextCard.tsx src/entrypoints/sidepanel/components/ContextCard.module.css src/entrypoints/sidepanel/components/__tests__/ContextCard.test.tsx
git commit -m "feat(sidepanel): 新增 ContextCard 纯展示组件（markdown 预览）"
```

---

## Task 3: BookmarkGroup（单书签四态）

**Files:**
- Create: `src/entrypoints/sidepanel/components/BookmarkGroup.tsx`
- Create: `src/entrypoints/sidepanel/components/BookmarkGroup.module.css`
- Test: `src/entrypoints/sidepanel/components/__tests__/BookmarkGroup.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/entrypoints/sidepanel/components/__tests__/BookmarkGroup.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../hooks/useEncryptedContexts', () => ({
  useEncryptedContexts: vi.fn(),
}));

import { BookmarkGroup } from '../BookmarkGroup';
import { useEncryptedContexts } from '../../hooks/useEncryptedContexts';
import type { Bookmark, Context } from '@/shared/types';
import { ContextType } from '@/shared/types';

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'b1', workspaceId: 'w1', categoryId: 'c1', name: 'Google',
    url: 'https://google.com', description: '', faviconUrl: '',
    contextCount: 2, hasEncryptedContext: false, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}
function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    id: 'c1', bookmarkId: 'b1', type: ContextType.NOTE, title: '笔记A',
    content: '内容', isEncrypted: false, order: 0, createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}
const mock = useEncryptedContexts as ReturnType<typeof vi.fn>;

describe('BookmarkGroup — 单书签四态', () => {
  beforeEach(() => vi.clearAllMocks());

  it('header 显示书签名 + 命中数', () => {
    mock.mockReturnValue({ contexts: [], locked: false, error: null, loading: true });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText(/2 条上下文/)).toBeInTheDocument();
  });

  it('locked 态 → 显示解锁提示，不渲染明文', () => {
    mock.mockReturnValue({ contexts: [makeContext({ content: '明文' })], locked: true, error: null, loading: false });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.getByText(/解锁/)).toBeInTheDocument();
    expect(screen.queryByText('笔记A')).not.toBeInTheDocument();
  });

  it('loading 态 → 显示加载中', () => {
    mock.mockReturnValue({ contexts: [], locked: false, error: null, loading: true });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });

  it('error 态 → 显示错误信息', () => {
    mock.mockReturnValue({ contexts: [], locked: false, error: '解密失败', loading: false });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.getByText('解密失败')).toBeInTheDocument();
  });

  it('contexts 态 → 渲染 ContextCard 列表', () => {
    mock.mockReturnValue({
      contexts: [makeContext({ id: 'c1', title: '笔记A' }), makeContext({ id: 'c2', title: '笔记B' })],
      locked: false, error: null, loading: false,
    });
    render(<BookmarkGroup bookmark={makeBookmark()} />);
    expect(screen.getByText('笔记A')).toBeInTheDocument();
    expect(screen.getByText('笔记B')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/entrypoints/sidepanel/components/__tests__/BookmarkGroup.test.tsx`
Expected: FAIL — `Cannot find module '../BookmarkGroup'`

- [ ] **Step 3: Write minimal implementation**

`src/entrypoints/sidepanel/components/BookmarkGroup.tsx`:

```tsx
import { IconLock } from '@douyinfe/semi-icons';
import { useEncryptedContexts } from '../hooks/useEncryptedContexts';
import { ContextCard } from './ContextCard';
import type { Bookmark } from '@/shared/types';
import styles from './BookmarkGroup.module.css';

interface BookmarkGroupProps {
  bookmark: Bookmark;
}

/**
 * 单书签分组：header（书签名 + 加密锁标识 + 命中数）+ 四态内容。
 * 内调 useEncryptedContexts 按 解锁状态 gate 解密渲染。
 *
 * 四态：locked（暖色解锁卡）/ loading（骨架）/ error（错误）/ contexts（ContextCard 列表）
 */
export function BookmarkGroup({ bookmark }: BookmarkGroupProps) {
  const { contexts, locked, error, loading } = useEncryptedContexts(bookmark.id);

  return (
    <div className={styles.group} role="listitem" aria-label={bookmark.name}>
      <div className={styles.header}>
        <span className={styles.name}>{bookmark.name}</span>
        {bookmark.hasEncryptedContext && <IconLock className={styles.lock} aria-label="含加密上下文" />}
        <span className={styles.count}>{bookmark.contextCount} 条上下文</span>
      </div>
      {locked ? (
        <div className={styles.locked}>含加密上下文，点击解锁查看</div>
      ) : loading ? (
        <div className={styles.loading}>加载中…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : contexts.length === 0 ? (
        <div className={styles.empty}>暂无上下文</div>
      ) : (
        <div className={styles.contexts}>
          {contexts.map((ctx) => (
            <ContextCard key={ctx.id} context={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}
```

`src/entrypoints/sidepanel/components/BookmarkGroup.module.css`:

```css
.group {
  border-bottom: 1px solid var(--semi-color-border, #eee);
  padding: 10px 0;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 6px;
}
.name {
  font-weight: 600;
  font-size: 14px;
  color: var(--semi-color-text-0, #1c1c1c);
}
.lock {
  color: #fa8c16;
  font-size: 14px;
}
.count {
  margin-left: auto;
  font-size: 12px;
  color: var(--semi-color-text-2, #999);
}
.contexts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px;
}
.locked {
  margin: 0 12px;
  padding: 12px;
  border-radius: 8px;
  background: #fff7e6;
  color: #fa8c16;
  font-size: 13px;
}
.loading, .empty, .error {
  padding: 8px 12px;
  font-size: 13px;
  color: var(--semi-color-text-2, #999);
}
.error {
  color: var(--semi-color-danger, #f5222d);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/entrypoints/sidepanel/components/__tests__/BookmarkGroup.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/sidepanel/components/BookmarkGroup.tsx src/entrypoints/sidepanel/components/BookmarkGroup.module.css src/entrypoints/sidepanel/components/__tests__/BookmarkGroup.test.tsx
git commit -m "feat(sidepanel): 新增 BookmarkGroup 单书签四态组件"
```

---

## Task 4: StickyHeader（顶栏）

纯展示组件，无 hook 依赖，与 Task 5 的 App 测试合并验证四状态，本任务不单独写测试（YAGNI）。

**Files:**
- Create: `src/entrypoints/sidepanel/components/StickyHeader.tsx`
- Create: `src/entrypoints/sidepanel/components/StickyHeader.module.css`

- [ ] **Step 1: Write implementation**

`src/entrypoints/sidepanel/components/StickyHeader.tsx`:

```tsx
import { IconPlus } from '@douyinfe/semi-icons';
import { getFaviconUrl } from '@/services/BookmarkService';
import styles from './StickyHeader.module.css';

interface StickyHeaderProps {
  hostname: string;
  matchCount: number;
  /** 添加按钮回调（P2 占位：导航到 newtab） */
  onAdd: () => void;
}

/**
 * side panel 顶栏：favicon + hostname + 命中统计 + 添加按钮（占位）。
 * sticky 固定在顶部，滚动时常驻。
 */
export function StickyHeader({ hostname, matchCount, onAdd }: StickyHeaderProps) {
  return (
    <div className={styles.header}>
      <img
        src={getFaviconUrl(`https://${hostname}`)}
        alt=""
        className={styles.favicon}
        onError={(e) => {
          (e.target as HTMLImageElement).style.visibility = 'hidden';
        }}
      />
      <div className={styles.info}>
        <div className={styles.hostname}>{hostname}</div>
        <div className={styles.count}>{matchCount} 个书签命中</div>
      </div>
      <button className={styles.addBtn} onClick={onAdd} aria-label="添加书签">
        <IconPlus />
      </button>
    </div>
  );
}
```

`src/entrypoints/sidepanel/components/StickyHeader.module.css`:

```css
.header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--semi-color-bg-0, #fff);
  border-bottom: 1px solid var(--semi-color-border, #eee);
}
.favicon {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  flex-shrink: 0;
}
.info {
  flex: 1;
  min-width: 0;
}
.hostname {
  font-weight: 600;
  font-size: 14px;
  color: var(--semi-color-text-0, #1c1c1c);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.count {
  font-size: 12px;
  color: var(--semi-color-text-2, #999);
}
.addBtn {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  background: #0077fa;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.addBtn:hover {
  background: #0066d6;
}
```

- [ ] **Step 2: Verify build (typecheck via build)**

Run: `npx wxt build`
Expected: build success（注：`@douyinfe/semi-icons` 与 `@/services/BookmarkService` 已是项目依赖，无需新增）

- [ ] **Step 3: Commit**

```bash
git add src/entrypoints/sidepanel/components/StickyHeader.tsx src/entrypoints/sidepanel/components/StickyHeader.module.css
git commit -m "feat(sidepanel): 新增 StickyHeader 顶栏组件"
```

---

## Task 5: App 四状态编排 + #21 分组渲染

**Files:**
- Modify: `src/entrypoints/sidepanel/App.tsx`
- Create: `src/entrypoints/sidepanel/App.module.css`
- Test: `src/entrypoints/sidepanel/__tests__/App.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/entrypoints/sidepanel/__tests__/App.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../hooks/useCurrentTabContext', () => ({
  useCurrentTabContext: vi.fn(),
}));
vi.mock('../hooks/useHostBookmarks', () => ({
  useHostBookmarks: vi.fn(),
}));

import App from '../App';
import { useCurrentTabContext } from '../hooks/useCurrentTabContext';
import { useHostBookmarks } from '../hooks/useHostBookmarks';
import type { Bookmark } from '@/shared/types';

function makeBookmark(id: string, name: string): Bookmark {
  return {
    id, workspaceId: 'w1', categoryId: 'c1', name, url: `https://${id}.com`,
    description: '', faviconUrl: '', contextCount: 1, hasEncryptedContext: false,
    createdAt: 0, updatedAt: 0,
  };
}
const tabMock = useCurrentTabContext as ReturnType<typeof vi.fn>;
const hostMock = useHostBookmarks as ReturnType<typeof vi.fn>;

describe('App — 四状态 + 分组渲染', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tab loading → 显示加载中', () => {
    tabMock.mockReturnValue({ hostname: null, loading: true });
    hostMock.mockReturnValue({ matched: [], loading: false });
    render(<App />);
    expect(screen.getByText('加载中…')).toBeInTheDocument();
  });

  it('hostname 为 null（非 http(s)）→ 此页面不支持联动', () => {
    tabMock.mockReturnValue({ hostname: null, loading: false });
    hostMock.mockReturnValue({ matched: [], loading: false });
    render(<App />);
    expect(screen.getByText('此页面不支持联动')).toBeInTheDocument();
  });

  it('匹配中 → 显示匹配态', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    hostMock.mockReturnValue({ matched: [], loading: true });
    render(<App />);
    expect(screen.getByText('匹配中…')).toBeInTheDocument();
  });

  it('无命中 → 空状态 + 在 Octane 管理', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    hostMock.mockReturnValue({ matched: [], loading: false });
    render(<App />);
    expect(screen.getByText(/无匹配书签/)).toBeInTheDocument();
    expect(screen.getByText('在 Octane 管理')).toBeInTheDocument();
  });

  it('有命中 → StickyHeader + 按书签分组渲染', () => {
    tabMock.mockReturnValue({ hostname: 'a.com', loading: false });
    const matched = [makeBookmark('b1', 'Google'), makeBookmark('b2', 'Gmail')];
    hostMock.mockReturnValue({ matched, loading: false });
    // BookmarkGroup 内部 useEncryptedContexts 默认 loading → 显示"加载中…"，不渲染明文
    vi.doMock; // noop
    const { container } = render(<App />);
    expect(screen.getByText('a.com')).toBeInTheDocument();
    expect(screen.getByText(/2 个书签命中/)).toBeInTheDocument();
    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('Gmail')).toBeInTheDocument();
  });
});
```

> 注：第 5 个用例里 BookmarkGroup 会调真实的 `useEncryptedContexts`（未 mock），在测试环境其内部 `isUnlocked`/`getContexts` 未定义会抛错或停在 loading。为隔离，App 测试 mock 覆盖 `useEncryptedContexts`：

在第 5 个用例的 mock 块顶部（紧跟前两个 vi.mock）追加：

```tsx
vi.mock('../hooks/useEncryptedContexts', () => ({
  useEncryptedContexts: () => ({ contexts: [], locked: false, error: null, loading: false }),
}));
```

（放在文件顶部 vi.mock 区，与其他 mock 并列；这样 BookmarkGroup 渲染"暂无上下文"，header 的书签名仍断言通过。）

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/entrypoints/sidepanel/__tests__/App.test.tsx`
Expected: FAIL — App 仍是占位，不渲染四状态文案

- [ ] **Step 3: Write implementation**

`src/entrypoints/sidepanel/App.tsx`（覆盖现有占位）:

```tsx
import { useCurrentTabContext } from './hooks/useCurrentTabContext';
import { useHostBookmarks } from './hooks/useHostBookmarks';
import { StickyHeader } from './components/StickyHeader';
import { BookmarkGroup } from './components/BookmarkGroup';
import styles from './App.module.css';

/** P2 占位：添加/管理按钮导航到 newtab（完整内联保存表单列后续）。 */
function openNewtab() {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
}

/**
 * Side Panel 根组件：四状态编排 + 按书签分组渲染。
 *
 * 状态机：
 * - tab loading → 加载中
 * - hostname null（非 http(s)）→ 此页面不支持联动
 * - useHostBookmarks loading → 匹配中
 * - matched 空 → 空状态
 * - matched 有 → StickyHeader + BookmarkGroup[]
 */
export default function App() {
  const { hostname, loading: tabLoading } = useCurrentTabContext();
  const { matched, loading: matching } = useHostBookmarks(hostname);

  if (tabLoading) {
    return <div className={styles.state}>加载中…</div>;
  }
  if (!hostname) {
    return <div className={styles.state}>此页面不支持联动</div>;
  }
  if (matching) {
    return <div className={styles.state}>匹配中…</div>;
  }
  if (matched.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyText}>该页面暂无匹配书签</div>
        <button className={styles.manageBtn} onClick={openNewtab}>在 Octane 管理</button>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <StickyHeader hostname={hostname} matchCount={matched.length} onAdd={openNewtab} />
      <div className={styles.list} role="list">
        {matched.map((b) => (
          <BookmarkGroup key={b.id} bookmark={b} />
        ))}
      </div>
    </div>
  );
}
```

`src/entrypoints/sidepanel/App.module.css`:

```css
.app {
  min-height: 100vh;
  background: var(--semi-color-bg-0, #fff);
}
.list {
  padding-bottom: 16px;
}
.state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  font-size: 14px;
  color: var(--semi-color-text-2, #999);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 100vh;
  padding: 24px;
  text-align: center;
}
.emptyText {
  font-size: 14px;
  color: var(--semi-color-text-1, #666);
}
.manageBtn {
  padding: 8px 16px;
  border: 1px solid #0077fa;
  border-radius: 8px;
  background: transparent;
  color: #0077fa;
  font-size: 13px;
  cursor: pointer;
}
.manageBtn:hover {
  background: rgba(0, 119, 250, 0.06);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/entrypoints/sidepanel/__tests__/App.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Run full suite to verify no regression**

Run: `npx vitest run`
Expected: PASS（原有 97 + 新增，无失败）

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/sidepanel/App.tsx src/entrypoints/sidepanel/App.module.css src/entrypoints/sidepanel/__tests__/App.test.tsx
git commit -m "feat(sidepanel): App 四状态编排 + 按书签分组渲染"
```

---

## Task 6: openPanelOnActionClick 配置 + build 验证

**Files:**
- Modify: `src/entrypoints/sidepanel/main.tsx`

- [ ] **Step 1: Write implementation**

`src/entrypoints/sidepanel/main.tsx`（覆盖现有）:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/global.css';
import App from './App';

// 点扩展图标直达 side panel（Chrome sidePanel API）。
// Firefox 无此 API，运行时可选链保护；M6 适配层在 P3 处理。
// 注：chrome 全局 TS 类型缺失（TS2304），与 useCurrentTabContext 同模式，@types/chrome 列后续统一修。
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true } as never);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 2: Verify build + manifest**

Run: `npx wxt build`
Expected: build success，`.output/<browser>-mv3/manifest.json` 含 `side_panel.default_path` 与 `permissions: [..., "sidePanel"]`

- [ ] **Step 3: Run full suite**

Run: `npx vitest run`
Expected: PASS（全套绿）

- [ ] **Step 4: Commit**

```bash
git add src/entrypoints/sidepanel/main.tsx
git commit -m "feat(sidepanel): 配置 openPanelOnActionClick 点图标直达"
```

---

## Self-Review

**1. Spec coverage:**
- 决策 1（全局匹配）→ Task 1 useHostBookmarks 用 `getAll('bookmarks')` ✅
- 决策 2（抽 hook）→ Task 1 ✅
- 决策 3（BookmarkGroup + ContextCard 两层）→ Task 2/3 ✅
- 决策 4（添加按钮占位）→ Task 4 StickyHeader `onAdd` + Task 5 `openNewtab` ✅
- App 四状态 → Task 5（tabLoading / hostname null / matching / 空 / 正常）✅
- #21 分组渲染 → Task 5 第 5 用例 ✅
- useHostBookmarks 测试（null/有值/变化）→ Task 1 ✅
- BookmarkGroup 四态测试 → Task 3 ✅
- openPanelOnActionClick → Task 6 ✅

**2. Placeholder scan:** 无 TBD/TODO；每步含完整代码与命令。Task 5 测试的 `vi.doMock; // noop` 是占位说明——已在紧随的注解里改为文件顶部 `vi.mock('../hooks/useEncryptedContexts')`，无遗留。✅

**3. Type consistency:**
- `useHostBookmarks(hostname: string | null): { matched: Bookmark[], loading: boolean }` — Task 1 定义，Task 5 App 消费一致 ✅
- `ContextCard({ context: Context })` — Task 2 定义，Task 3 BookmarkGroup 调用一致 ✅
- `BookmarkGroup({ bookmark: Bookmark })` — Task 3 定义，Task 5 App 调用一致 ✅
- `StickyHeader({ hostname: string, matchCount: number, onAdd: () => void })` — Task 4 定义，Task 5 调用一致 ✅

**待回写 spec 的偏离：** BookmarkGroup header 未实现分类名 Tag（需 `getAll('categories')` 取数），P2 用书签名 + 加密锁标识 + 命中数替代。建议 spec "不在范围内"补一条"分类名 Tag（需查 categories）"。
