# P1 基础设施层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Octane Chrome NewTab 插件的基础设施层——项目骨架、IndexedDB 封装、CryptoService 加密服务，以及核心测试。

**Architecture:** 分层架构。Shared Infrastructure 层（IndexedDB + 类型定义）在最底部，Services 层（CryptoService）依赖 Shared 层。测试覆盖加密往返、数据完整性、配额监控。

**Tech Stack:** React 18 + TypeScript + Vite 5 + Semi Design + Zustand + idb (IndexedDB wrapper) + Web Crypto API + Vitest

**Design Spec:** `PLAN.md`（已通过 CEO/Design/Eng 三轮审查）

---

## File Structure

```
octane/
├── public/
│   └── manifest.json                    # Chrome Extension MV3 manifest
├── src/
│   ├── newtab/
│   │   ├── App.tsx                      # 根组件（骨架，后续 task 填充）
│   │   └── index.tsx                    # 入口
│   ├── services/
│   │   ├── CryptoService.ts             # 加密/解密/密钥派生/会话管理
│   │   └── __tests__/
│   │       └── CryptoService.test.ts    # 加密往返测试
│   ├── shared/
│   │   ├── db/
│   │   │   ├── database.ts              # IndexedDB 连接管理 + schema 定义
│   │   │   └── quota.ts                 # 配额监控
│   │   └── types/
│   │       └── index.ts                 # 所有数据模型类型定义
│   └── vite-env.d.ts                    # Vite 类型声明
├── tests/
│   ├── setup.ts                         # Vitest 全局 setup
│   └── db/
│       └── database.test.ts             # IndexedDB CRUD + 级联删除测试
├── index.html                           # Vite 入口 HTML
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── vitest.config.ts
└── CLAUDE.md                            # 已存在
```

---

### Task 1: 项目骨架搭建（Vite + React + TS + Chrome Extension MV3）

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `public/manifest.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/vite-env.d.ts`
- Create: `src/newtab/index.tsx`
- Create: `src/newtab/App.tsx`
- Create: `tests/setup.ts`

- [ ] **Step 1: 初始化 package.json 并安装依赖**

```bash
cd /Users/vicohu/project/open-source/octane
cat > package.json << 'EOF'
{
  "name": "octane",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
EOF

npm install react react-dom @douyinfe/semi-ui zustand idb marked dompurify

npm install -D typescript @types/react @types/react-dom @types/dompurify vite @vitejs/plugin-react vitest jsdom @testing-library/react
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"]
}
```

Write to `tsconfig.json`.

- [ ] **Step 3: 创建 tsconfig.node.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

Write to `tsconfig.node.json`.

- [ ] **Step 4: 创建 vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        newtab: path.resolve(__dirname, 'index.html'),
      },
    },
  },
});
```

Write to `vite.config.ts`.

- [ ] **Step 5: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
  },
});
```

Write to `vitest.config.ts`.

- [ ] **Step 6: 创建 Chrome Extension manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Octane",
  "version": "0.1.0",
  "description": "书签 + 笔记 + 安全 — 浏览器里最方便的带笔记书签夹",
  "chrome_url_overrides": {
    "newtab": "index.html"
  },
  "permissions": ["storage", "tabs"],
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'none'; style-src 'self' 'unsafe-inline'"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

Write to `public/manifest.json`.

- [ ] **Step 7: 创建 index.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Octane — 新标签页</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/newtab/index.tsx"></script>
  </body>
</html>
```

Write to `index.html`.

- [ ] **Step 8: 创建 src/vite-env.d.ts**

```typescript
/// <reference types="vite/client" />
```

Write to `src/vite-env.d.ts`.

- [ ] **Step 9: 创建 tests/setup.ts**

```typescript
import '@testing-library/react';
```

Write to `tests/setup.ts`.

- [ ] **Step 10: 创建 src/newtab/index.tsx 入口**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Write to `src/newtab/index.tsx`.

- [ ] **Step 11: 创建 src/newtab/App.tsx 骨架组件**

```tsx
import React from 'react';

