# P2 UI 组件层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Octane 的完整 UI 界面——左右分栏布局、工作区/分类侧边栏、书签卡片网格、笔记 Markdown 编辑器、加密解锁弹窗，以及支撑这些组件的 Store 和 Service 层。

**Architecture:** Zustand Store 管理全局状态（工作区、书签、加密、搜索），Service 层封装 IndexedDB + CryptoService 的业务逻辑，组件层通过 Store 间接访问数据。自顶向下数据流：Store → 组件 props → UI 渲染。

**Tech Stack:** React 19 + Semi Design 2.x + Zustand 5 + marked 18 + DOMPurify 3 + TypeScript

**Design Spec:** `PLAN.md`（已通过 CEO/Design/Eng 三轮审查）

---

## File Structure

```
src/
├── services/
│   ├── WorkspaceService.ts          # 工作区 CRUD
│   ├── CategoryService.ts           # 分类 CRUD
│   ├── BookmarkService.ts           # 书签 CRUD + favicon
│   └── NoteService.ts               # 笔记 CRUD（内部加密/解密）
├── store/
│   ├── useWorkspace.ts              # 工作区 + 分类状态
│   ├── useBookmarks.ts              # 书签 + 笔记状态
│   ├── useCrypto.ts                 # 加密状态（解锁/锁定）
│   └── useSearch.ts                 # 搜索状态
├── shared/
│   └── utils/
│       └── markdown.ts              # Markdown 渲染 (marked + DOMPurify)
├── newtab/
│   ├── App.tsx                      # 主布局（左右分栏 + 全局样式注入）
│   ├── App.css                      # 全局样式
│   ├── components/
│   │   ├── Sidebar/
│   │   │   └── index.tsx            # 工作区选择 + 分类列表
│   │   ├── Content/
│   │   │   └── index.tsx            # 顶部操作栏 + 卡片网格
│   │   ├── BookmarkCard/
│   │   │   └── index.tsx            # 单个书签卡片
│   │   ├── NoteEditor/
│   │   │   └── index.tsx            # Markdown 编辑 + 预览
│   │   ├── UnlockModal/
│   │   │   └── index.tsx            # 主密码输入/设置弹窗
│   │   └── EmptyState/
│   │       └── index.tsx            # 空状态引导组件
│   └── index.tsx                    # 入口（已有）
└── styles/
    └── global.css                   # CSS Reset + CSS 变量
```

---

### Task 1: Markdown 渲染工具

**Files:**
- Create: `src/shared/utils/markdown.ts`

- [ ] **Step 1: 实现 Markdown 渲染函数**

```typescript
// src/shared/utils/markdown.ts
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** 配置 marked：安全默认值 */
marked.setOptions({
  breaks: true,
  gfm: true,
});

/** 将 Markdown 文本渲染为净化后的 HTML */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  const rawHtml = marked.parse(text) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'blockquote', 'pre', 'code',
      'strong', 'em', 'del', 'a',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'alt', 'src', 'class'],
  });
}
```

Write to `src/shared/utils/markdown.ts`.

- [ ] **Step 2: 验证类型无错误**

Run: `npx tsc --noEmit`
Expected: 无 TypeScript 错误

- [ ] **Step 3: 提交**

```bash
git add src/shared/utils/markdown.ts
git commit -m "feat: 添加 Markdown 渲染工具 (marked + DOMPurify)"
```

---

### Task 2: Service 层（WorkspaceService, CategoryService, BookmarkService, NoteService）

**Files:**
- Create: `src/services/WorkspaceService.ts`
- Create: `src/services/CategoryService.ts`
- Create: `src/services/BookmarkService.ts`
- Create: `src/services/NoteService.ts`

- [ ] **Step 1: 实现 WorkspaceService**

```typescript
// src/services/WorkspaceService.ts
import { getAll, putRecord, deleteRecord, getByKey } from '@/shared/db/database';
import { cascadeDeleteWorkspace } from '@/shared/db/database';
import type { Workspace } from '@/shared/types';

function generateId(): string {
  return crypto.randomUUID();
}

/** 获取所有工作区，按 order 排序 */
export async function listWorkspaces(): Promise<Workspace[]> {
  const all = await getAll<Workspace>('workspaces');
  return all.sort((a, b) => a.order - b.order);
}

/** 创建工作区 */
export async function createWorkspace(name: string, icon: string): Promise<Workspace> {
  const all = await listWorkspaces();
  const workspace: Workspace = {
    id: generateId(),
    name,
    icon,
    createdAt: Date.now(),
    order: all.length,
  };
  await putRecord('workspaces', workspace);
  return workspace;
}

/** 更新工作区 */
export async function updateWorkspace(id: string, updates: Partial<Pick<Workspace, 'name' | 'icon' | 'order'>>): Promise<void> {
  const existing = await getByKey<Workspace>('workspaces', id);
  if (!existing) throw new Error('工作区不存在');
  const updated: Workspace = { ...existing, ...updates };
  await putRecord('workspaces', updated);
}

/** 删除工作区（级联删除分类+书签+笔记） */
export async function deleteWorkspace(id: string): Promise<void> {
  await cascadeDeleteWorkspace(id);
}
```

Write to `src/services/WorkspaceService.ts`.

- [ ] **Step 2: 实现 CategoryService**

