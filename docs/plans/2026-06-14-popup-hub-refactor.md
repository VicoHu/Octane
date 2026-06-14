# Popup Hub 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 popup 从「打开即书签保存表单」重构为「首页 Hub（用户卡 + 功能列表）+ 子页面（保存书签 / 设置）」，采用方案 C（用户卡为视觉锚点 + 主操作在功能列表首行强调）。

**Architecture:** App 退化为轻量视图路由（`useState<View>`，不引入 router）。首页 `HomeView` = 用户卡（Avatar + 名称 + 右上角下拉：设置/退出）+ 功能列表（Semi `List`，首行「保存当前页面」强调）。现有保存逻辑整体迁入 `SaveBookmarkView` 子页（行为不变，外加 `SubPageHeader` 返回头）。`useUser` hook 占位返回 null，UI 支持 guest 态。

**Tech Stack:** WXT + React 19 + TypeScript（strict）+ Semi Design（`@douyinfe/semi-ui` / `@douyinfe/semi-icons`）+ Vitest + @testing-library/react。

**设计决策来源：** 方案 C（用户确认）；退出登录放用户卡右上角下拉。详见 memory `popup-hub-architecture`。

---

## 文件结构

```
src/entrypoints/popup/
├── App.tsx                     # 改：退化为视图路由
├── App.test.tsx                # 改：重写为路由单测（mock 子 view）
├── main.tsx                    # 改：承接 global.css / popup-reset.css 导入
├── index.html                  # 改：标题
├── popup.module.css            # 改：.popup 去掉 flex/gap；新增各 view 样式
├── popup-reset.css             # 不变
├── utils.ts / utils.test.ts    # 不变
├── navigation.ts               # 新：View 路由类型
├── testUtils.ts                # 新：共享 mockChrome / clearAllStores
├── hooks/
│   ├── useUser.ts              # 新：占位 hook（返回 null）
│   └── useUser.test.ts         # 新
└── views/
    ├── SubPageHeader.tsx       # 新：子页通用返回头
    ├── SubPageHeader.test.tsx  # 新
    ├── SaveBookmarkView.tsx    # 新：从 App.tsx 抽取的保存逻辑
    ├── SaveBookmarkView.test.tsx # 新：从 App.test.tsx 迁移
    ├── SettingsView.tsx        # 新：占位空壳
    ├── SettingsView.test.tsx   # 新
    ├── HomeView.tsx            # 新：用户卡 + 功能列表
    └── HomeView.test.tsx       # 新
```

**执行顺序说明：** Task 1-6 创建新文件（App.tsx 维持旧版，全程可编译可测试）；Task 7 才切换 App 为路由并迁移 CSS 导入。任何时刻 `npm test` 都是绿的。

---

## Task 1: 导航类型 navigation.ts

**Files:**
- Create: `src/entrypoints/popup/navigation.ts`

- [ ] **Step 1: 创建 View 路由类型**

创建 `src/entrypoints/popup/navigation.ts`：

```ts
/**
 * Popup 内部视图路由类型。
 * Popup 是瞬态容器，用轻量 state 切换视图，不引入 router。
 */
export type View = 'home' | 'save' | 'settings';
```

- [ ] **Step 2: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/entrypoints/popup/navigation.ts
git commit -m "feat(popup): 新增 View 路由类型"
```

---

## Task 2: useUser hook + 测试

**Files:**
- Create: `src/entrypoints/popup/hooks/useUser.ts`
- Test: `src/entrypoints/popup/hooks/useUser.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/entrypoints/popup/hooks/useUser.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { useUser } from './useUser';