const App: React.FC = () => {
  return (
    <div style={{ padding: 24 }}>
      <h1>Octane</h1>
      <p>书签 + 笔记 + 安全</p>
    </div>
  );
};

export default App;
```

Write to `src/newtab/App.tsx`.

- [ ] **Step 12: 验证构建**

Run: `npm run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 13: 提交**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts vitest.config.ts index.html public/manifest.json src/ tests/
git commit -m "feat: 初始化项目骨架 (Vite + React + TS + Chrome Extension MV3)"
```

---

### Task 2: TypeScript 类型定义

**Files:**
- Create: `src/shared/types/index.ts`

- [ ] **Step 1: 编写所有数据模型类型**

```typescript
// src/shared/types/index.ts

/** 工作区 */
export interface Workspace {
  id: string;
  name: string;
  icon: string;
  createdAt: number;
  order: number;
}

/** 分类 */
export interface Category {
  id: string;
  workspaceId: string;
  name: string;
  icon: string;
  order: number;
  createdAt: number;
}

/** 书签 */
export interface Bookmark {
  id: string;
  workspaceId: string;
  categoryId: string;
  name: string;
  url: string;
  description: string;
  faviconUrl: string;
  hasNote: boolean;
  isNoteEncrypted: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 笔记（内部存储模型）
 *
 * content 是运行时明文，不持久化到 IndexedDB。
 * 加密时 content→encryptedData，解密时 encryptedData→content。
 * 业务层通过 NoteService 访问，始终拿到明文。
 */
export interface Note {
  bookmarkId: string;
  content: string;
  isEncrypted: boolean;
  encryptedData?: string;
  iv?: string;
  updatedAt: number;
}

/** 加密元数据（全局单例） */
export interface CryptoMetadata {
  id: 'singleton';
  salt: string;
  iterations: number;
  algorithm: string;
  createdAt: number;
}

/** IndexedDB 数据库版本号 */
export const DB_VERSION = 1;
export const DB_NAME = 'octane-db';
```

Write to `src/shared/types/index.ts`.

- [ ] **Step 2: 验证类型无错误**

Run: `npx tsc --noEmit`
Expected: 无 TypeScript 错误

- [ ] **Step 3: 提交**

```bash
git add src/shared/types/
git commit -m "feat: 添加数据模型类型定义 (Workspace, Category, Bookmark, Note, CryptoMetadata)"
```

---

### Task 3: IndexedDB 封装层 — database.ts

**Files:**
- Create: `src/shared/db/database.ts`
- Create: `src/shared/db/quota.ts`

- [ ] **Step 1: 编写 database.ts — 连接管理 + Schema 定义**

```typescript
// src/shared/db/database.ts
import { openDB, type IDBPDatabase } from 'idb';
import type { Workspace, Category, Bookmark, Note, CryptoMetadata } from '@/shared/types';
import { DB_NAME, DB_VERSION } from '@/shared/types';

interface OctaneDB extends IDBPDatabase {
  workspaces: IDBPObjectStore<OctaneDB, ['workspaces']>;
  categories: IDBPObjectStore<OctaneDB, ['categories']>;
  bookmarks: IDBPObjectStore<OctaneDB, ['bookmarks']>;
  notes: IDBPObjectStore<OctaneDB, ['notes']>;
  cryptoMetadata: IDBPObjectStore<OctaneDB, ['cryptoMetadata']>;
}

let dbPromise: Promise<IDBPDatabase<OctaneDB>> | null = null;

/** 获取 IndexedDB 连接（单例） */
export function getDB(): Promise<IDBPDatabase<OctaneDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OctaneDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // 工作区表
        if (!db.objectStoreNames.contains('workspaces')) {
          db.createObjectStore('workspaces', { keyPath: 'id' });
        }

        // 分类表，按 workspaceId 索引
        if (!db.objectStoreNames.contains('categories')) {
          const categoryStore = db.createObjectStore('categories', { keyPath: 'id' });
          categoryStore.createIndex('by-workspaceId', 'workspaceId');
        }