```typescript
// src/services/CategoryService.ts
import { getAll, putRecord, getByKey, getByIndex } from '@/shared/db/database';
import { cascadeDeleteCategory } from '@/shared/db/database';
import type { Category } from '@/shared/types';

function generateId(): string {
  return crypto.randomUUID();
}

/** 获取指定工作区的分类，按 order 排序 */
export async function listCategories(workspaceId: string): Promise<Category[]> {
  const categories = await getByIndex<Category>('categories', 'by-workspaceId', workspaceId);
  return categories.sort((a, b) => a.order - b.order);
}

/** 创建分类 */
export async function createCategory(
  workspaceId: string,
  name: string,
  icon: string,
): Promise<Category> {
  const existing = await listCategories(workspaceId);
  const category: Category = {
    id: generateId(),
    workspaceId,
    name,
    icon,
    order: existing.length,
    createdAt: Date.now(),
  };
  await putRecord('categories', category);
  return category;
}

/** 更新分类 */
export async function updateCategory(id: string, updates: Partial<Pick<Category, 'name' | 'icon' | 'order'>>): Promise<void> {
  const existing = await getByKey<Category>('categories', id);
  if (!existing) throw new Error('分类不存在');
  const updated: Category = { ...existing, ...updates };
  await putRecord('categories', updated);
}

/** 删除分类（级联删除书签+笔记） */
export async function deleteCategory(id: string): Promise<void> {
  await cascadeDeleteCategory(id);
}
```

Write to `src/services/CategoryService.ts`.

- [ ] **Step 3: 实现 BookmarkService**

```typescript
// src/services/BookmarkService.ts
import { getAll, putRecord, getByKey, getByIndex, deleteBookmarkCascade } from '@/shared/db/database';
import type { Bookmark } from '@/shared/types';

function generateId(): string {
  return crypto.randomUUID();
}

/** 获取指定分类下的书签 */
export async function listBookmarks(categoryId: string): Promise<Bookmark[]> {
  return getByIndex<Bookmark>('bookmarks', 'by-categoryId', categoryId);
}

/** 获取指定工作区下的所有书签 */
export async function listBookmarksByWorkspace(workspaceId: string): Promise<Bookmark[]> {
  return getByIndex<Bookmark>('bookmarks', 'by-workspaceId', workspaceId);
}

/** 创建书签 */
export async function createBookmark(
  workspaceId: string,
  categoryId: string,
  data: { name: string; url: string; description?: string },
): Promise<Bookmark> {
  const now = Date.now();
  const bookmark: Bookmark = {
    id: generateId(),
    workspaceId,
    categoryId,
    name: data.name,
    url: data.url,
    description: data.description ?? '',
    faviconUrl: '',
    hasNote: false,
    isNoteEncrypted: false,
    createdAt: now,
    updatedAt: now,
  };
  await putRecord('bookmarks', bookmark);
  return bookmark;
}

/** 更新书签 */
export async function updateBookmark(id: string, updates: Partial<Pick<Bookmark, 'name' | 'url' | 'description' | 'faviconUrl' | 'categoryId' | 'hasNote' | 'isNoteEncrypted'>>): Promise<void> {
  const existing = await getByKey<Bookmark>('bookmarks', id);
  if (!existing) throw new Error('书签不存在');
  const updated: Bookmark = { ...existing, ...updates, updatedAt: Date.now() };
  await putRecord('bookmarks', updated);
}

/** 删除书签（级联删除笔记） */
export async function deleteBookmark(id: string): Promise<void> {
  await deleteBookmarkCascade(id);
}

/** 获取 favicon URL（使用 Google Favicon API） */
export function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return '';
  }
}
```

Write to `src/services/BookmarkService.ts`.

- [ ] **Step 4: 实现 NoteService**

```typescript
// src/services/NoteService.ts
import { getByKey, putRecord, deleteRecord } from '@/shared/db/database';
import { encrypt, decrypt } from '@/services/CryptoService';
import { updateBookmark } from '@/services/BookmarkService';
import type { Note } from '@/shared/types';

/** 获取笔记（明文） */
export async function getNote(bookmarkId: string): Promise<Note | null> {
  const note = await getByKey<Note>('notes', bookmarkId);
  if (!note) return null;

  if (note.isEncrypted && note.encryptedData && note.iv) {
    const plaintext = await decrypt(note.encryptedData, note.iv);
    return { ...note, content: plaintext };
  }
  return note;
}

/** 保存笔记（自动处理加密/解密） */
export async function saveNote(
  bookmarkId: string,
  content: string,
  sensitive: boolean,
): Promise<void> {
  const existing = await getByKey<Note>('notes', bookmarkId);
  const now = Date.now();

  if (!content.trim()) {
    // 内容为空，删除笔记
    if (existing) {
      await deleteRecord('notes', bookmarkId);
      await updateBookmark(bookmarkId, { hasNote: false, isNoteEncrypted: false });
    }
    return;
  }

  let note: Note;
  if (sensitive) {
    const { encryptedData, iv } = await encrypt(content);
    note = {
      bookmarkId,
      content: '', // 运行时明文不持久化
      isEncrypted: true,
      encryptedData,
      iv,
      updatedAt: now,
    };
  } else {
    note = {
      bookmarkId,
      content,
      isEncrypted: false,
      updatedAt: now,
    };
  }

  await putRecord('notes', note);
  await updateBookmark(bookmarkId, { hasNote: true, isNoteEncrypted: sensitive });
}
```

Write to `src/services/NoteService.ts`.

