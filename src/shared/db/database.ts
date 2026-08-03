import { openDB, type IDBPDatabase, type IDBPObjectStore, type IDBPTransaction } from 'idb';
import { DB_NAME, DB_VERSION } from '@/shared/types';
import type {
  BackupData,
  Bookmark,
  Category,
  Context,
  CryptoMetadata,
  PinnedTab,
  Task,
  TaskList,
  ChecklistItem,
  TaskTag,
  TaskTagAssignment,
  Workspace,
} from '@/shared/types';

interface OctaneDB extends IDBPDatabase {
  workspaces: IDBPObjectStore<OctaneDB, ['workspaces']>;
  categories: IDBPObjectStore<OctaneDB, ['categories']>;
  bookmarks: IDBPObjectStore<OctaneDB, ['bookmarks']>;
  contexts: IDBPObjectStore<OctaneDB, ['contexts']>;
  cryptoMetadata: IDBPObjectStore<OctaneDB, ['cryptoMetadata']>;
  favicons: IDBPObjectStore<OctaneDB, ['favicons']>;
  pinnedTabs: IDBPObjectStore<OctaneDB, ['pinnedTabs']>;
  taskLists: IDBPObjectStore<OctaneDB, ['taskLists']>;
  tasks: IDBPObjectStore<OctaneDB, ['tasks']>;
  checklistItems: IDBPObjectStore<OctaneDB, ['checklistItems']>;
  taskTags: IDBPObjectStore<OctaneDB, ['taskTags']>;
  taskTagAssignments: IDBPObjectStore<OctaneDB, ['taskTagAssignments']>;
}

type StoreName =
  | 'workspaces'
  | 'categories'
  | 'bookmarks'
  | 'contexts'
  | 'cryptoMetadata'
  | 'favicons'
  | 'pinnedTabs'
  | 'taskLists'
  | 'tasks'
  | 'checklistItems'
  | 'taskTags'
  | 'taskTagAssignments';

/**
 * 数据变更事件：数据库写入后广播，让其他上下文（side panel）重新读取刷新。
 * 同名 BroadcastChannel 实例互通信义，同实例 postMessage 不回环。
 */
export type DbChangeEvent = { store: StoreName; action: 'put' | 'delete' };

function createExtensionChannel(name: string): BroadcastChannel | null {
  const inExtensionContext = typeof window !== 'undefined' || typeof chrome !== 'undefined';
  return inExtensionContext && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(name)
    : null;
}

const dbChannel = createExtensionChannel(DB_NAME);

/** 广播数据变更。无原生 BroadcastChannel 时静默跳过。 */
function broadcast(store: StoreName, action: 'put' | 'delete'): void {
  dbChannel?.postMessage({ store, action } satisfies DbChangeEvent);
}

/** 公开包装：供导入等外部流程显式触发 store 变更广播（side panel 刷新）。 */
export function broadcastChange(store: StoreName, action: 'put' | 'delete'): void {
  broadcast(store, action);
}

/** 全量导入广播 channel 名（独立于 store 级广播，供 home 整体 reload）。 */
export const IMPORT_CHANNEL_NAME = 'octane-import';
const importChannel = createExtensionChannel(IMPORT_CHANNEL_NAME);

/** 广播「全量导入完成」事件。home 订阅后整体 reload。 */
export function broadcastImport(): void {
  importChannel?.postMessage({ type: 'imported' });
}

let dbPromise: Promise<IDBPDatabase<OctaneDB>> | null = null;

/**
 * 数据库迁移纯函数（Issue 3A：从 openDB 抽离以便单测）。
 *
 * v1–v3 的建库逻辑保留幂等 `if (!contains)` 守卫（不按版本门控），以精确复刻历史行为、
 * 避免对老库的回归风险；v4 起新增 store 走显式 `oldVersion < N` 门控，让迁移边界清晰可测。
 */