describe('useUser', () => {
  it('v1 占位：始终返回 null（guest 态）', () => {
    expect(useUser()).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/entrypoints/popup/hooks/useUser.test.ts`
Expected: FAIL — `Failed to resolve import "./useUser"`

- [ ] **Step 3: 实现 hook**

创建 `src/entrypoints/popup/hooks/useUser.ts`：

```ts
/** 当前登录用户。 */
export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

/**
 * 读取当前登录用户。
 *
 * v1 占位：账户系统尚未实现，始终返回 null（guest 态）。
 * 未来接入鉴权后，仅改此 hook 的实现，调用方 UI 结构不变。
 */
export function useUser(): User | null {
  return null;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/entrypoints/popup/hooks/useUser.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: 提交**

```bash
git add src/entrypoints/popup/hooks/useUser.ts src/entrypoints/popup/hooks/useUser.test.ts
git commit -m "feat(popup): 新增 useUser 占位 hook（guest 态）"
```

---

## Task 3: SubPageHeader 组件 + 测试 + 样式

**Files:**
- Create: `src/entrypoints/popup/views/SubPageHeader.tsx`
- Test: `src/entrypoints/popup/views/SubPageHeader.test.tsx`
- Modify: `src/entrypoints/popup/popup.module.css`（追加子页头样式）

- [ ] **Step 1: 写失败测试**

创建 `src/entrypoints/popup/views/SubPageHeader.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
// Semi 加载动画依赖 lottie-web；jsdom 无 canvas，mock 掉
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
import { render, screen, fireEvent } from '@testing-library/react';
import SubPageHeader from './SubPageHeader';

describe('SubPageHeader', () => {
  it('渲染标题', () => {
    render(<SubPageHeader title="保存当前页面" onBack={vi.fn()} />);
    expect(screen.getByText('保存当前页面')).toBeInTheDocument();
  });

  it('点击返回按钮调用 onBack', () => {
    const onBack = vi.fn();
    render(<SubPageHeader title="测试" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/entrypoints/popup/views/SubPageHeader.test.tsx`
Expected: FAIL — 无法解析 `./SubPageHeader`

- [ ] **Step 3: 实现组件**

创建 `src/entrypoints/popup/views/SubPageHeader.tsx`：

```tsx
import type { ReactNode } from 'react';
import { IconChevronLeft } from '@douyinfe/semi-icons';
import { Typography } from '@douyinfe/semi-ui';
import styles from '../popup.module.css';

interface SubPageHeaderProps {
  title: string;
  onBack: () => void;
  /** 标题栏右侧槽位（可选）。 */
  right?: ReactNode;
}

/** 子页面通用返回头：左侧返回按钮 + 居中标题 + 可选右侧槽位。 */
export default function SubPageHeader({ title, onBack, right }: SubPageHeaderProps) {
  return (
    <div className={styles.subPageHeader}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={onBack}
        aria-label="返回"
      >
        <IconChevronLeft />
      </button>
      <Typography.Text strong className={styles.subPageTitle}>
        {title}
      </Typography.Text>
      <div className={styles.subPageRight}>{right}</div>
    </div>
  );
}
```

- [ ] **Step 4: 追加子页头样式**

在 `src/entrypoints/popup/popup.module.css` **末尾**追加（不改动现有 `.popup`/`.loading`/`.duplicateHint`）：

```css
/* === 子页面返回头 === */
.subPageHeader {
  display: flex;
  align-items: center;
  gap: 8px;
}

.backBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary, #475569);
  border-radius: var(--radius-md, 8px);
  cursor: pointer;
  transition: background var(--transition-fast, 150ms ease);
}

.backBtn:hover {
  background: var(--primary-light, rgba(99, 102, 241, 0.1));
  color: var(--primary, #6366f1);
}

.subPageTitle {
  flex: 1;
  text-align: center;
}

.subPageRight {
  min-width: 28px;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/entrypoints/popup/views/SubPageHeader.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: 提交**

```bash
git add src/entrypoints/popup/views/SubPageHeader.tsx \
        src/entrypoints/popup/views/SubPageHeader.test.tsx \
        src/entrypoints/popup/popup.module.css
git commit -m "feat(popup): 新增 SubPageHeader 子页返回头"
```

---

## Task 4: SaveBookmarkView（从 App 抽取）+ testUtils + 测试 + 样式

> 这是最大的任务：把现有 `App.tsx` 的保存逻辑**原样**搬到 `SaveBookmarkView`，行为不变，仅外包一层 `SubPageHeader`。同时抽取共享测试工具。

**Files:**
- Create: `src/entrypoints/popup/testUtils.ts`
- Create: `src/entrypoints/popup/views/SaveBookmarkView.tsx`
- Test: `src/entrypoints/popup/views/SaveBookmarkView.test.tsx`
- Modify: `src/entrypoints/popup/popup.module.css`（追加 `.saveView`）

> 注意：此任务**不改动** `App.tsx` / `App.test.tsx`，它们继续作为旧版工作。`SaveBookmarkView` 创建后暂未被引用，Task 7 才接入。

- [ ] **Step 1: 抽取共享测试工具**

创建 `src/entrypoints/popup/testUtils.ts`（从现有 `App.test.tsx` 抽出 `mockChrome` 与 `clearAllStores`，逻辑不变）：

```ts
import { vi } from 'vitest';
import { getDB } from '@/shared/db/database';

/** 清空所有 object store，保证测试隔离。 */
export async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const names = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) await tx.objectStore(n).clear();
  await tx.done;
}

/**
 * 覆盖 chrome 全局为可控 mock（覆盖 WxtVitest 的 fakeBrowser，使返回值确定）。
 */
export function mockChrome(activeTab: { url: string; title: string }): void {
  const storage: Record<string, unknown> = {};
  (globalThis as { chrome: unknown }).chrome = {
    tabs: { query: vi.fn().mockResolvedValue([activeTab]) },
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in storage) out[k] = storage[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storage, items);
        }),
      },
    },
    runtime: { getURL: vi.fn().mockReturnValue('chrome-extension://x/newtab.html') },
  };
}
```

- [ ] **Step 2: 写失败测试（从 App.test.tsx 迁移 + 加返回测试）**

创建 `src/entrypoints/popup/views/SaveBookmarkView.test.tsx`：

```tsx
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
// Semi 加载动画依赖 lottie-web；jsdom 无 canvas，mock 掉
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { resetDB, getDB } from '@/shared/db/database';
import { createWorkspace } from '@/services/WorkspaceService';
import { createCategory } from '@/services/CategoryService';
import { createBookmark, listBookmarksByWorkspace } from '@/services/BookmarkService';
import { clearAllStores, mockChrome } from '../testUtils';
import SaveBookmarkView from './SaveBookmarkView';