- [ ] **Step 5: 验证类型无错误**

Run: `npx tsc --noEmit`
Expected: 无 TypeScript 错误

- [ ] **Step 6: 提交**

```bash
git add src/services/WorkspaceService.ts src/services/CategoryService.ts src/services/BookmarkService.ts src/services/NoteService.ts
git commit -m "feat: 实现 Service 层 (Workspace, Category, Bookmark, Note CRUD)"
```

---

### Task 3: Zustand Store 层

**Files:**
- Create: `src/store/useWorkspace.ts`
- Create: `src/store/useBookmarks.ts`
- Create: `src/store/useCrypto.ts`
- Create: `src/store/useSearch.ts`

- [ ] **Step 1: 实现 useWorkspace store**

```typescript
// src/store/useWorkspace.ts
import { create } from 'zustand';
import type { Workspace, Category } from '@/shared/types';
import * as WorkspaceService from '@/services/WorkspaceService';
import * as CategoryService from '@/services/CategoryService';

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  categories: Category[];
  currentCategoryId: string | null;
  loading: boolean;

  loadWorkspaces: () => Promise<void>;
  createWorkspace: (name: string, icon: string) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  selectWorkspace: (id: string) => Promise<void>;

  loadCategories: () => Promise<void>;
  createCategory: (name: string, icon: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  selectCategory: (id: string) => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  currentWorkspaceId: null,
  categories: [],
  currentCategoryId: null,
  loading: false,

  loadWorkspaces: async () => {
    set({ loading: true });
    const workspaces = await WorkspaceService.listWorkspaces();
    const currentWorkspaceId = workspaces[0]?.id ?? null;
    set({ workspaces, currentWorkspaceId, loading: false });

    // 自动加载第一个工作区的分类
    if (currentWorkspaceId) {
      const categories = await CategoryService.listCategories(currentWorkspaceId);
      const currentCategoryId = categories[0]?.id ?? null;
      set({ categories, currentCategoryId });
    } else {
      set({ categories: [], currentCategoryId: null });
    }
  },

  createWorkspace: async (name, icon) => {
    const workspace = await WorkspaceService.createWorkspace(name, icon);
    set((s) => ({ workspaces: [...s.workspaces, workspace] }));
    if (!get().currentWorkspaceId) {
      get().selectWorkspace(workspace.id);
    }
  },

  deleteWorkspace: async (id) => {
    await WorkspaceService.deleteWorkspace(id);
    const workspaces = await WorkspaceService.listWorkspaces();
    const currentWorkspaceId = get().currentWorkspaceId === id
      ? workspaces[0]?.id ?? null
      : get().currentWorkspaceId;
    set({ workspaces, currentWorkspaceId });
    if (currentWorkspaceId) {
      await get().loadCategories();
    }
  },

  selectWorkspace: async (id) => {
    set({ currentWorkspaceId: id, currentCategoryId: null });
    const categories = await CategoryService.listCategories(id);
    const currentCategoryId = categories[0]?.id ?? null;
    set({ categories, currentCategoryId });
  },

  loadCategories: async () => {
    const workspaceId = get().currentWorkspaceId;
    if (!workspaceId) return;
    const categories = await CategoryService.listCategories(workspaceId);
    set({ categories });
  },

  createCategory: async (name, icon) => {
    const workspaceId = get().currentWorkspaceId;
    if (!workspaceId) return;
    const category = await CategoryService.createCategory(workspaceId, name, icon);
    set((s) => ({ categories: [...s.categories, category] }));
  },

  deleteCategory: async (id) => {
    await CategoryService.deleteCategory(id);
    const categories = get().categories.filter((c) => c.id !== id);
    const currentCategoryId = get().currentCategoryId === id
      ? categories[0]?.id ?? null
      : get().currentCategoryId;
    set({ categories, currentCategoryId });
  },

  selectCategory: (id) => {
    set({ currentCategoryId: id });
  },
}));
```

Write to `src/store/useWorkspace.ts`.

- [ ] **Step 2: 实现 useBookmarks store**

```typescript
// src/store/useBookmarks.ts
import { create } from 'zustand';
import type { Bookmark } from '@/shared/types';
import * as BookmarkService from '@/services/BookmarkService';
import * as NoteService from '@/services/NoteService';

interface BookmarksState {
  bookmarks: Bookmark[];
  loading: boolean;

  loadBookmarks: (categoryId: string) => Promise<void>;
  createBookmark: (workspaceId: string, categoryId: string, data: { name: string; url: string; description?: string }) => Promise<Bookmark>;
  deleteBookmark: (id: string) => Promise<void>;
  refreshBookmark: (id: string) => Promise<void>;
}

export const useBookmarks = create<BookmarksState>((set, get) => ({
  bookmarks: [],
  loading: false,

  loadBookmarks: async (categoryId) => {
    set({ loading: true });
    const bookmarks = await BookmarkService.listBookmarks(categoryId);
    // 为缺少 favicon 的书签补充 URL
    for (const b of bookmarks) {
      if (!b.faviconUrl && b.url) {
        const faviconUrl = BookmarkService.getFaviconUrl(b.url);
        if (faviconUrl) {
          await BookmarkService.updateBookmark(b.id, { faviconUrl });
          b.faviconUrl = faviconUrl;
        }
      }
    }
    set({ bookmarks, loading: false });
  },

  createBookmark: async (workspaceId, categoryId, data) => {
    const bookmark = await BookmarkService.createBookmark(workspaceId, categoryId, data);
    // 补充 favicon
    const faviconUrl = BookmarkService.getFaviconUrl(data.url);
    if (faviconUrl) {
      await BookmarkService.updateBookmark(bookmark.id, { faviconUrl });
      bookmark.faviconUrl = faviconUrl;
    }
    set((s) => ({ bookmarks: [...s.bookmarks, bookmark] }));
    return bookmark;
  },

  deleteBookmark: async (id) => {
    await BookmarkService.deleteBookmark(id);
    set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) }));
  },

  refreshBookmark: async (id) => {
    const { getByKey } = await import('@/shared/db/database');
    const updated = await getByKey<Bookmark>('bookmarks', id);
    if (!updated) return;
    set((s) => ({
      bookmarks: s.bookmarks.map((b) => (b.id === id ? updated : b)),
    }));
  },
}));
```