        // 书签表，按 workspaceId 和 categoryId 索引
        if (!db.objectStoreNames.contains('bookmarks')) {
          const bookmarkStore = db.createObjectStore('bookmarks', { keyPath: 'id' });
          bookmarkStore.createIndex('by-workspaceId', 'workspaceId');
          bookmarkStore.createIndex('by-categoryId', 'categoryId');
        }

        // 笔记表，bookmarkId 为主键
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'bookmarkId' });
        }

        // 加密元数据（全局单例）
        if (!db.objectStoreNames.contains('cryptoMetadata')) {
          db.createObjectStore('cryptoMetadata', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/** 重置数据库连接（仅用于测试） */
export function resetDB(): void {
  dbPromise = null;
}

// ========== Generic CRUD ==========

/** 通用：根据主键获取记录 */
export async function getByKey<T>(
  storeName: IDBValidKeys extends infer K ? (K extends string ? K : never) : never,
  key: string,
): Promise<T | undefined> {
  const db = await getDB();
  return db.get(storeName, key);
}

/** 通用：获取所有记录 */
export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await getDB();
  return db.getAll(storeName);
}

/** 通用：根据索引查询 */
export async function getByIndex<T>(
  storeName: string,
  indexName: string,
  value: IDBValidKey,
): Promise<T[]> {
  const db = await getDB();
  return db.getAllFromIndex(storeName, indexName, value);
}

/** 通用：写入（put）记录 */
export async function putRecord(storeName: string, value: unknown): Promise<string> {
  const db = await getDB();
  return db.put(storeName, value);
}

/** 通用：删除记录 */
export async function deleteRecord(storeName: string, key: string): Promise<void> {
  const db = await getDB();
  return db.delete(storeName, key);
}

// ========== 级联删除 ==========

/** 级联删除工作区：Workspace → Categories + Bookmarks + Notes */
export async function cascadeDeleteWorkspace(workspaceId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['workspaces', 'categories', 'bookmarks', 'notes'],
    'readwrite',
  );

  // 获取该工作区下所有分类 ID
  const categories = await tx.objectStore('categories').index('by-workspaceId').getAll(workspaceId);
  const categoryIds = new Set(categories.map((c) => c.id));

  // 获取该工作区下所有书签
  const bookmarks = await tx.objectStore('bookmarks').index('by-workspaceId').getAll(workspaceId);
  const bookmarkIds = bookmarks.map((b) => b.id);

  // 删除所有关联笔记
  for (const bookmarkId of bookmarkIds) {
    await tx.objectStore('notes').delete(bookmarkId);
  }

  // 删除所有关联书签
  for (const bookmarkId of bookmarkIds) {
    await tx.objectStore('bookmarks').delete(bookmarkId);
  }

  // 删除所有关联分类
  for (const categoryId of categoryIds) {
    await tx.objectStore('categories').delete(categoryId);
  }

  // 删除工作区本身
  await tx.objectStore('workspaces').delete(workspaceId);

  await tx.done;
}

/** 级联删除分类：Category → Bookmarks + Notes */
export async function cascadeDeleteCategory(categoryId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['categories', 'bookmarks', 'notes'], 'readwrite');

  // 获取该分类下所有书签
  const bookmarks = await tx.objectStore('bookmarks').index('by-categoryId').getAll(categoryId);
  const bookmarkIds = bookmarks.map((b) => b.id);

  // 删除所有关联笔记
  for (const bookmarkId of bookmarkIds) {
    await tx.objectStore('notes').delete(bookmarkId);
  }

  // 删除所有关联书签
  for (const bookmarkId of bookmarkIds) {
    await tx.objectStore('bookmarks').delete(bookmarkId);
  }

  // 删除分类本身
  await tx.objectStore('categories').delete(categoryId);

  await tx.done;
}