export async function runUpgrade(
  db: IDBPDatabase<OctaneDB>,
  oldVersion: number,
  _newVersion: number | null,
  transaction?: IDBPTransaction<OctaneDB, string[], 'versionchange'>,
): Promise<void> {
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

  // 笔记表 → 上下文表（v1→v2 升级）
  if (db.objectStoreNames.contains('notes')) {
    console.warn('[Octane] 数据库升级 v1→v2：删除旧 notes store，历史笔记数据将丢失。');
    db.deleteObjectStore('notes');
  }
  if (!db.objectStoreNames.contains('contexts')) {
    const contextStore = db.createObjectStore('contexts', { keyPath: 'id' });
    contextStore.createIndex('by-bookmarkId', 'bookmarkId');
  }

  // 加密元数据（全局单例）
  if (!db.objectStoreNames.contains('cryptoMetadata')) {
    db.createObjectStore('cryptoMetadata', { keyPath: 'id' });
  }

  // favicon 缓存（v4→v5）：旧记录可能含 Chrome 默认图，缓存可重建，升级时清空。
  if (oldVersion < 5 && db.objectStoreNames.contains('favicons')) {
    db.deleteObjectStore('favicons');
  }
  if (!db.objectStoreNames.contains('favicons')) {
    db.createObjectStore('favicons', { keyPath: 'hostname' });
  }

  // pinnedTabs 常驻标签（v3→v4）：独立实体，per-workspace 跨分类
  if (oldVersion < 4) {
    const pinnedStore = db.createObjectStore('pinnedTabs', { keyPath: 'id' });
    pinnedStore.createIndex('by-workspaceId', 'workspaceId');
  }

  // Bookmark order 回填（v4→v5）：拖拽排序 0.1.12 新增 order 字段。按 categoryId 分组，
  // 组内 (createdAt ASC, id ASC) 赋 0,1,2...，与 BackupService 旧备份回填算法一致。
  // 【禁用 putRecord】它调 getDB() 开新事务，与 versionchange 升级事务并行 → 中断升级
  //（idb footgun）。必须复用 upgrade 回调注入的 transaction.objectStore('bookmarks')。
  if (oldVersion < 5 && transaction) {
    // 外部无 upgrade 事务直接调用（如幂等校验）时 transaction 缺失 → 跳过数据迁移；
    // 用条件守卫而非早退 return，让未来 v6+ 迁移块仍能在同一调用内执行
    const store = transaction.objectStore('bookmarks');
    const all = (await store.getAll()) as Bookmark[];
    const groups = new Map<string, Bookmark[]>();
    for (const b of all) {
      const arr = groups.get(b.categoryId) ?? [];
      arr.push(b);
      groups.set(b.categoryId, arr);
    }
    for (const arr of groups.values()) {
      arr.sort(
        (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
      for (let i = 0; i < arr.length; i++) {
        arr[i]!.order = i;
        await store.put(arr[i]!);
      }
    }
  }

  // Bookmark tags 回填（v5→v6，Issue #47）：为全部历史 Bookmark 回填空 tags 数组。
  // 仅回填缺失字段（tags !== undefined 的记录不动），保留现有实体、字段、索引和排序数据。
  // 同样复用 upgrade 事务，禁用 putRecord（与 v4→v5 同理）。
  if (oldVersion < 6 && transaction) {
    const store = transaction.objectStore('bookmarks');
    const all = (await store.getAll()) as Bookmark[];
    for (const b of all) {
      if (b.tags === undefined) {
        b.tags = [];
        await store.put(b);
      }
    }
  }

  // 待办数据表结构（v6→v7）：仅创建空表与索引，不改写既有记录。
  if (oldVersion < 7) {
    const taskLists = db.createObjectStore('taskLists', { keyPath: 'id' });
    taskLists.createIndex('by-workspaceId', 'workspaceId');
    taskLists.createIndex('by-workspaceId-normalizedName', ['workspaceId', 'normalizedName'], { unique: true });

    const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
    tasks.createIndex('by-workspaceId', 'workspaceId');
    tasks.createIndex('by-containerKey', 'containerKey');
    tasks.createIndex('by-listId', 'listId');
    tasks.createIndex('by-dueDate', 'dueDate');
    tasks.createIndex('by-deletedAt', 'deletedAt');

    const checklistItems = db.createObjectStore('checklistItems', { keyPath: 'id' });
    checklistItems.createIndex('by-taskId', 'taskId');

    const taskTags = db.createObjectStore('taskTags', { keyPath: 'id' });
    taskTags.createIndex('by-workspaceId', 'workspaceId');
    taskTags.createIndex('by-workspaceId-normalizedName', ['workspaceId', 'normalizedName'], { unique: true });

    const taskTagAssignments = db.createObjectStore('taskTagAssignments', { keyPath: ['taskId', 'tagId'] });
    taskTagAssignments.createIndex('by-taskId', 'taskId');
    taskTagAssignments.createIndex('by-tagId', 'tagId');
  }
}

/** 获取 IndexedDB 连接（单例） */
export function getDB(): Promise<IDBPDatabase<OctaneDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OctaneDB>(DB_NAME, DB_VERSION, {
      upgrade: (db, oldVersion, newVersion, transaction) => {
        return runUpgrade(db, oldVersion, newVersion, transaction);
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

/** 根据主键获取记录 */
export async function getByKey<T>(storeName: StoreName, key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get(storeName, key);
}

/** 获取所有记录 */
export async function getAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await getDB();
  return db.getAll(storeName);
}

/** 根据索引查询 */
export async function getByIndex<T>(
  storeName: StoreName,
  indexName: string,
  value: IDBValidKey,
): Promise<T[]> {
  const db = await getDB();
  return db.getAllFromIndex(storeName, indexName, value);
}

/** 写入（put）记录 */
export async function putRecord(storeName: StoreName, value: unknown): Promise<IDBValidKey> {
  const db = await getDB();
  const key = await db.put(storeName, value);
  broadcast(storeName, 'put');
  return key;
}

/** 删除记录 */
export async function deleteRecord(storeName: StoreName, key: string): Promise<void> {
  const db = await getDB();
  await db.delete(storeName, key);
  broadcast(storeName, 'delete');
}

// ========== 级联删除 ==========

/** 级联删除工作区：Workspace 及其书签、待办和常驻标签子记录。 */
export async function cascadeDeleteWorkspace(workspaceId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    [
      'workspaces', 'categories', 'bookmarks', 'contexts', 'pinnedTabs',
      'taskLists', 'tasks', 'checklistItems', 'taskTags', 'taskTagAssignments',
    ],
    'readwrite',
  );

  const categories = await tx.objectStore('categories').index('by-workspaceId').getAll(workspaceId);
  const bookmarks = await tx.objectStore('bookmarks').index('by-workspaceId').getAll(workspaceId);
  const tasks = await tx.objectStore('tasks').index('by-workspaceId').getAll(workspaceId) as Task[];

  for (const task of tasks) {
    const checklistItems = await tx.objectStore('checklistItems').index('by-taskId').getAll(task.id) as ChecklistItem[];
    for (const item of checklistItems) await tx.objectStore('checklistItems').delete(item.id);
    const assignments = await tx.objectStore('taskTagAssignments').index('by-taskId').getAll(task.id) as TaskTagAssignment[];
    for (const assignment of assignments) await tx.objectStore('taskTagAssignments').delete([assignment.taskId, assignment.tagId]);
    await tx.objectStore('tasks').delete(task.id);
  }

  const taskLists = await tx.objectStore('taskLists').index('by-workspaceId').getAll(workspaceId) as TaskList[];
  for (const taskList of taskLists) await tx.objectStore('taskLists').delete(taskList.id);
  const taskTags = await tx.objectStore('taskTags').index('by-workspaceId').getAll(workspaceId) as TaskTag[];
  for (const taskTag of taskTags) await tx.objectStore('taskTags').delete(taskTag.id);

  for (const bookmark of bookmarks) {
    const contexts = await tx.objectStore('contexts').index('by-bookmarkId').getAll(bookmark.id);
    for (const context of contexts) await tx.objectStore('contexts').delete(context.id);
    await tx.objectStore('bookmarks').delete(bookmark.id);
  }
  for (const category of categories) await tx.objectStore('categories').delete(category.id);

  const pins = await tx.objectStore('pinnedTabs').index('by-workspaceId').getAll(workspaceId);
  for (const pin of pins) await tx.objectStore('pinnedTabs').delete(pin.id);
  await tx.objectStore('workspaces').delete(workspaceId);

  await tx.done;
  broadcast('bookmarks', 'delete');
  broadcast('pinnedTabs', 'delete');
  broadcast('tasks', 'delete');
  broadcast('taskLists', 'delete');
  broadcast('taskTags', 'delete');
}

/** 级联删除分类：Category → Bookmarks + Contexts */
export async function cascadeDeleteCategory(categoryId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['categories', 'bookmarks', 'contexts'], 'readwrite');

  const bookmarks = await tx.objectStore('bookmarks').index('by-categoryId').getAll(categoryId);
  const bookmarkIds = bookmarks.map((b) => b.id);

  for (const bookmarkId of bookmarkIds) {
    const contexts = await tx.objectStore('contexts').index('by-bookmarkId').getAll(bookmarkId);
    for (const ctx of contexts) {
      await tx.objectStore('contexts').delete(ctx.id);
    }
  }
  for (const bookmarkId of bookmarkIds) {
    await tx.objectStore('bookmarks').delete(bookmarkId);
  }
  await tx.objectStore('categories').delete(categoryId);

  await tx.done;
  broadcast('bookmarks', 'delete');
}

/** 删除书签及其关联上下文 */
export async function deleteBookmarkCascade(bookmarkId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['bookmarks', 'contexts'], 'readwrite');

  const contexts = await tx.objectStore('contexts').index('by-bookmarkId').getAll(bookmarkId);
  for (const ctx of contexts) {
    await tx.objectStore('contexts').delete(ctx.id);
  }
  await tx.objectStore('bookmarks').delete(bookmarkId);

  await tx.done;
  broadcast('bookmarks', 'delete');
}

// ========== 全量导出 / 覆盖导入 ==========

const DATA_STORES = [
  'workspaces', 'categories', 'bookmarks', 'contexts',
  'taskLists', 'tasks', 'checklistItems', 'taskTags', 'taskTagAssignments',
] as const;
const ALL_STORES = [...DATA_STORES, 'cryptoMetadata', 'pinnedTabs'] as const;
const BOOKMARK_IMPORT_STORES = [
  'workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata', 'pinnedTabs',
] as const;

/**
 * 导出全部数据。contexts 取底层 getAll（含密文，不解密）。
 */
export async function exportAllData(): Promise<BackupData> {
  return {
    workspaces: await getAll<Workspace>('workspaces'),
    categories: await getAll<Category>('categories'),
    bookmarks: await getAll<Bookmark>('bookmarks'),
    contexts: await getAll<Context>('contexts'),
    pinnedTabs: await getAll<PinnedTab>('pinnedTabs'),
    cryptoMetadata: (await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton')) ?? null,
    taskLists: await getAll<TaskList>('taskLists'),
    taskTags: await getAll<TaskTag>('taskTags'),
    tasks: await getAll<Task>('tasks'),
    checklistItems: await getAll<ChecklistItem>('checklistItems'),
    taskTagAssignments: await getAll<TaskTagAssignment>('taskTagAssignments'),
  };
}

/**
 * 覆盖式写入：单 readwrite 事务，4 必填数据表 clear 后 put；pinnedTabs 与 cryptoMetadata
 * 为可选字段，仅当 data 显式提供时才覆盖，字段缺失（v1 旧备份）保留现有数据——
 * 避免导入不含 pinnedTabs 的备份时静默清空用户已有常驻标签。
 * 仅做数据搬运 —— 不重算冗余字段、不 lock、不广播（由业务层 BackupService.applyImport 编排）。
 * 任一步失败事务整体回滚。
 */
export async function replaceAllDataRaw(data: BackupData): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([...ALL_STORES], 'readwrite');
  for (const s of DATA_STORES) {
    await tx.objectStore(s).clear();
  }
  for (const ws of data.workspaces) await tx.objectStore('workspaces').put(ws);
  for (const taskList of data.taskLists) await tx.objectStore('taskLists').put(taskList);
  for (const taskTag of data.taskTags) await tx.objectStore('taskTags').put(taskTag);
  for (const c of data.categories) await tx.objectStore('categories').put(c);
  for (const b of data.bookmarks) await tx.objectStore('bookmarks').put(b);
  for (const ctx of data.contexts) await tx.objectStore('contexts').put(ctx);
  for (const task of data.tasks) await tx.objectStore('tasks').put(task);
  for (const item of data.checklistItems) await tx.objectStore('checklistItems').put(item);
  for (const assignment of data.taskTagAssignments) {
    await tx.objectStore('taskTagAssignments').put(assignment);
  }
  // 可选字段：仅当显式提供时 clear+put；缺失则不动该 store
  if (data.pinnedTabs) {
    await tx.objectStore('pinnedTabs').clear();
    for (const p of data.pinnedTabs) await tx.objectStore('pinnedTabs').put(p);
  }
  if (data.cryptoMetadata) {
    await tx.objectStore('cryptoMetadata').put(data.cryptoMetadata);
  }
  await tx.done;
}

/**
 * 合并导入(分享包):单 readwrite 事务,纯 put 不 clear —— 保留接收方现有数据。
 *
 * 与 replaceAllDataRaw(全量覆盖)的关键区别:
 *  - 不 clear 任何 store(合并追加,非覆盖)
 *  - 不重算冗余字段 / 不 lock / 不广播(由调用方服务层编排)
 *
 * ID 重映射 + 同名后缀 + 冲突过滤由调用方在事务前完成,本函数只做原子搬运。
 * cryptoMeta 单独传入:经 salt 冲突过滤后的「最终写入决策」(全拷贝包 salt 相同时才写);
 * undefined → 不动接收方 cryptoMetadata store(保留原值)。
 * remapped.cryptoMetadata 是发送方原值,仅供决策参考,本函数不直接落盘。
 * 任一步失败事务整体回滚(数据 + cryptoMetadata 同生共死,无部分态)。
 */
export async function mergeImportRaw(remapped: BackupData, cryptoMeta?: CryptoMetadata): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([...BOOKMARK_IMPORT_STORES], 'readwrite');
  for (const ws of remapped.workspaces) await tx.objectStore('workspaces').put(ws);
  for (const c of remapped.categories) await tx.objectStore('categories').put(c);
  for (const b of remapped.bookmarks) await tx.objectStore('bookmarks').put(b);
  for (const ctx of remapped.contexts) await tx.objectStore('contexts').put(ctx);
  if (remapped.pinnedTabs) {
    for (const p of remapped.pinnedTabs) await tx.objectStore('pinnedTabs').put(p);
  }
  if (cryptoMeta) {
    await tx.objectStore('cryptoMetadata').put(cryptoMeta);
  }
  await tx.done;
}

// 导出类型供其他模块使用
export type { OctaneDB, StoreName };