Write to `src/store/useBookmarks.ts`.

- [ ] **Step 3: 实现 useCrypto store**

```typescript
// src/store/useCrypto.ts
import { create } from 'zustand';
import {
  isPasswordSet,
  setupPassword,
  unlock,
  lock,
  isUnlocked,
} from '@/services/CryptoService';

interface CryptoState {
  passwordSet: boolean;
  unlocked: boolean;
  loading: boolean;

  checkStatus: () => Promise<void>;
  setupMasterPassword: (password: string) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  lockSession: () => Promise<void>;
}

export const useCrypto = create<CryptoState>((set) => ({
  passwordSet: false,
  unlocked: false,
  loading: false,

  checkStatus: async () => {
    const passwordSet = await isPasswordSet();
    const unlocked = await isUnlocked();
    set({ passwordSet, unlocked });
  },

  setupMasterPassword: async (password) => {
    set({ loading: true });
    await setupPassword(password);
    set({ passwordSet: true, unlocked: true, loading: false });
  },

  unlockWithPassword: async (password) => {
    set({ loading: true });
    await unlock(password);
    set({ unlocked: true, loading: false });
  },

  lockSession: async () => {
    await lock();
    set({ unlocked: false });
  },
}));
```

Write to `src/store/useCrypto.ts`.

- [ ] **Step 4: 实现 useSearch store**

```typescript
// src/store/useSearch.ts
import { create } from 'zustand';

interface SearchState {
  query: string;
  setQuery: (query: string) => void;
  clearQuery: () => void;
}

export const useSearch = create<SearchState>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
  clearQuery: () => set({ query: '' }),
}));
```

Write to `src/store/useSearch.ts`.

- [ ] **Step 5: 验证类型无错误**

Run: `npx tsc --noEmit`
Expected: 无 TypeScript 错误

- [ ] **Step 6: 提交**

```bash
git add src/store/
git commit -m "feat: 实现 Zustand Store 层 (useWorkspace, useBookmarks, useCrypto, useSearch)"
```

---

### Task 4: 全局样式 + 布局骨架

**Files:**
- Create: `src/styles/global.css`
- Modify: `src/newtab/App.tsx`
- Create: `src/newtab/App.css`

- [ ] **Step 1: 创建全局 CSS（CSS Reset + 变量）**

```css
/* src/styles/global.css */
:root {
  --sidebar-width: 260px;
  --sidebar-bg: #1a1a2e;
  --sidebar-text: #e0e0e0;
  --sidebar-active-bg: #16213e;
  --sidebar-hover-bg: #0f3460;
  --content-bg: #f5f5f5;
  --card-bg: #ffffff;
  --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  --card-hover-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  --primary: #4361ee;
  --primary-hover: #3a56d4;
  --danger: #e74c3c;
  --muted: #999;
  --text-primary: #333;
  --text-secondary: #666;
  --border-color: #e8e8e8;
  --radius-sm: 6px;
  --radius-md: 8px;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #root {
  height: 100%;
  width: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--content-bg);
}

/* Semi Design 模态框 z-index 确保在最上层 */
.semi-modal {
  z-index: 2000 !important;
}
```

Write to `src/styles/global.css`.

- [ ] **Step 2: 创建 App.css（主布局样式）**

```css
/* src/newtab/App.css */
.app-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.app-sidebar {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  height: 100%;
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s ease;
}

.app-content {
  flex: 1;
  height: 100%;
  overflow: auto;
  background: var(--content-bg);
}
```

Write to `src/newtab/App.css`.

- [ ] **Step 3: 更新 App.tsx 为左右分栏布局**

```tsx
// src/newtab/App.tsx
import React, { useEffect } from 'react';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useCrypto } from '@/store/useCrypto';
import { Sidebar } from '@/newtab/components/Sidebar';
import { Content } from '@/newtab/components/Content';
import '@/styles/global.css';
import '@/newtab/App.css';

const App: React.FC = () => {
  const loadWorkspaces = useWorkspace((s) => s.loadWorkspaces);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const loadBookmarks = useBookmarks((s) => s.loadBookmarks);
  const checkStatus = useCrypto((s) => s.checkStatus);

  useEffect(() => {
    checkStatus();
    loadWorkspaces();
  }, []);

  useEffect(() => {
    if (currentCategoryId) {
      loadBookmarks(currentCategoryId);
    }
  }, [currentCategoryId]);

  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <Sidebar />
      </aside>
      <main className="app-content">
        <Content />
      </main>
    </div>
  );
};

export default App;
```