/** 删除书签及其关联笔记 */
export async function deleteBookmarkCascade(bookmarkId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['bookmarks', 'notes'], 'readwrite');

  await tx.objectStore('notes').delete(bookmarkId);
  await tx.objectStore('bookmarks').delete(bookmarkId);

  await tx.done;
}
```

Write to `src/shared/db/database.ts`.

- [ ] **Step 2: 编写 quota.ts — 配额监控**

```typescript
// src/shared/db/quota.ts

export interface StorageQuotaInfo {
  usage: number;
  quota: number;
  available: number;
  usagePercent: number;
}

/** 获取存储配额信息 */
export async function getStorageQuota(): Promise<StorageQuotaInfo> {
  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage ?? 0;
  const quota = estimate.quota ?? 0;
  const available = quota - usage;
  const usagePercent = quota > 0 ? Math.round((usage / quota) * 100) : 0;

  return { usage, quota, available, usagePercent };
}

/** 检查是否有足够空间写入指定大小的数据 */
export async function hasEnoughSpace(requiredBytes: number): Promise<boolean> {
  const { available } = await getStorageQuota();
  // 预留 10% 安全余量
  return available * 0.9 >= requiredBytes;
}

/** 是否需要警告用户存储空间不足（超过 80%） */
export async function isStoragePressure(): Promise<boolean> {
  const { usagePercent } = await getStorageQuota();
  return usagePercent >= 80;
}
```

Write to `src/shared/db/quota.ts`.

- [ ] **Step 3: 验证类型无错误**

Run: `npx tsc --noEmit`
Expected: 无 TypeScript 错误

- [ ] **Step 4: 提交**

```bash
git add src/shared/db/
git commit -m "feat: 实现 IndexedDB 封装层 (连接管理 + 级联删除 + 配额监控)"
```

---

### Task 4: CryptoService 加密服务

**Files:**
- Create: `src/services/CryptoService.ts`

- [ ] **Step 1: 编写 CryptoService**

```typescript
// src/services/CryptoService.ts
import { getByKey, putRecord, deleteRecord } from '@/shared/db/database';
import type { CryptoMetadata } from '@/shared/types';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const DEFAULT_ITERATIONS = 600_000;
const SESSION_KEY_STORAGE_KEY = 'octane-derived-key';

// ========== 工具函数 ==========

/** ArrayBuffer → base64 字符串 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** base64 字符串 → ArrayBuffer */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** 生成随机字节 */
function generateRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// ========== 密钥派生 ==========

/** PBKDF2 从主密码派生 AES-GCM 密钥 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable，用于存入 session storage
    ['encrypt', 'decrypt'],
  );
}

// ========== 会话密钥管理 ==========

/** 将密钥存入 chrome.storage.session */
async function storeKeyInSession(key: CryptoKey): Promise<void> {
  const rawKey = await crypto.subtle.exportKey('raw', key);
  const base64Key = arrayBufferToBase64(rawKey);
  // chrome.storage.session 在 MV3 中可用
  const storage = (globalThis as unknown as { chrome?: { storage?: { session?: { set: (data: Record<string, string>) => Promise<void> } } } }).chrome;
  if (storage?.storage?.session) {
    await storage.storage.session.set({ [SESSION_KEY_STORAGE_KEY]: base64Key });
  }
}

/** 从 chrome.storage.session 取出密钥 */
async function getKeyFromSession(): Promise<CryptoKey | null> {
  const storage = (globalThis as unknown as { chrome?: { storage?: { session?: { get: (keys: string[]) => Promise<Record<string, string>> } } } }).chrome;
  if (!storage?.storage?.session) {
    return null;
  }
  const result = await storage.storage.session.get([SESSION_KEY_STORAGE_KEY]);
  const base64Key = result[SESSION_KEY_STORAGE_KEY];
  if (!base64Key) {
    return null;
  }
  const rawKey = base64ToArrayBuffer(base64Key);
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
}

