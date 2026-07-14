import type { BackupData, Bookmark, Context, CryptoMetadata } from '@/shared/types';

/**
 * 分享导入服务层纯函数(0.1.11.3 第4步)。
 *
 * 纯函数 + 单测先行(TDD)。不碰 DB / chrome / 网络 —— 所有副作用(事务、广播、
 * salt 冲突判定需读接收方 cryptoMetadata)由编排层(applyShareImport,Task6)注入。
 * 这里只做数据变换:ID 重映射、同名后缀、死密文过滤、冗余字段预修正。
 */

/** 默认 ID 生成器:crypto.randomUUID(MV3 service worker 可用)。测试注入确定性 genId。 */
function defaultGenId(): string {
  return crypto.randomUUID();
}

/**
 * 重映射分享包所有 ID(主键 + 外键)为接收方库内全新 ID。
 *
 * 建 5 个 Map(workspace/category/bookmark/context/pinnedTab):oldId → newId,
 * 第二遍重写所有主键 + 外键。eng-review A1:pinnedTab.id 主键 + workspaceId FK
 * 都必须 remap(与 Bookmark 双 FK 同类陷阱——主键不 remap 会低概率撞接收方现有 ID)。
 *
 * 纯函数:不 mutate 输入,不碰 DB/crypto。cryptoMetadata 原样透传(由调用方决策写入)。
 */
export function remapShareIds(data: BackupData, genId: () => string = defaultGenId): BackupData {
  const wsMap = new Map<string, string>();
  const catMap = new Map<string, string>();
  const bmMap = new Map<string, string>();
  const ctxMap = new Map<string, string>();
  const pinMap = new Map<string, string>();

  // 第一遍:建主键映射
  for (const ws of data.workspaces) wsMap.set(ws.id, genId());
  for (const c of data.categories) catMap.set(c.id, genId());
  for (const b of data.bookmarks) bmMap.set(b.id, genId());
  for (const ctx of data.contexts) ctxMap.set(ctx.id, genId());
  if (data.pinnedTabs) for (const p of data.pinnedTabs) pinMap.set(p.id, genId());

  // 第二遍:重写主键 + FK(Bookmark 双 FK + pinnedTab 主键+FK)
  const workspaces = data.workspaces.map((ws) => ({ ...ws, id: wsMap.get(ws.id)! }));
  const categories = data.categories.map((c) => ({
    ...c,
    id: catMap.get(c.id)!,
    workspaceId: wsMap.get(c.workspaceId)!,
  }));
  const bookmarks = data.bookmarks.map((b) => ({
    ...b,
    id: bmMap.get(b.id)!,
    workspaceId: wsMap.get(b.workspaceId)!,
    categoryId: catMap.get(b.categoryId)!,
  }));
  const contexts = data.contexts.map((ctx) => ({
    ...ctx,
    id: ctxMap.get(ctx.id)!,
    bookmarkId: bmMap.get(ctx.bookmarkId)!,
  }));
  const pinnedTabs = data.pinnedTabs?.map((p) => ({
    ...p,
    id: pinMap.get(p.id)!,
    workspaceId: wsMap.get(p.workspaceId)!,
  }));

  return { workspaces, categories, bookmarks, contexts, pinnedTabs, cryptoMetadata: data.cryptoMetadata };
}

/** 接收方已有的同名集合(workspace/category),用于同名后缀判定 */
export interface ExistingNames {
  workspaces: Set<string>;
  categories: Set<string>;
}

/**
 * 同名冲突处理(Premise 4):接收方已有同名 workspace/category 时,分享内容创建为新副本
 * (追加「 (导入)」后缀,循环数字);bookmark/pinnedTab 同名静默创建副本(ID 已重映射为独立实体)。
 * 纯函数:不 mutate 输入。
 */
export function resolveNameConflicts(data: BackupData, existing: ExistingNames): BackupData {
  const wsNames = new Set(existing.workspaces);
  const catNames = new Set(existing.categories);
  const workspaces = data.workspaces.map((ws) => ({ ...ws, name: uniqueName(ws.name, wsNames) }));
  const categories = data.categories.map((c) => ({ ...c, name: uniqueName(c.name, catNames) }));
  return { ...data, workspaces, categories };
}

/** 循环数字后缀:base → 「base (导入)」→ 「base (导入 2)」… 直到不撞 taken */
function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let i = 1;
  let name = `${base} (导入)`;
  while (taken.has(name)) {
    i += 1;
    name = `${base} (导入 ${i})`;
  }
  taken.add(name);
  return name;
}

/** 死密文过滤结果 */
export interface SaltFilterResult {
  contexts: Context[];
  /** 因接收方 salt 不同被过滤的加密 context 数(用于提示「N 条未导入」) */
  skippedEncrypted: number;
}

/**
 * 死密文过滤(N1):全拷贝包导入到「已设不同密码(salt 不同)」的接收方时,加密 context 的密文
 * 用发送方 salt 派生的 key 加密,接收方 key 解不开 → 永久占位死密文。过滤掉,仅保留明文。
 *
 * 接收方无 cryptoMetadata(将写 senderMeta,用 senderSalt 解)/ salt 相同 → 保留全部。
 * senderSalt null(仅结构包,本就无加密)→ 保留全部。纯函数。
 */