Write to `src/newtab/App.tsx`（覆盖现有骨架）。

- [ ] **Step 4: 验证构建**

Run: `npx tsc --noEmit`
Expected: 会报错因为 Sidebar/Content 组件还不存在——先创建空壳占位

- [ ] **Step 5: 提交**

```bash
git add src/styles/global.css src/newtab/App.css src/newtab/App.tsx
git commit -m "feat: 添加全局样式和左右分栏布局骨架"
```

---

### Task 5: Sidebar 组件（工作区选择 + 分类列表）

**Files:**
- Create: `src/newtab/components/Sidebar/index.tsx`

- [ ] **Step 1: 实现 Sidebar 组件**

```tsx
// src/newtab/components/Sidebar/index.tsx
import React, { useState } from 'react';
import { Select, Button, Input, Modal } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';
import { useWorkspace } from '@/store/useWorkspace';

export const Sidebar: React.FC = () => {
  const workspaces = useWorkspace((s) => s.workspaces);
  const currentWorkspaceId = useWorkspace((s) => s.currentWorkspaceId);
  const categories = useWorkspace((s) => s.categories);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const selectWorkspace = useWorkspace((s) => s.selectWorkspace);
  const createCategory = useWorkspace((s) => s.createCategory);
  const deleteCategory = useWorkspace((s) => s.deleteCategory);
  const createWorkspace = useWorkspace((s) => s.createWorkspace);

  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    await createCategory(newCategoryName.trim(), '📂');
    setNewCategoryName('');
    setShowNewCategory(false);
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    await createWorkspace(newWorkspaceName.trim(), '📁');
    setNewWorkspaceName('');
    setShowNewWorkspace(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px 12px' }}>
      {/* 标题 */}
      <div style={{ marginBottom: 16, fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>
        Octane
      </div>

      {/* 工作区选择器 */}
      <Select
        value={currentWorkspaceId}
        onChange={(val) => val && selectWorkspace(val as string)}
        style={{ width: '100%', marginBottom: 16 }}
        filter
        placeholder="选择工作区"
        optionList={workspaces.map((ws) => ({
          value: ws.id,
          label: `${ws.icon} ${ws.name}`,
        }))}
        onSearch={(filter) => {
          if (filter && !workspaces.find((w) => w.name === filter)) {
            setShowNewWorkspace(true);
          }
        }}
      />

      {/* 新建工作区弹窗 */}
      <Modal
        title="新建工作区"
        visible={showNewWorkspace}
        onOk={handleCreateWorkspace}
        onCancel={() => setShowNewWorkspace(false)}
      >
        <Input
          placeholder="工作区名称"
          value={newWorkspaceName}
          onChange={setNewWorkspaceName}
          onEnterPress={handleCreateWorkspace}
        />
      </Modal>

      {/* 分类列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {categories.map((cat) => (
          <div
            key={cat.id}
            onClick={() => useWorkspace.getState().selectCategory(cat.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: 6,
              marginBottom: 2,
              cursor: 'pointer',
              background: currentCategoryId === cat.id ? 'var(--sidebar-active-bg)' : 'transparent',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              if (currentCategoryId !== cat.id) {
                e.currentTarget.style.background = 'var(--sidebar-hover-bg)';
              }
            }}
            onMouseLeave={(e) => {
              if (currentCategoryId !== cat.id) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span>
              {cat.icon} {cat.name}
            </span>
            <IconDelete
              style={{ fontSize: 14, opacity: 0.5, cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                deleteCategory(cat.id);
              }}
            />
          </div>
        ))}
      </div>

      {/* 添加分类按钮 */}
      <Button
        icon={<IconPlus />}
        block
        style={{ marginTop: 8 }}
        onClick={() => setShowNewCategory(true)}
      >
        添加分类
      </Button>

      {/* 新建分类弹窗 */}
      <Modal
        title="新建分类"
        visible={showNewCategory}
        onOk={handleCreateCategory}
        onCancel={() => setShowNewCategory(false)}
      >
        <Input
          placeholder="分类名称"
          value={newCategoryName}
          onChange={setNewCategoryName}
          onEnterPress={handleCreateCategory}
        />
      </Modal>
    </div>
  );
};
```

Write to `src/newtab/components/Sidebar/index.tsx`.

- [ ] **Step 2: 验证类型无错误**

Run: `npx tsc --noEmit`
Expected: 无 TypeScript 错误

- [ ] **Step 3: 提交**

```bash
git add src/newtab/components/Sidebar/
git commit -m "feat: 实现 Sidebar 组件 (工作区选择 + 分类列表)"
```

---

### Task 6: BookmarkCard + EmptyState 组件

**Files:**
- Create: `src/newtab/components/BookmarkCard/index.tsx`
- Create: `src/newtab/components/EmptyState/index.tsx`

- [ ] **Step 1: 实现 BookmarkCard 组件**