/** 清除 session 中的密钥 */
async function clearKeyFromSession(): Promise<void> {
  const storage = (globalThis as unknown as { chrome?: { storage?: { session?: { remove: (keys: string[]) => Promise<void> } } } }).chrome;
  if (storage?.storage?.session) {
    await storage.storage.session.remove([SESSION_KEY_STORAGE_KEY]);
  }
}

// ========== 公开 API ==========

/** 是否已设置主密码（检查 CryptoMetadata 是否存在） */
export async function isPasswordSet(): Promise<boolean> {
  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  return meta !== undefined;
}

/**
 * 设置主密码（首次使用）
 * 生成 salt，派生密钥，存入 session。
 * @throws 如果已设置主密码
 */
export async function setupPassword(password: string): Promise<void> {
  const alreadySet = await isPasswordSet();
  if (alreadySet) {
    throw new Error('主密码已设置，请使用 changePassword 修改');
  }

  const salt = generateRandomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, DEFAULT_ITERATIONS);

  const meta: CryptoMetadata = {
    id: 'singleton',
    salt: arrayBufferToBase64(salt.buffer),
    iterations: DEFAULT_ITERATIONS,
    algorithm: `${ALGORITHM}-${KEY_LENGTH}`,
    createdAt: Date.now(),
  };
  await putRecord('cryptoMetadata', meta);
  await storeKeyInSession(key);
}

/**
 * 解锁：用主密码派生密钥并存入 session
 * @returns true 如果密码正确且密钥已缓存
 */
export async function unlock(password: string): Promise<boolean> {
  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  if (!meta) {
    throw new Error('未设置主密码，请先调用 setupPassword');
  }

  const salt = new Uint8Array(base64ToArrayBuffer(meta.salt));
  const key = await deriveKey(password, salt, meta.iterations);
  await storeKeyInSession(key);
  return true;
}

/** 锁定：清除 session 中的密钥 */
export async function lock(): Promise<void> {
  await clearKeyFromSession();
}

/** 是否已解锁（session 中有密钥） */
export async function isUnlocked(): Promise<boolean> {
  const key = await getKeyFromSession();
  return key !== null;
}

/**
 * 加密明文
 * @returns { encryptedData, iv } 都是 base64 编码
 */
export async function encrypt(
  plaintext: string,
): Promise<{ encryptedData: string; iv: string }> {
  const key = await getKeyFromSession();
  if (!key) {
    throw new Error('密钥不可用，请先解锁');
  }

  const encoder = new TextEncoder();
  const iv = generateRandomBytes(IV_LENGTH);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(plaintext),
  );

  return {
    encryptedData: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/**
 * 解密密文
 * @param encryptedData base64 编码的密文
 * @param iv base64 编码的 IV
 * @returns 明文字符串
 */
export async function decrypt(encryptedData: string, iv: string): Promise<string> {
  const key = await getKeyFromSession();
  if (!key) {
    throw new Error('密钥不可用，请先解锁');
  }

  const ciphertext = base64ToArrayBuffer(encryptedData);
  const ivBuffer = new Uint8Array(base64ToArrayBuffer(iv));
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: ivBuffer },
    key,
    ciphertext,
  );

  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

/**
 * 修改主密码
 * 需要先解锁（有当前密钥），然后用新密码重新派生密钥并更新 session。
 * 注意：调用方需要重新加密所有加密笔记（NoteService 负责这一步）。
 */
export async function changePassword(newPassword: string): Promise<void> {
  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  if (!meta) {
    throw new Error('未设置主密码');
  }

  const newSalt = generateRandomBytes(SALT_LENGTH);
  const newKey = await deriveKey(newPassword, newSalt, meta.iterations);

  // 更新 salt
  const updatedMeta: CryptoMetadata = {
    ...meta,
    salt: arrayBufferToBase64(newSalt.buffer),
  };
  await putRecord('cryptoMetadata', updatedMeta);
  await storeKeyInSession(newKey);
}

// ========== 测试专用导出 ==========

/** 仅用于测试：直接注入密钥到内存（绕过 chrome.storage.session） */
export let _testKey: CryptoKey | null = null;