export function filterEncryptedBySalt(
  contexts: Context[],
  senderSalt: string | null,
  receiverMeta: CryptoMetadata | null,
): SaltFilterResult {
  if (!receiverMeta || senderSalt === null || senderSalt === receiverMeta.salt) {
    return { contexts, skippedEncrypted: 0 };
  }
  let skipped = 0;
  const filtered = contexts.filter((ctx) => {
    if (ctx.isEncrypted) {
      skipped += 1;
      return false;
    }
    return true;
  });
  return { contexts: filtered, skippedEncrypted: skipped };
}

/**
 * 冗余字段预修正(F1):按 contexts 实际数量重算各 bookmark 的 contextCount / hasEncryptedContext。
 * 分享包内发送方冗余值已失效(仅结构包应为 0/false;全拷贝包为发送方值),且 salt 冲突过滤后会变。
 * 事务前预修正,避免「落盘 → syncContextMeta 重算」窗口期 UI 显示不准。纯函数。
 */
export function recomputeRedundancy(bookmarks: Bookmark[], contexts: Context[]): Bookmark[] {
  const byBm = new Map<string, Context[]>();
  for (const ctx of contexts) {
    const arr = byBm.get(ctx.bookmarkId);
    if (arr) arr.push(ctx);
    else byBm.set(ctx.bookmarkId, [ctx]);
  }
  return bookmarks.map((b) => {
    const ctxs = byBm.get(b.id) ?? [];
    return {
      ...b,
      contextCount: ctxs.length,
      hasEncryptedContext: ctxs.some((c) => c.isEncrypted),
    };
  });
}

// ── T2:分享导入 order 重映射(0.1.12 波2)──

/** 稳定排序比较:按 (order, createdAt, id) 升序。order 相同 → createdAt;再相同 → id 字符串。 */
function compareByOrderCreated<T extends { order: number; createdAt: number; id: string }>(
  a: T,
  b: T,
): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 按父容器分子组重排 order:每组内按发送方 (order, createdAt, id) 稳定排序后各自从 0 起赋序。
 * 不同父容器子组各自独立(非全局连续)——接收方在每个新建容器内无现有数据。
 * 保持原数组顺序,只改 order 字段。纯函数:不 mutate 输入。
 */
function regroupOrderFromZero<T extends { order: number; createdAt: number; id: string }>(
  items: readonly T[],
  groupKey: (item: T) => string,
): T[] {
  // 第一遍:按父容器分组(保留首次出现顺序)
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = groupKey(item);
    const arr = groups.get(key);
    if (arr) arr.push(item);
    else groups.set(key, [item]);
  }
  // 第二遍:每组稳定排序 → 建 id → newOrder 映射
  const newOrder = new Map<string, number>();
  for (const arr of groups.values()) {
    const sorted = [...arr].sort(compareByOrderCreated);
    sorted.forEach((item, i) => newOrder.set(item.id, i));
  }
  // 第三遍:按原数组顺序输出,仅替换 order
  return items.map((item) => ({ ...item, order: newOrder.get(item.id)! }));
}

/**
 * 分享导入 order 重映射(T2 纯函数)。
 *
 * 前提:remapShareIds 已给所有实体新 ID,导入实体总是新建(resolveNameConflicts 加后缀创建副本,
 * 不合并到接收方现有实体)。故只有 workspaces 组需查接收方 maxOrder(追加在其后);
 * categories / bookmarks / pinnedTabs 的父容器均为新建实体,接收方在该容器内无现有数据 →
 * 每个父容器子组各自从 0 起赋序(非全局连续)。
 *
 * 算法:
 * 1. workspaces:按发送方 (order, createdAt, id) 稳定排序,赋 receiverMaxWorkspaceOrder+1, +2, ...
 * 2. categories:按 workspaceId 分组,各组从 0 起
 * 3. bookmarks:按 categoryId 分组,各组从 0 起
 * 4. pinnedTabs:按 workspaceId 分组,各组从 0 起
 *
 * 纯函数:不碰 DB/crypto,不 mutate 输入,不改 ID(只重排 order)。
 * receiverMaxWorkspaceOrder 由编排层(applyShareImport)注入(读接收方现有 ws max order,空集 → -1)。
 */
export function reorderForImport(
  data: BackupData,
  receiverMaxWorkspaceOrder: number,
): BackupData {
  // workspaces:全局一组,排序算 newOrder 后按原数组顺序输出(只改 order,不改顺序/ID)
  const wsSorted = [...data.workspaces].sort(compareByOrderCreated);
  const wsNewOrder = new Map<string, number>();
  wsSorted.forEach((ws, i) => wsNewOrder.set(ws.id, receiverMaxWorkspaceOrder + 1 + i));
  const workspaces = data.workspaces.map((ws) => ({ ...ws, order: wsNewOrder.get(ws.id)! }));
  const categories = regroupOrderFromZero(data.categories, (c) => c.workspaceId);
  const bookmarks = regroupOrderFromZero(data.bookmarks, (b) => b.categoryId);
  const pinnedTabs = data.pinnedTabs
    ? regroupOrderFromZero(data.pinnedTabs, (p) => p.workspaceId)
    : data.pinnedTabs;
  return { ...data, workspaces, categories, bookmarks, pinnedTabs };
}