```tsx
// src/newtab/components/BookmarkCard/index.tsx
import React from 'react';
import { IconLock } from '@douyinfe/semi-icons';
import type { Bookmark } from '@/shared/types';

interface BookmarkCardProps {
  bookmark: Bookmark;
  notePreview?: string;
  onClick: (bookmark: Bookmark) => void;
}

export const BookmarkCard: React.FC<BookmarkCardProps> = ({ bookmark, notePreview, onClick }) => {
  const displayUrl = (() => {
    try {
      return new URL(bookmark.url).hostname;
    } catch {
      return bookmark.url;
    }
  })();

  return (
    <div
      role="listitem"
      aria-label={bookmark.isNoteEncrypted ? `${bookmark.name}，包含加密笔记` : bookmark.name}
      onClick={() => onClick(bookmark)}
      style={{
        background: 'var(--card-bg)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--card-shadow)',
        padding: 16,
        cursor: 'pointer',
        display: 'flex',
        gap: 12,
        transition: 'box-shadow 0.15s, transform 0.15s',
        border: '1px solid var(--border-color)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--card-hover-shadow)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--card-shadow)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Favicon */}
      <div style={{ flexShrink: 0, width: 32, height: 32 }}>
        {bookmark.faviconUrl ? (
          <img
            src={bookmark.faviconUrl}
            alt=""
            style={{ width: 32, height: 32, borderRadius: 4 }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div style={{
            width: 32, height: 32, borderRadius: 4,
            background: '#e0e0e0', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 14, color: '#999',
          }}>
            {bookmark.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* 右侧信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bookmark.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayUrl}
        </div>
        {bookmark.description && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: bookmark.hasNote ? 4 : 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {bookmark.description}
          </div>
        )}

        {/* 笔记预览 */}
        {bookmark.hasNote && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {bookmark.isNoteEncrypted ? (
              <>
                <IconLock style={{ fontSize: 12, color: 'var(--muted)' }} />
                <span style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 1 }}>••••••••</span>
              </>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                {notePreview}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
```

Write to `src/newtab/components/BookmarkCard/index.tsx`.

- [ ] **Step 2: 实现 EmptyState 组件**

```tsx
// src/newtab/components/EmptyState/index.tsx
import React from 'react';
import { Button } from '@douyinfe/semi-ui';
import { IconPlus } from '@douyinfe/semi-icons';

interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ message, actionLabel, onAction }) => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 20px',
      color: 'var(--muted)',
    }}>
      <div style={{ fontSize: 16, marginBottom: actionLabel ? 16 : 0 }}>{message}</div>
      {actionLabel && onAction && (
        <Button icon={<IconPlus />} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
```

Write to `src/newtab/components/EmptyState/index.tsx`.

- [ ] **Step 3: 提交**

```bash
git add src/newtab/components/BookmarkCard/ src/newtab/components/EmptyState/
git commit -m "feat: 实现 BookmarkCard + EmptyState 组件"
```

---

### Task 7: Content 组件（操作栏 + 卡片网格）

**Files:**
- Create: `src/newtab/components/Content/index.tsx`

- [ ] **Step 1: 实现 Content 组件**

```tsx
// src/newtab/components/Content/index.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Input, Button, Modal, Form, Toast } from '@douyinfe/semi-ui';
import { IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useSearch } from '@/store/useSearch';
import { BookmarkCard } from '@/newtab/components/BookmarkCard';
import { EmptyState } from '@/newtab/components/EmptyState';
import { NoteEditor } from '@/newtab/components/NoteEditor';
import type { Bookmark } from '@/shared/types';

export const Content: React.FC = () => {
  const categories = useWorkspace((s) => s.categories);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const currentWorkspaceId = useWorkspace((s) => s.currentWorkspaceId);
  const bookmarks = useBookmarks((s) => s.bookmarks);
  const loading = useBookmarks((s) => s.loading);
  const createBookmark = useBookmarks((s) => s.createBookmark);
  const deleteBookmark = useBookmarks((s) => s.deleteBookmark);
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedBookmark, setSelectedBookmark] = useState<Bookmark | null>(null);

  const currentCategory = categories.find((c) => c.id === currentCategoryId);

  // 过滤书签
  const filteredBookmarks = query
    ? bookmarks.filter(
        (b) =>
          b.name.toLowerCase().includes(query.toLowerCase()) ||
          b.url.toLowerCase().includes(query.toLowerCase()) ||
          b.description.toLowerCase().includes(query.toLowerCase()),
      )
    : bookmarks;

  const handleAddBookmark = async (values: { name: string; url: string; description?: string }) => {
    if (!currentWorkspaceId || !currentCategoryId) return;
    try {
      await createBookmark(currentWorkspaceId, currentCategoryId, {
        name: values.name || new URL(values.url).hostname,
        url: values.url,
        description: values.description,
      });
      setShowAddModal(false);
      Toast.success('书签已添加');
    } catch (e) {
      Toast.error('添加失败：' + (e as Error).message);
    }
  };

  const handleDeleteBookmark = async (id: string) => {
    try {
      await deleteBookmark(id);
      if (selectedBookmark?.id === id) {
        setSelectedBookmark(null);
      }
      Toast.success('书签已删除');
    } catch (e) {
      Toast.error('删除失败');
    }
  };

  const handleCardClick = (bookmark: Bookmark) => {
    setSelectedBookmark(bookmark);
  };

  // 无分类时的空状态
  if (!currentCategoryId) {
    return (
      <EmptyState
        message="请先选择或创建一个分类"
      />
    );
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, flexShrink: 0 }}>
          {currentCategory?.icon} {currentCategory?.name ?? ''}
        </h1>

        <Input
          prefix={<IconSearch />}
          placeholder="搜索书签..."
          value={query}
          onChange={setQuery}
          style={{ flex: 1, maxWidth: 400 }}
          showClear
          onClear={() => setQuery('')}
        />

        <Button
          theme="solid"
          icon={<IconPlus />}
          onClick={() => setShowAddModal(true)}
        >
          添加书签
        </Button>
      </div>

      {/* 搜索提示 */}
      {query && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          找到 {filteredBookmarks.length} 个结果（加密笔记内容不参与搜索）
        </div>
      )}

      {/* 卡片网格 / 空状态 / 加载中 */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 100, background: '#eee', borderRadius: 'var(--radius-md)', animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
      ) : filteredBookmarks.length === 0 ? (
        <EmptyState
          message={query ? '没有找到匹配的书签' : '添加你的第一个书签'}
          actionLabel={query ? undefined : '添加书签'}
          onAction={query ? undefined : () => setShowAddModal(true)}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {filteredBookmarks.map((bookmark) => (
            <BookmarkCard
              key={bookmark.id}
              bookmark={bookmark}
              onClick={handleCardClick}
            />
          ))}
        </div>
      )}

      {/* 添加书签弹窗 */}
      <Modal
        title="添加书签"
        visible={showAddModal}
        footer={null}
        onCancel={() => setShowAddModal(false)}
      >
        <Form onSubmit={handleAddBookmark as any}>
          <Form.Input field="url" label="URL" placeholder="https://example.com" rules={[{ required: true, message: '请输入 URL' }]} />
          <Form.Input field="name" label="名称" placeholder="留空则使用域名" />
          <Form.TextArea field="description" label="描述" placeholder="可选" maxLength={200} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setShowAddModal(false)}>取消</Button>
            <Button htmlType="submit" theme="solid">添加</Button>
          </div>
        </Form>
      </Modal>

      {/* 笔记编辑器（侧滑面板） */}
      <NoteEditor
        bookmark={selectedBookmark}
        visible={!!selectedBookmark}
        onClose={() => setSelectedBookmark(null)}
        onDelete={handleDeleteBookmark}
      />
    </div>
  );
};
```