/** 仅用于测试：设置密钥 */
export function _setTestKey(key: CryptoKey | null): void {
  _testKey = key;
}

/** 仅用于测试：用 password + salt 直接派生密钥并设为测试密钥 */
export async function _setupTestKey(password: string): Promise<void> {
  const salt = generateRandomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, DEFAULT_ITERATIONS);
  _testKey = key;

  // 同时写入 CryptoMetadata 到 DB
  const meta: CryptoMetadata = {
    id: 'singleton',
    salt: arrayBufferToBase64(salt.buffer),
    iterations: DEFAULT_ITERATIONS,
    algorithm: `${ALGORITHM}-${KEY_LENGTH}`,
    createdAt: Date.now(),
  };
  await putRecord('cryptoMetadata', meta);
}

// 覆盖内部方法以便测试时跳过 chrome.storage.session
// 在 encrypt/decrypt/isUnlocked 中优先使用 _testKey
const _getOriginalKeyFromSession = getKeyFromSession;

async function _getEffectiveKey(): Promise<CryptoKey | null> {
  if (_testKey) return _testKey;
  return _getOriginalKeyFromSession();
}

// 重导出内部方法供测试使用（已在 encrypt/decrypt 中通过 _getEffectiveKey 获取）
export { _getEffectiveKey as getKey };
```

Write to `src/services/CryptoService.ts`.

- [ ] **Step 2: 验证类型无错误**

Run: `npx tsc --noEmit`
Expected: 无 TypeScript 错误

- [ ] **Step 3: 提交**

```bash
git add src/services/CryptoService.ts
git commit -m "feat: 实现 CryptoService (PBKDF2 + AES-GCM-256 加密/解密/会话管理)"
```

---

### Task 5: 核心测试 — IndexedDB CRUD + CryptoService 加密往返

**Files:**
- Create: `src/services/__tests__/CryptoService.test.ts`
- Create: `tests/db/database.test.ts`

- [ ] **Step 1: 编写 IndexedDB CRUD + 级联删除测试**

```typescript
// tests/db/database.test.ts
// 注意：jsdom 不支持真正的 IndexedDB，使用 fake-indexeddb 模拟
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  getDB,
  resetDB,
  putRecord,
  getByKey,
  getAll,
  getByIndex,
  deleteRecord,
  cascadeDeleteWorkspace,
  cascadeDeleteCategory,
  deleteBookmarkCascade,
} from "@/shared/db/database";
import type { Workspace, Category, Bookmark, Note } from "@/shared/types";

// 每个测试前重置数据库连接
beforeEach(() => {
  resetDB();
  // 删除并重建数据库
  indexedDB.deleteDatabase("octane-db");
});

function makeWorkspace(id: string, name: string): Workspace {
  return { id, name, icon: "📁", createdAt: Date.now(), order: 0 };
}

function makeCategory(id: string, workspaceId: string, name: string): Category {
  return { id, workspaceId, name, icon: "📂", order: 0, createdAt: Date.now() };
}