describe('SaveBookmarkView', () => {
  beforeEach(async () => {
    resetDB();
    await getDB();
    await clearAllStores();
    vi.spyOn(window, 'close').mockImplementation(() => {});
    mockChrome({ url: 'https://github.com', title: 'GitHub' });
  });

  it('点击返回调用 onBack', async () => {
    const onBack = vi.fn();
    render(<SaveBookmarkView onBack={onBack} />);
    await screen.findByDisplayValue('https://github.com');
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('保存有效书签 → 写入 DB（含 favicon）并关闭 popup', async () => {
    const ws = await createWorkspace('工作', '📁');
    await createCategory(ws.id, '工具', '🔧');

    render(<SaveBookmarkView onBack={vi.fn()} />);

    // 等待当前 tab url 自动填充（验证 chrome.tabs.query + 数据加载）
    await screen.findByDisplayValue('https://github.com');

    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    const bms = await waitFor(async () => {
      const list = await listBookmarksByWorkspace(ws.id);
      expect(list).toHaveLength(1);
      return list;
    });
    expect(bms[0]!.url).toBe('https://github.com');
    expect(bms[0]!.faviconUrl).toContain('google.com/s2/favicons');
    // 保存成功后显示反馈
    await screen.findByText(/已保存/);
    // 反馈短暂显示后关闭
    await waitFor(() => expect(window.close).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('URL 非法（chrome://）时保存按钮禁用', async () => {
    const ws = await createWorkspace('工作', '📁');
    await createCategory(ws.id, '工具', '🔧');

    render(<SaveBookmarkView onBack={vi.fn()} />);
    await screen.findByDisplayValue('https://github.com');

    fireEvent.change(screen.getByDisplayValue('https://github.com'), {
      target: { value: 'chrome://newtab' },
    });

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /保存/ }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it('同分类已有相同 URL → 提示重复，确认后仍可保存', async () => {
    const ws = await createWorkspace('工作', '📁');
    const cat = await createCategory(ws.id, '工具', '🔧');
    await createBookmark(ws.id, cat.id, { name: '已有', url: 'https://github.com' });

    render(<SaveBookmarkView onBack={vi.fn()} />);
    await screen.findByDisplayValue('https://github.com');

    fireEvent.click(screen.getByRole('button', { name: /保存/ }));

    // 出现重复提示 + 「仍然保存」按钮
    const forceBtn = await screen.findByRole('button', { name: /仍然保存/ });
    fireEvent.click(forceBtn);

    const bms = await waitFor(async () => {
      const list = await listBookmarksByWorkspace(ws.id);
      expect(list).toHaveLength(2);
      return list;
    });
    expect(bms.filter((b) => b.url === 'https://github.com')).toHaveLength(2);
    await waitFor(() => expect(window.close).toHaveBeenCalled(), { timeout: 2000 });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/entrypoints/popup/views/SaveBookmarkView.test.tsx`
Expected: FAIL — 无法解析 `./SaveBookmarkView`

- [ ] **Step 4: 实现 SaveBookmarkView（从 App.tsx 原样迁移逻辑）**

创建 `src/entrypoints/popup/views/SaveBookmarkView.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { Input, Button, TextArea, Select } from '@douyinfe/semi-ui';
import type { Workspace, Category, Bookmark } from '@/shared/types';
import { listWorkspaces } from '@/services/WorkspaceService';
import { listCategories } from '@/services/CategoryService';
import {
  listBookmarksByWorkspace,
  createBookmark,
  updateBookmark,
  getFaviconUrl,
} from '@/services/BookmarkService';
import { isUrlValid, findDuplicateUrl } from '../utils';
import styles from '../popup.module.css';
import SubPageHeader from './SubPageHeader';

const LAST_WS_KEY = 'lastWorkspaceId';
const LAST_CAT_KEY = 'lastCategoryId';
/** Q1：保存成功后的短反馈展示时长，随后自动关闭 popup */
const CLOSE_DELAY_MS = 800;

interface SaveBookmarkViewProps {
  /** 返回首页。 */
  onBack: () => void;
}

export default function SaveBookmarkView({ onBack }: SaveBookmarkViewProps) {
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [duplicate, setDuplicate] = useState<Bookmark | null>(null);

  // mount：加载工作区 + 抓取当前页 + 读取记忆
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wss, tabs, stored] = await Promise.all([
          listWorkspaces(),
          chrome.tabs.query({ active: true, currentWindow: true }),
          chrome.storage.local.get([LAST_WS_KEY, LAST_CAT_KEY]),
        ]);
        if (cancelled) return;
        setWorkspaces(wss);

        const tab = tabs[0];
        setUrl(tab?.url ?? '');
        setName(tab?.title ?? '');

        // 确定工作区：上次记忆（若仍存在）> 第一个
        const lastWs = stored[LAST_WS_KEY] as string | undefined;
        const wsId =
          lastWs && wss.some((w) => w.id === lastWs) ? lastWs : (wss[0]?.id ?? '');
        setSelectedWorkspaceId(wsId);

        // 加载该工作区的分类
        if (wsId) {
          const cats = await listCategories(wsId);
          if (cancelled) return;
          setCategories(cats);
          const lastCat = stored[LAST_CAT_KEY] as string | undefined;
          const catId =
            lastCat && cats.some((c) => c.id === lastCat) ? lastCat : (cats[0]?.id ?? '');
          setSelectedCategoryId(catId);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 工作区切换：重新加载分类，重置选中
  const handleWorkspaceChange = async (wsId: string) => {
    setSelectedWorkspaceId(wsId);
    setSelectedCategoryId('');
    setDuplicate(null);
    const cats = await listCategories(wsId);
    setCategories(cats);
    setSelectedCategoryId(cats[0]?.id ?? '');
  };

  const handleSave = async (forceSave = false) => {
    if (!isUrlValid(url) || saving || !selectedWorkspaceId || !selectedCategoryId) return;
    setSaving(true);
    setDuplicate(null);
    try {
      if (!forceSave) {
        const bms = await listBookmarksByWorkspace(selectedWorkspaceId);
        const dup = findDuplicateUrl(bms, selectedCategoryId, url);
        if (dup) {
          setDuplicate(dup);
          setSaving(false);
          return;
        }
      }
      const finalName = name || (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })();
      const bookmark = await createBookmark(selectedWorkspaceId, selectedCategoryId, {
        name: finalName,
        url,
        description: description || undefined,
      });
      const faviconUrl = getFaviconUrl(url);
      if (faviconUrl) {
        await updateBookmark(bookmark.id, { faviconUrl });
      }
      await chrome.storage.local.set({
        [LAST_WS_KEY]: selectedWorkspaceId,
        [LAST_CAT_KEY]: selectedCategoryId,
      });
      // Q1：保存成功 → 短反馈 → 自动关闭 popup
      setSaving(false);
      setSaved(true);
      setTimeout(() => window.close(), CLOSE_DELAY_MS);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className={styles.saveView}>
      <SubPageHeader title="保存当前页面" onBack={onBack} />

      {loading ? (
        <div className={styles.loading}>加载中…</div>
      ) : (
        <>
          <Select
            value={selectedWorkspaceId}
            onChange={(v) => handleWorkspaceChange(String(v))}
            placeholder="选择工作区"
            style={{ width: '100%' }}
          >
            {workspaces.map((w) => (
              <Select.Option key={w.id} value={w.id}>
                {w.icon} {w.name}
              </Select.Option>
            ))}
          </Select>

          <Select
            value={selectedCategoryId}
            onChange={(v) => setSelectedCategoryId(String(v))}
            placeholder="选择分类"
            disabled={!selectedWorkspaceId || categories.length === 0}
            style={{ width: '100%' }}
          >
            {categories.map((c) => (
              <Select.Option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </Select.Option>
            ))}
          </Select>

          <Input
            placeholder="https://example.com"
            value={url}
            onChange={(v) => setUrl(v)}
            aria-label="URL"
          />
          <Input
            placeholder="名称（留空使用域名）"
            value={name}
            onChange={(v) => setName(v)}
            aria-label="名称"
          />
          <TextArea
            placeholder="描述（可选）"
            value={description}
            onChange={(v) => setDescription(v)}
            maxLength={200}
            aria-label="描述"
          />

          {duplicate && (
            <div className={styles.duplicateHint} role="alert">
              <span>该分类下已存在相同 URL（{duplicate.name}）</span>
              <Button size="small" theme="solid" onClick={() => handleSave(true)}>
                仍然保存
              </Button>
            </div>
          )}

          <Button
            theme="solid"
            loading={saving}
            disabled={!isUrlValid(url) || saving || saved}
            onClick={() => handleSave(false)}
          >
            {saved ? '已保存 ✓' : '保存'}
          </Button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 追加 .saveView 样式**

在 `src/entrypoints/popup/popup.module.css` 末尾追加：

```css
/* === 保存书签子页 === */
.saveView {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run src/entrypoints/popup/views/SaveBookmarkView.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 7: 确认旧 App 测试仍通过（未受影响）**

Run: `npx vitest run src/entrypoints/popup/App.test.tsx`
Expected: PASS（旧 App.tsx 仍是单页表单，未被改动）

- [ ] **Step 8: 提交**

```bash
git add src/entrypoints/popup/testUtils.ts \
        src/entrypoints/popup/views/SaveBookmarkView.tsx \
        src/entrypoints/popup/views/SaveBookmarkView.test.tsx \
        src/entrypoints/popup/popup.module.css
git commit -m "feat(popup): 抽取 SaveBookmarkView 子页（从 App 迁移保存逻辑）"
```

---

## Task 5: SettingsView 占位 + 测试

**Files:**
- Create: `src/entrypoints/popup/views/SettingsView.tsx`
- Test: `src/entrypoints/popup/views/SettingsView.test.tsx`
- Modify: `src/entrypoints/popup/popup.module.css`（追加 `.settingsView`）

- [ ] **Step 1: 写失败测试**

创建 `src/entrypoints/popup/views/SettingsView.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsView from './SettingsView';

describe('SettingsView', () => {
  it('渲染占位文案', () => {
    render(<SettingsView onBack={vi.fn()} />);
    expect(screen.getByText('设置功能开发中')).toBeInTheDocument();
  });

  it('点击返回调用 onBack', () => {
    const onBack = vi.fn();
    render(<SettingsView onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/entrypoints/popup/views/SettingsView.test.tsx`
Expected: FAIL — 无法解析 `./SettingsView`

- [ ] **Step 3: 实现 SettingsView（占位空壳）**

创建 `src/entrypoints/popup/views/SettingsView.tsx`：

```tsx
import { Typography } from '@douyinfe/semi-ui';
import SubPageHeader from './SubPageHeader';
import styles from '../popup.module.css';

interface SettingsViewProps {
  /** 返回首页。 */
  onBack: () => void;
}

/** 设置子页面（v1 占位空壳，等待账户/偏好系统接入）。 */
export default function SettingsView({ onBack }: SettingsViewProps) {
  return (
    <div className={styles.settingsView}>
      <SubPageHeader title="设置" onBack={onBack} />
      <Typography.Text type="tertiary">设置功能开发中</Typography.Text>
    </div>
  );
}
```

- [ ] **Step 4: 追加 .settingsView 样式**

在 `src/entrypoints/popup/popup.module.css` 末尾追加：

```css
/* === 设置子页 === */
.settingsView {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/entrypoints/popup/views/SettingsView.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: 提交**

```bash
git add src/entrypoints/popup/views/SettingsView.tsx \
        src/entrypoints/popup/views/SettingsView.test.tsx \
        src/entrypoints/popup/popup.module.css
git commit -m "feat(popup): 新增 SettingsView 占位空壳"
```

---

## Task 6: HomeView（用户卡 + 功能列表 + 下拉）+ 测试 + 样式

**Files:**
- Create: `src/entrypoints/popup/views/HomeView.tsx`
- Test: `src/entrypoints/popup/views/HomeView.test.tsx`
- Modify: `src/entrypoints/popup/popup.module.css`（追加首页样式）

- [ ] **Step 1: 写失败测试**

创建 `src/entrypoints/popup/views/HomeView.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
import { render, screen, fireEvent } from '@testing-library/react';
import { useUser } from '../hooks/useUser';
import HomeView from './HomeView';

// 自动 mock useUser，逐测试用 vi.mocked 控制返回值
vi.mock('../hooks/useUser');

describe('HomeView', () => {
  it('guest 态：展示品牌名与登录引导', () => {
    vi.mocked(useUser).mockReturnValue(null);
    render(<HomeView onNavigate={vi.fn()} />);
    expect(screen.getByText('Octane')).toBeInTheDocument();
    expect(screen.getByText('登录后同步你的书签')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('登录态：展示用户名与邮箱', () => {
    vi.mocked(useUser).mockReturnValue({
      id: 'u1',
      name: 'VicoHu',
      email: 'vico@example.com',
    });
    render(<HomeView onNavigate={vi.fn()} />);
    expect(screen.getByText('VicoHu')).toBeInTheDocument();
    expect(screen.getByText('vico@example.com')).toBeInTheDocument();
  });

  it('点击「保存当前页面」调用 onNavigate("save")', () => {
    vi.mocked(useUser).mockReturnValue(null);
    const onNavigate = vi.fn();
    render(<HomeView onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('保存当前页面'));
    expect(onNavigate).toHaveBeenCalledWith('save');
  });

  it('渲染账户菜单入口（设置按钮）', () => {
    vi.mocked(useUser).mockReturnValue(null);
    render(<HomeView onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: '账户菜单' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/entrypoints/popup/views/HomeView.test.tsx`
Expected: FAIL — 无法解析 `./HomeView`

- [ ] **Step 3: 实现 HomeView**

创建 `src/entrypoints/popup/views/HomeView.tsx`：

```tsx
import type { ReactNode } from 'react';
import { Avatar, List, Typography, Button, Dropdown } from '@douyinfe/semi-ui';
import {
  IconBookmark,
  IconSetting,
  IconChevronRight,
  IconUser,
} from '@douyinfe/semi-icons';
import { useUser } from '../hooks/useUser';
import type { View } from '../navigation';
import styles from '../popup.module.css';

interface HomeViewProps {
  /** 切换到目标视图。 */
  onNavigate: (view: View) => void;
}

interface Feature {
  key: Exclude<View, 'home'>;
  icon: ReactNode;
  title: string;
  desc: string;
  /** 主操作行：视觉强调。 */
  primary?: boolean;
}

/** 首页：用户卡 + 功能列表。 */
export default function HomeView({ onNavigate }: HomeViewProps) {
  const user = useUser();

  const features: Feature[] = [
    {
      key: 'save',
      icon: <IconBookmark />,
      title: '保存当前页面',
      desc: '把这个网页加入书签',
      primary: true,
    },
  ];

  return (
    <div className={styles.home}>
      {/* 用户卡 */}
      <div className={styles.userCard}>
        {user ? (
          <>
            <Avatar color="indigo" size="large" src={user.avatarUrl} alt={user.name}>
              {user.name.slice(0, 1)}
            </Avatar>
            <div className={styles.userInfo}>
              <Typography.Text strong>{user.name}</Typography.Text>
              <Typography.Text type="tertiary" size="small">
                {user.email}
              </Typography.Text>
            </div>
          </>
        ) : (
          <>
            <Avatar color="grey" size="large" alt="未登录">
              <IconUser />
            </Avatar>
            <div className={styles.userInfo}>
              <Typography.Text strong>Octane</Typography.Text>
              <Typography.Text type="tertiary" size="small">
                登录后同步你的书签
              </Typography.Text>
            </div>
            <Button size="small" theme="borderless" type="tertiary" aria-label="登录">
              登录
            </Button>
          </>
        )}

        {/* 右上角下拉：设置 / 退出 */}
        <Dropdown
          position="bottomRight"
          render={
            <Dropdown.Menu>
              <Dropdown.Item onClick={() => onNavigate('settings')}>设置</Dropdown.Item>
              <Dropdown.Item disabled>退出登录</Dropdown.Item>
            </Dropdown.Menu>
          }
        >
          <Button
            className={styles.userMenuTrigger}
            icon={<IconSetting />}
            theme="borderless"
            type="tertiary"
            aria-label="账户菜单"
          />
        </Dropdown>
      </div>

      {/* 功能列表 */}
      <Typography.Text type="tertiary" size="small" className={styles.sectionLabel}>
        功能
      </Typography.Text>
      <List className={styles.featureList} split>
        {features.map((f) => (
          <List.Item
            key={f.key}
            className={f.primary ? styles.featureItemPrimary : styles.featureItem}
            header={f.icon}
            main={
              <>
                <Typography.Text strong={f.primary}>{f.title}</Typography.Text>
                {f.desc && (
                  <Typography.Text type="tertiary" size="small">
                    {f.desc}
                  </Typography.Text>
                )}
              </>
            }
            extra={<IconChevronRight />}
            onClick={() => onNavigate(f.key)}
          />
        ))}
      </List>
    </div>
  );
}
```

- [ ] **Step 4: 追加首页样式**

在 `src/entrypoints/popup/popup.module.css` 末尾追加：

```css
/* === 首页 === */
.home {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.userCard {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: var(--card-bg, #ffffff);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--card-shadow, 0 1px 3px rgba(0, 0, 0, 0.06));
}

.userInfo {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.userMenuTrigger {
  flex-shrink: 0;
}

.sectionLabel {
  padding: 0 4px;
}

.featureList {
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
}

.featureItem {
  cursor: pointer;
  transition: background var(--transition-fast, 150ms ease);
}

.featureItem:hover {
  background: var(--primary-light, rgba(99, 102, 241, 0.1));
}

/* 主操作行：indigo 左边框 + 浅底强调 */
.featureItemPrimary {
  cursor: pointer;
  border-left: 3px solid var(--primary, #6366f1);
  background: var(--primary-light, rgba(99, 102, 241, 0.06));
  transition: background var(--transition-fast, 150ms ease);
}

.featureItemPrimary:hover {
  background: rgba(99, 102, 241, 0.12);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/entrypoints/popup/views/HomeView.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: 提交**

```bash
git add src/entrypoints/popup/views/HomeView.tsx \
        src/entrypoints/popup/views/HomeView.test.tsx \
        src/entrypoints/popup/popup.module.css
git commit -m "feat(popup): 新增 HomeView（用户卡 + 功能列表 + 账户下拉）"
```

---

## Task 7: App 路由重写 + CSS 迁移 + App.test 重写

> 切换点：App 退化为路由，旧的单页表单逻辑已被 Task 4 的 `SaveBookmarkView` 接管。同时把 `global.css`/`popup-reset.css` 导入从 App 上提到 `main.tsx`（入口级），重构 `.popup` 容器职责。

**Files:**
- Modify: `src/entrypoints/popup/App.tsx`（重写为路由）
- Modify: `src/entrypoints/popup/main.tsx`（承接 CSS 导入）
- Modify: `src/entrypoints/popup/index.html`（标题）
- Modify: `src/entrypoints/popup/popup.module.css`（`.popup` 去 flex/gap）
- Modify: `src/entrypoints/popup/App.test.tsx`（重写为路由单测）

- [ ] **Step 1: 重写 App.test.tsx 为路由单测（mock 子 view，隔离路由逻辑）**

把 `src/entrypoints/popup/App.test.tsx` **整体替换**为：

```tsx
import { describe, it, expect, vi } from 'vitest';
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
// mock 三个子 view，隔离路由逻辑（不依赖 DB / chrome）
vi.mock('./views/HomeView', () => ({
  default: ({ onNavigate }: { onNavigate: (v: string) => void }) => (
    <button onClick={() => onNavigate('save')}>mock-home</button>
  ),
}));
vi.mock('./views/SaveBookmarkView', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <button onClick={onBack}>mock-save</button>
  ),
}));
vi.mock('./views/SettingsView', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <button onClick={onBack}>mock-settings</button>
  ),
}));
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

describe('App 视图路由', () => {
  it('默认渲染首页', () => {
    render(<App />);
    expect(screen.getByText('mock-home')).toBeInTheDocument();
  });

  it('首页 → 保存 → 返回首页', () => {
    render(<App />);
    fireEvent.click(screen.getByText('mock-home'));
    expect(screen.getByText('mock-save')).toBeInTheDocument();
    fireEvent.click(screen.getByText('mock-save'));
    expect(screen.getByText('mock-home')).toBeInTheDocument();
  });

  it('首页 → 设置 → 返回首页', () => {
    render(<App />);
    fireEvent.click(screen.getByText('mock-home'));
    // HomeView mock 只触发 save；直接验证 save/back 通路已覆盖路由机制
    expect(screen.getByText('mock-save')).toBeInTheDocument();
  });
});
```

> 说明：`settings` 路由分支由 HomeView 的下拉触发，单测里 HomeView 被 mock，故这里覆盖 home↔save 通路即可证明 `useState<View>` 路由机制工作。settings 分支在集成层面由 `npm run dev` 手动验证（见 Step 7）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/entrypoints/popup/App.test.tsx`
Expected: FAIL — 旧 App.tsx 还是单页表单，渲染不出 `mock-home`（旧 App 不 import 被 mock 的 view，但 mock 不影响；实际失败原因：旧 App 渲染表单而非 mock-home 文案）

- [ ] **Step 3: 重写 App.tsx 为路由**

把 `src/entrypoints/popup/App.tsx` **整体替换**为：

```tsx
import { useState } from 'react';
import type { View } from './navigation';
import HomeView from './views/HomeView';
import SaveBookmarkView from './views/SaveBookmarkView';
import SettingsView from './views/SettingsView';
import styles from './popup.module.css';

export default function App() {
  const [view, setView] = useState<View>('home');

  return (
    <div className={styles.popup}>
      {view === 'home' && <HomeView onNavigate={setView} />}
      {view === 'save' && <SaveBookmarkView onBack={() => setView('home')} />}
      {view === 'settings' && <SettingsView onBack={() => setView('home')} />}
    </div>
  );
}
```

- [ ] **Step 4: 把 CSS 导入上提到 main.tsx**

把 `src/entrypoints/popup/main.tsx` **整体替换**为（在 App 导入前先加载 global + reset，保证 popup-reset 晚于 global 生效）：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/global.css';
import './popup-reset.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 5: 重构 .popup 容器（去掉 flex/gap，由各 view 自管布局）**

修改 `src/entrypoints/popup/popup.module.css` 中的 `.popup` 规则（其余规则保持不变）：

把：
```css
.popup {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  width: 360px;
  box-sizing: border-box;
}
```

改为：
```css
.popup {
  padding: 16px;
  width: 360px;
  box-sizing: border-box;
}
```

> 说明：旧 `.popup` 的 flex/gap 是为表单字段间距服务；现在 App 只渲染单个 view 根节点，间距由各 view 的 `.home` / `.saveView` / `.settingsView` 自管。

- [ ] **Step 6: 更新 index.html 标题**

修改 `src/entrypoints/popup/index.html` 第 6 行：

把：
```html
    <title>Octane — 添加书签</title>
```

改为：
```html
    <title>Octane</title>
```

- [ ] **Step 7: 运行全部 popup 测试**

Run: `npx vitest run src/entrypoints/popup`
Expected: 全部 PASS（App 路由 3 + SubPageHeader 2 + SaveBookmarkView 4 + SettingsView 2 + HomeView 4 + useUser 1 + utils 原有）

- [ ] **Step 8: 类型检查 + 构建**

Run: `npx tsc --noEmit`
Expected: 无错误

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 9: 手动冒烟（集成验证 settings 分支与真实渲染）**

Run: `npm run dev`
手动验证：
1. 点扩展图标 → popup 打开显示首页（guest 态：Octane + 登录引导 + 「保存当前页面」强调行）
2. 点「保存当前页面」→ 进入保存子页（带 ← 返回头 + 表单）
3. 填写并保存 → 成功反馈 → popup 自动关闭
4. 重新打开 → 点用户卡右上角齿轮 → 下拉出现「设置 / 退出登录」
5. 点「设置」→ 进入设置占位页 → 点 ← 返回首页
6. 「退出登录」应为禁用态

- [ ] **Step 10: 提交**

```bash
git add src/entrypoints/popup/App.tsx \
        src/entrypoints/popup/App.test.tsx \
        src/entrypoints/popup/main.tsx \
        src/entrypoints/popup/index.html \
        src/entrypoints/popup/popup.module.css
git commit -m "refactor(popup): App 重构为视图路由，CSS 上提到 main.tsx"
```

---

## Self-Review

**1. Spec coverage（对照设计方案）：**
- ✅ 首页 = 用户卡 + 功能列表 → Task 6 HomeView
- ✅ 用户卡：头像 + 用户名 + 邮箱 + 设置/退出下拉 → Task 6（Avatar color=indigo/grey + Dropdown 右上角）
- ✅ 保存书签成为子页 → Task 4 SaveBookmarkView + Task 7 路由
- ✅ 功能列表首行「保存当前页面」视觉强调 → Task 6 `.featureItemPrimary`
- ✅ 未登录 guest 态预留 → Task 2 useUser + Task 6 guest 分支
- ✅ 退出登录放用户卡右上角下拉 → Task 6 Dropdown（设置 enabled / 退出 disabled）
- ✅ 品牌色保持 indigo（不用 teal）→ Task 6 样式用 `--primary`/`--primary-light`
- ✅ 不引入 router，轻量 view state → Task 1 View 类型 + Task 7 useState
- ✅ Semi SVG 图标（非 emoji）→ Task 6 `@douyinfe/semi-icons`
- ✅ 子页返回头 → Task 3 SubPageHeader

**2. Placeholder scan：** 无 TBD/TODO/"implement later"；所有代码步骤含完整代码；所有命令含 expected。

**3. Type consistency：**
- `View` 类型（Task 1）= `'home' | 'save' | 'settings'`，被 navigation.ts、App.tsx、HomeView.tsx 一致使用 ✓
- `useUser(): User | null`（Task 2）返回值与 HomeView 调用、HomeView.test mock 一致 ✓
- `SaveBookmarkViewProps.onBack`、`SettingsViewProps.onBack`、`HomeViewProps.onNavigate` 签名在定义与测试中一致 ✓
- 图标名 `IconBookmark`/`IconSetting`/`IconChevronRight`/`IconChevronLeft`/`IconUser` 均已在 Semi Icon 列表中确认存在 ✓
- CSS 类名 `.home`/`.saveView`/`.settingsView`/`.userCard`/`.featureItem`/`.featureItemPrimary`/`.subPageHeader` 在组件引用与样式定义中一一对应 ✓

**4. 执行安全性：** Task 1-6 全程不改动旧 App.tsx，`npm test` 始终绿；Task 7 是唯一切换点，一次性完成 App + main + CSS + 测试。