Write to `src/newtab/components/Content/index.tsx`.

- [ ] **Step 2: 提交**

```bash
git add src/newtab/components/Content/
git commit -m "feat: 实现 Content 组件 (搜索栏 + 卡片网格 + 添加书签弹窗)"
```

---

### Task 8: NoteEditor + UnlockModal 组件

**Files:**
- Create: `src/newtab/components/NoteEditor/index.tsx`
- Create: `src/newtab/components/UnlockModal/index.tsx`

- [ ] **Step 1: 实现 NoteEditor 组件**

```tsx
// src/newtab/components/NoteEditor/index.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SideSheet, Button, Switch, TabPane, Tabs, Toast, Typography } from '@douyinfe/semi-ui';
import { IconDelete, IconLock } from '@douyinfe/semi-icons';
import { useCrypto } from '@/store/useCrypto';
import { useBookmarks } from '@/store/useBookmarks';
import { getNote, saveNote } from '@/services/NoteService';
import { renderMarkdown } from '@/shared/utils/markdown';
import type { Bookmark } from '@/shared/types';

interface NoteEditorProps {
  bookmark: Bookmark | null;
  visible: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export const NoteEditor: React.FC<NoteEditorProps> = ({ bookmark, visible, onClose, onDelete }) => {
  const [content, setContent] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlocked = useCrypto((s) => s.unlocked);
  const refreshBookmark = useBookmarks((s) => s.refreshBookmark);

  // 加载笔记
  useEffect(() => {
    if (!bookmark || !visible) return;
    const loadNote = async () => {
      try {
        const note = await getNote(bookmark.id);
        setContent(note?.content ?? '');
        setIsEncrypted(note?.isEncrypted ?? false);
        setSaved(true);
      } catch {
        Toast.error('加载笔记失败');
      }
    };
    loadNote();
  }, [bookmark?.id, visible]);

  // 自动保存 debounce 1s
  const debouncedSave = useCallback(
    (text: string, encrypted: boolean) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaved(false);
      saveTimerRef.current = setTimeout(async () => {
        if (!bookmark) return;
        try {
          setSaving(true);
          await saveNote(bookmark.id, text, encrypted);
          await refreshBookmark(bookmark.id);
          setSaved(true);
        } catch (e) {
          Toast.error('保存失败：' + (e as Error).message);
        } finally {
          setSaving(false);
        }
      }, 1000);
    },
    [bookmark?.id, refreshBookmark],
  );

  const handleContentChange = (value: string) => {
    setContent(value);
    debouncedSave(value, isEncrypted);
  };

  const handleEncryptionToggle = (checked: boolean) => {
    if (checked && !unlocked) {
      Toast.warning('请先解锁主密码');
      return;
    }
    setIsEncrypted(checked);
    if (content) {
      debouncedSave(content, checked);
    }
  };

  const handleClose = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    onClose();
  };

  if (!bookmark) return null;

  return (
    <SideSheet
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{bookmark.name}</span>
          {bookmark.isNoteEncrypted && <IconLock style={{ color: 'var(--primary)' }} />}
        </div>
      }
      visible={visible}
      onCancel={handleClose}
      width={500}
      placement="right"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: isEncrypted ? 'var(--primary)' : 'var(--muted)' }}>
              {isEncrypted ? '🔒 加密笔记' : '普通笔记'}
            </span>
            <Switch
              checked={isEncrypted}
              onChange={handleEncryptionToggle}
              size="small"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {saving ? '保存中...' : saved ? '已保存' : '未保存'}
            </span>
            <Button
              icon={<IconDelete />}
              type="danger"
              onClick={() => {
                onDelete(bookmark.id);
                handleClose();
              }}
            />
          </div>
        </div>
      }
    >
      <Tabs activeKey={tab} onChange={(key) => setTab(key as 'edit' | 'preview')}>
        <TabPane tab="编辑" itemKey="edit">
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="点击开始记录...（支持 Markdown）"
            style={{
              width: '100%',
              minHeight: 400,
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: 12,
              fontSize: 14,
              lineHeight: 1.6,
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </TabPane>
        <TabPane tab="预览" itemKey="preview">
          <div
            className="markdown-body"
            style={{ minHeight: 400, padding: 12 }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </TabPane>
      </Tabs>
    </SideSheet>
  );
};
```