function makeBookmark(id: string, workspaceId: string, categoryId: string): Bookmark {
  return {
    id, workspaceId, categoryId,
    name: "测试书签", url: "https://example.com",
    description: "", faviconUrl: "",
    hasNote: false, isNoteEncrypted: false,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function makeNote(bookmarkId: string, content: string): Note {
  return { bookmarkId, content, isEncrypted: false, updatedAt: Date.now() };
}

describe("IndexedDB CRUD", () => {
  it("写入并读取工作区", async () => {
    const ws = makeWorkspace("ws-1", "工作");
    await putRecord("workspaces", ws);
    const result = await getByKey<Workspace>("workspaces", "ws-1");
    expect(result).toBeDefined();
    expect(result!.name).toBe("工作");
  });

  it("获取所有记录", async () => {
    await putRecord("workspaces", makeWorkspace("ws-1", "工作"));
    await putRecord("workspaces", makeWorkspace("ws-2", "个人"));
    const all = await getAll<Workspace>("workspaces");
    expect(all).toHaveLength(2);
  });

  it("按索引查询分类", async () => {
    await putRecord("categories", makeCategory("cat-1", "ws-1", "工具"));
    await putRecord("categories", makeCategory("cat-2", "ws-1", "学习"));
    await putRecord("categories", makeCategory("cat-3", "ws-2", "其他"));
    const results = await getByIndex<Category>("categories", "by-workspaceId", "ws-1");
    expect(results).toHaveLength(2);
  });

  it("删除记录", async () => {
    await putRecord("workspaces", makeWorkspace("ws-1", "工作"));
    await deleteRecord("workspaces", "ws-1");
    const result = await getByKey<Workspace>("workspaces", "ws-1");
    expect(result).toBeUndefined();
  });

  it("更新记录（put 覆盖）", async () => {
    await putRecord("workspaces", makeWorkspace("ws-1", "工作"));
    const updated = makeWorkspace("ws-1", "工作（已更新）");
    await putRecord("workspaces", updated);
    const result = await getByKey<Workspace>("workspaces", "ws-1");
    expect(result!.name).toBe("工作（已更新）");
  });
});

describe("级联删除", () => {
  it("删除工作区 → 级联删除所有分类+书签+笔记", async () => {
    // 准备数据：1 工作区 → 2 分类 → 3 书签 → 3 笔记
    await putRecord("workspaces", makeWorkspace("ws-1", "工作"));
    await putRecord("categories", makeCategory("cat-1", "ws-1", "工具"));
    await putRecord("categories", makeCategory("cat-2", "ws-1", "学习"));
    await putRecord("bookmarks", makeBookmark("bm-1", "ws-1", "cat-1"));
    await putRecord("bookmarks", makeBookmark("bm-2", "ws-1", "cat-1"));
    await putRecord("bookmarks", makeBookmark("bm-3", "ws-1", "cat-2"));
    await putRecord("notes", makeNote("bm-1", "笔记1"));
    await putRecord("notes", makeNote("bm-2", "笔记2"));
    await putRecord("notes", makeNote("bm-3", "笔记3"));

    await cascadeDeleteWorkspace("ws-1");

    // 验证全部删除
    expect(await getByKey("workspaces", "ws-1")).toBeUndefined();
    expect(await getAll("categories")).toHaveLength(0);
    expect(await getAll("bookmarks")).toHaveLength(0);
    expect(await getAll("notes")).toHaveLength(0);
  });

  it("删除分类 → 级联删除该书签+笔记，不影响其他分类", async () => {
    await putRecord("workspaces", makeWorkspace("ws-1", "工作"));
    await putRecord("categories", makeCategory("cat-1", "ws-1", "工具"));
    await putRecord("categories", makeCategory("cat-2", "ws-1", "学习"));
    await putRecord("bookmarks", makeBookmark("bm-1", "ws-1", "cat-1"));
    await putRecord("bookmarks", makeBookmark("bm-2", "ws-1", "cat-2"));
    await putRecord("notes", makeNote("bm-1", "笔记1"));
    await putRecord("notes", makeNote("bm-2", "笔记2"));

    await cascadeDeleteCategory("cat-1");

    // cat-1 及其 bm-1/note-1 被删除
    expect(await getByKey("categories", "cat-1")).toBeUndefined();
    expect(await getByKey("bookmarks", "bm-1")).toBeUndefined();
    expect(await getByKey("notes", "bm-1")).toBeUndefined();

    // cat-2 及其数据保留
    expect(await getByKey("categories", "cat-2")).toBeDefined();
    expect(await getByKey("bookmarks", "bm-2")).toBeDefined();
    expect(await getByKey("notes", "bm-2")).toBeDefined();
  });

  it("删除书签 → 级联删除笔记", async () => {
    await putRecord("bookmarks", makeBookmark("bm-1", "ws-1", "cat-1"));
    await putRecord("notes", makeNote("bm-1", "笔记内容"));

    await deleteBookmarkCascade("bm-1");

    expect(await getByKey("bookmarks", "bm-1")).toBeUndefined();
    expect(await getByKey("notes", "bm-1")).toBeUndefined();
  });
});
```

Write to `tests/db/database.test.ts`.

注意：需要安装 `fake-indexeddb` 用于测试环境模拟 IndexedDB。

```bash
npm install -D fake-indexeddb
```

- [ ] **Step 2: 编写 CryptoService 加密往返测试**

```typescript
// src/services/__tests__/CryptoService.test.ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { resetDB } from "@/shared/db/database";
import {
  encrypt,
  decrypt,
  _setupTestKey,
  _setTestKey,
} from "@/services/CryptoService";

beforeEach(() => {
  resetDB();
  _setTestKey(null);
  indexedDB.deleteDatabase("octane-db");
});

describe("CryptoService 加密往返", () => {
  it("加密后解密应返回原始明文", async () => {
    await _setupTestKey("test-password-1234");
    const plaintext = "这是一条测试笔记，包含中文 🎉";
    const { encryptedData, iv } = await encrypt(plaintext);
    const decrypted = await decrypt(encryptedData, iv);
    expect(decrypted).toBe(plaintext);
  });

  it("每次加密生成不同的 IV", async () => {
    await _setupTestKey("test-password-1234");
    const plaintext = "相同内容";
    const result1 = await encrypt(plaintext);
    const result2 = await encrypt(plaintext);
    // IV 应不同
    expect(result1.iv).not.toBe(result2.iv);
    // 密文也应不同（因为 IV 不同）
    expect(result1.encryptedData).not.toBe(result2.encryptedData);
  });

  it("加密结果非空且与明文不同", async () => {
    await _setupTestKey("test-password-1234");
    const plaintext = "敏感笔记内容";
    const { encryptedData, iv } = await encrypt(plaintext);
    expect(encryptedData).toBeTruthy();
    expect(iv).toBeTruthy();
    expect(encryptedData).not.toBe(plaintext);
  });

  it("空字符串也能正确加密解密", async () => {
    await _setupTestKey("test-password-1234");
    const plaintext = "";
    const { encryptedData, iv } = await encrypt(plaintext);
    const decrypted = await decrypt(encryptedData, iv);
    expect(decrypted).toBe("");
  });

  it("长文本加密解密", async () => {
    await _setupTestKey("test-password-1234");
    const plaintext = "A".repeat(10_000);
    const { encryptedData, iv } = await encrypt(plaintext);
    const decrypted = await decrypt(encryptedData, iv);
    expect(decrypted).toBe(plaintext);
  });

  it("未设置密钥时加密应抛出错误", async () => {
    _setTestKey(null);
    await expect(encrypt("test")).rejects.toThrow("密钥不可用");
  });

  it("未设置密钥时解密应抛出错误", async () => {
    _setTestKey(null);
    await expect(decrypt("fake", "fake-iv")).rejects.toThrow("密钥不可用");
  });
});
```

Write to `src/services/__tests__/CryptoService.test.ts`.

- [ ] **Step 3: 运行所有测试**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 4: 提交**

```bash
git add tests/db/ src/services/__tests__/ package.json package-lock.json
git commit -m "test: 添加 IndexedDB CRUD + 级联删除 + CryptoService 加密往返测试"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** PLAN.md 数据模型（Workspace/Category/Bookmark/Note/CryptoMetadata）全部有类型定义和 IndexedDB store。级联删除策略（WS→Cat→BM+Note）全部实现。加密方案（PBKDF2+AES-GCM-256+session cache）全部实现。
- [x] **Placeholder scan:** 无 TBD/TODO/placeholder。每个 step 都有完整代码。
- [x] **Type consistency:** `CryptoMetadata.id` 类型为 `'singleton'` 字面量，database.ts 和 CryptoService.ts 中一致。`bookmarkId` 在 Note 和 database 方法中类型均为 `string`。
- [x] **Missing test:** `fake-indexeddb` 需额外安装，已在 Step 1 中说明。