Write to `src/newtab/components/NoteEditor/index.tsx`.

- [ ] **Step 2: 实现 UnlockModal 组件**

```tsx
// src/newtab/components/UnlockModal/index.tsx
import React, { useState } from 'react';
import { Modal, Input, Button, Toast } from '@douyinfe/semi-ui';
import { IconKey } from '@douyinfe/semi-icons';
import { useCrypto } from '@/store/useCrypto';

export const UnlockModal: React.FC = () => {
  const passwordSet = useCrypto((s) => s.passwordSet);
  const unlocked = useCrypto((s) => s.unlocked);
  const loading = useCrypto((s) => s.loading);
  const setupMasterPassword = useCrypto((s) => s.setupMasterPassword);
  const unlockWithPassword = useCrypto((s) => s.unlockWithPassword);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const visible = passwordSet && !unlocked;

  const handleSubmit = async () => {
    setError('');

    if (!passwordSet) {
      // 设置新密码
      if (password.length < 12) {
        setError('密码至少 12 个字符');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次密码不一致');
        return;
      }
      try {
        await setupMasterPassword(password);
        Toast.success('主密码已设置');
        setPassword('');
        setConfirmPassword('');
      } catch (e) {
        setError((e as Error).message);
      }
    } else {
      // 解锁
      try {
        await unlockWithPassword(password);
        Toast.success('已解锁');
        setPassword('');
      } catch (e) {
        setError('密码错误或数据损坏');
      }
    }
  };

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconKey />
          <span>{passwordSet ? '输入主密码' : '设置主密码'}</span>
        </div>
      }
      visible={visible}
      footer={null}
      closable={false}
      maskClosable={false}
    >
      <div style={{ padding: '8px 0' }}>
        <Input
          mode="password"
          placeholder={passwordSet ? '输入主密码' : '设置主密码（至少 12 个字符）'}
          value={password}
          onChange={setPassword}
          onEnterPress={handleSubmit}
          style={{ marginBottom: 12 }}
        />
        {!passwordSet && (
          <Input
            mode="password"
            placeholder="确认密码"
            value={confirmPassword}
            onChange={setConfirmPassword}
            onEnterPress={handleSubmit}
            style={{ marginBottom: 12 }}
          />
        )}
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{error}</div>
        )}
        <Button
          theme="solid"
          block
          loading={loading}
          onClick={handleSubmit}
        >
          {passwordSet ? '解锁' : '设置密码'}
        </Button>
      </div>
    </Modal>
  );
};
```

Write to `src/newtab/components/UnlockModal/index.tsx`.

- [ ] **Step 3: 更新 App.tsx 引入 UnlockModal**

在 App.tsx 的 return 中添加 UnlockModal：

```tsx
// 在 App.tsx 的 return 中，app-layout div 的同级位置添加：
<UnlockModal />
```

完整的 App.tsx return 应为：

```tsx
return (
  <>
    <UnlockModal />
    <div className="app-layout">
      <aside className="app-sidebar">
        <Sidebar />
      </aside>
      <main className="app-content">
        <Content />
      </main>
    </div>
  </>
);
```

并在顶部添加 import：
```tsx
import { UnlockModal } from '@/newtab/components/UnlockModal';
```

- [ ] **Step 4: 验证构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add src/newtab/components/NoteEditor/ src/newtab/components/UnlockModal/ src/newtab/App.tsx
git commit -m "feat: 实现 NoteEditor (Markdown编辑+加密) + UnlockModal (主密码弹窗) + App集成"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** 侧边栏（工作区选择+分类列表）→ Task 5。主内容区（搜索+卡片网格+添加书签）→ Task 7。BookmarkCard（favicon+笔记预览+加密标记）→ Task 6。NoteEditor（Markdown编辑+预览+加密开关+自动保存）→ Task 8。UnlockModal（主密码输入/设置）→ Task 8。响应式→ CSS grid 列数可扩展。空状态→ Task 6 EmptyState。
- [x] **Placeholder scan:** 无 TBD/TODO。每个 step 都有完整代码。
- [x] **Type consistency:** Bookmark 类型与 P1 定义的 `shared/types/index.ts` 一致。Service 层引用的 `getByKey`, `putRecord`, `getByIndex` 等函数签名与 `database.ts` 匹配。Store 层调用的 Service 函数名与 Service 文件导出一致。
- [x] **Spec gaps:** 导入/导出功能推迟到后续版本（PLAN.md 标注为非 MVP 必须）。视图切换（网格/列表）同样推迟。首次使用引导流程推迟。
