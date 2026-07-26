import {
  BACKUP_SCHEMA,
  BACKUP_VERSION,
  ACCEPTED_BACKUP_VERSIONS,
} from '@/shared/types';
import type { BackupData, BackupKind, Bookmark, Category, Context, CryptoMetadata, PinnedTab, Workspace, ShareSelection } from '@/shared/types';
import { exportAllData, replaceAllDataRaw, mergeImportRaw, getAll, getByKey, broadcastChange, broadcastImport } from '@/shared/db/database';
import { syncContextMeta } from '@/services/ContextService';
import { lock } from '@/services/CryptoService';
import { remapShareIds, resolveNameConflicts, filterEncryptedBySalt, recomputeRedundancy, reorderForImport } from '@/services/shareImport';
import type { ExistingNames } from '@/services/shareImport';
import { validateTag, MAX_TAG_LENGTH, MAX_TAG_COUNT } from '@/shared/utils/tagRules';

export type ValidationResult =
  | { ok: true; data: BackupData; kind: BackupKind }
  | { ok: false; error: string };

const DATA_TABLES = ['workspaces', 'categories', 'bookmarks', 'contexts'] as const;
// pinnedTabs 故意不在 DATA_TABLES：它是 BackupData 的 optional 字段（v1 旧备份无此字段），
// 校验与 replaceAllDataRaw 都按「字段缺失→保留现有数据，存在→覆盖」单独处理（见 database.ts）。

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function hasString(v: unknown, ...keys: string[]): boolean {
  return isObj(v) && keys.every((k) => typeof v[k] === 'string');
}

/**
 * 旧版本（v1/v2/v3）备份 bookmark 无 order → 按 categoryId 分组、组内 (createdAt ASC, id ASC)
 * 回填 order=0,1,2...。与 DB v4→v5 迁移算法一致（见 database.ts runUpgrade）。
 */
function normalizeBookmarkOrder(bookmarks: Bookmark[]): Bookmark[] {
  const groups = new Map<string, Bookmark[]>();
  for (const b of bookmarks) {
    const arr = groups.get(b.categoryId) ?? [];
    arr.push(b);
    groups.set(b.categoryId, arr);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    arr.forEach((b, i) => {
      b.order = i;
    });
  }
  return bookmarks;
}

/**
 * 校验 / 规范化 bookmark tags。
 *
 * 严格 vs 兼容的边界由备份 schema 版本号区分（Issue #55）：
 * - v4 及以下（旧格式，不支持 tags）：缺 tags → 回填 []，已有 tags 原样保留。
 * - v5+（声明支持 tags 的新格式）：tags 必须是符合数量、长度、空白和大小写去重规则的
 *   字符串数组。非法数据（非数组、非字符串、重复、空白、超长、超量、需 trim）→ 明确拒绝，
 *   不做截断、删除、拼接或其他静默修改。
 */
function validateAndNormalizeTags(
  version: number,
  bookmarks: Bookmark[],
): { ok: true; bookmarks: Bookmark[] } | { ok: false; error: string } {
  if (version < BACKUP_VERSION) {
    // 旧版本：缺 tags → 回填空数组（与 DB v5→v6 迁移一致）
    for (const b of bookmarks) {
      if (!Array.isArray(b.tags)) b.tags = [];
    }
    return { ok: true, bookmarks };
  }

  // v5+ 严格校验：tags 必须是合法的字符串数组
  for (const b of bookmarks) {
    if (!Array.isArray(b.tags)) {
      return { ok: false, error: `书签 ${b.id} 的 tags 必须是数组` };
    }
    for (const tag of b.tags) {
      if (typeof tag !== 'string') {
        return { ok: false, error: `书签 ${b.id} 的 tag 必须是字符串` };
      }
      // validateTag 返回 trim 后的合法值或 null；严格模式下要求 tag 已是规范形式（无 trim 需求）
      const validated = validateTag(tag);
      if (validated === null) {
        return { ok: false, error: `书签 ${b.id} 的 tag "${tag}" 不合法（空白或超长，上限 ${MAX_TAG_LENGTH} 字符）` };
      }
      if (validated !== tag) {
        return { ok: false, error: `书签 ${b.id} 的 tag "${tag}" 需 trim，不做静默修改` };
      }
    }
    // 数量上限
    if (b.tags.length > MAX_TAG_COUNT) {
      return { ok: false, error: `书签 ${b.id} 的 tag 数量超过上限 ${MAX_TAG_COUNT}` };
    }
    // 大小写不敏感去重检查（重复 → 拒绝，不做静默去重）
    const lower = b.tags.map((t) => t.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      return { ok: false, error: `书签 ${b.id} 的 tag 存在大小写不敏感的重复` };
    }
  }
  return { ok: true, bookmarks };
}

/**
 * 校验已解析的备份对象（不读文件、不碰 DB）。
 * 返回 ok 时 data 为规范化后的 BackupData。
 */
export function validateBackup(parsed: unknown): ValidationResult {
  if (!isObj(parsed)) return { ok: false, error: '备份文件格式无效' };
  if (parsed.schema !== BACKUP_SCHEMA) return { ok: false, error: '不是 octane 备份文件' };
  if (typeof parsed.version !== 'number' || !ACCEPTED_BACKUP_VERSIONS.includes(parsed.version)) {
    return { ok: false, error: '备份版本不受支持，请升级 octane' };
  }

  // kind：v3 起区分 backup（全量覆盖恢复）/ share（部分合并导入）。
  // 缺失（v1/v2 旧文件）→ 默认 'backup'（向后兼容）；非法值 → 拒绝。
  // kind 误入口防护（C2）依赖此字段：备份入口拒绝 share、分享入口拒绝 backup。
  const rawKind = parsed.kind;
  let kind: BackupKind;
  if (rawKind === undefined) {
    kind = 'backup';
  } else if (rawKind === 'backup' || rawKind === 'share') {
    kind = rawKind;
  } else {
    return { ok: false, error: '备份种类字段无效' };
  }

  const data = parsed.data;
  if (!isObj(data)) return { ok: false, error: '备份数据缺失' };
  for (const t of DATA_TABLES) {
    if (!Array.isArray(data[t])) return { ok: false, error: `备份数据表 ${t} 缺失或非数组` };
  }

  // pinnedTabs：v2+ 必须是数组；v1 旧备份无此字段 → 保持 undefined
  // （不 backfill []——[] 是 truthy，会让 replaceAllDataRaw 的 if(data.pinnedTabs) 误清空现有数据）
  const rawPinnedTabs = data.pinnedTabs;
  let pinnedTabs: PinnedTab[] | undefined;
  if (rawPinnedTabs === undefined) {
    if (parsed.version !== 1) {
      return { ok: false, error: '备份缺失 pinnedTabs 字段（v2+ 必填）' };
    }
    pinnedTabs = undefined;
  } else if (Array.isArray(rawPinnedTabs)) {
    pinnedTabs = rawPinnedTabs as PinnedTab[];
  } else {
    return { ok: false, error: '备份数据表 pinnedTabs 非数组' };
  }
  if (pinnedTabs) {
    for (const p of pinnedTabs) {
      if (!hasString(p, 'id', 'workspaceId', 'url')) {
        return { ok: false, error: '常驻标签数据缺少必需字段（id/workspaceId/url）' };
      }
    }
  }

  for (const b of data.bookmarks as unknown[]) {
    if (!hasString(b, 'id', 'workspaceId', 'categoryId')) {
      return { ok: false, error: '书签数据缺少必需字段（id/workspaceId/categoryId）' };
    }
  }
  for (const c of data.contexts as unknown[]) {
    if (!hasString(c, 'id', 'bookmarkId')) {
      return { ok: false, error: '上下文数据缺少必需字段（id/bookmarkId）' };
    }
  }

  const contexts = data.contexts as Array<{ isEncrypted?: boolean }>;
  const hasEncrypted = contexts.some((c) => c.isEncrypted === true);
  const meta = data.cryptoMetadata;
  if (hasEncrypted && meta == null) {
    return { ok: false, error: '备份含加密数据但缺少加密元数据，无法恢复' };
  }

  // 标准化 bookmark order：v1/v2/v3 旧备份 bookmark 无 order → 按 categoryId 分组
  //(createdAt ASC, id ASC)回填，与 DB v4→v5 迁移一致；v4+ 已有 order 原样保留。
  const rawBookmarks = data.bookmarks as Bookmark[];
  const ordered = parsed.version < 4 ? normalizeBookmarkOrder(rawBookmarks) : rawBookmarks;
  // 标准化 bookmark tags：v4 及以下旧备份缺 tags → 回填空数组；v5+ 严格校验（非法即拒绝）
  const tagsResult = validateAndNormalizeTags(parsed.version, ordered);
  if (!tagsResult.ok) return { ok: false, error: tagsResult.error };
  const bookmarks = tagsResult.bookmarks;

  const backupData: BackupData = {
    workspaces: data.workspaces as Workspace[],
    categories: data.categories as Category[],
    bookmarks,
    contexts: data.contexts as Context[],
    pinnedTabs,
    cryptoMetadata: (meta ?? null) as CryptoMetadata | null,
  };
  return { ok: true, data: backupData, kind };
}

/** 备份文件大小上限：50MB（防止 JSON.parse 卡死/内存溢出） */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/**
 * 读取文件 + 大小校验 + JSON 解析 + 结构校验。
 * 单一返回类型，与 validateBackup 一致。
 */
export async function parseBackupFile(file: File): Promise<ValidationResult> {
  if (file.size > MAX_BACKUP_BYTES) {
    return { ok: false, error: `备份文件过大（超过 50MB），已拒绝` };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: '备份文件读取失败' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '备份文件不是合法 JSON' };
  }
  return validateBackup(parsed);
}

/**
 * 应用导入：覆盖事务 → 重算冗余字段 → lock session → 广播。
 * 必须在 background service worker 调用（事务不可被 popup 中断）。
 *
 * 数据完整性优先：replaceAllDataRaw 事务一旦 await tx.done 即已落盘。
 * 之后重算冗余字段 / lock / 广播任一失败都不应让整体返回失败，
 * 否则会出现「数据已全量替换但 popup 显示导入失败」的误导，以及
 * session 旧密钥残留 + salt 已变的半死态。
 */
export async function applyImport(data: BackupData): Promise<void> {
  await replaceAllDataRaw(data);
  // 重算冗余字段：防备份被篡改导致解锁 gate 错乱。
  // 视为非致命：单个 bookmark 元数据异常不应阻断后续 lock / 广播。
  try {
    for (const b of data.bookmarks) {
      await syncContextMeta(b.id);
    }
  } catch (e) {
    console.warn('[octane] 重算冗余字段部分失败', e);
  }
  // 清 session 旧密钥：salt 已变，旧密钥与新数据不匹配。必执行。
  await lock();
  // 广播：side panel（store 级，按 spec 对 5 表显式触发）+ home（全量 import 事件）
  broadcastChange('workspaces', 'put');
  broadcastChange('categories', 'put');
  broadcastChange('bookmarks', 'put');
  broadcastChange('contexts', 'put');
  broadcastChange('pinnedTabs', 'put');
  broadcastImport();
}

/**
 * 按分享选择集从全量数据精确取数,产出 kind:'share' 的自洽 BackupData(不含顶层 schema 包装)。
 * 纯函数:不碰 DB/crypto/网络。自洽由取数顺序保证(Premise 2:无孤儿)。
 *
 * 规范化(导出方自洽):
 * - 整选 workspace → 纳入其全部分类 + 该 workspace 的 pinnedTabs
 * - 单选 category(其 workspace 未整选)→ 连带 parent workspace(自洽必需,防孤儿 category)
 *   + 其书签,但【不连带】该 workspace 的 pinnedTabs
 *   (用户决策 B:隐私克制——单选分类不多带可能私密的常驻标签)
 */
export function buildShareData(
  all: BackupData,
  selection: ShareSelection,
  includeContexts: boolean,
): BackupData {
  const wsIdSet = new Set(selection.workspaceIds);
  // 规范化分类集:整选 ws 的全部分类 + 单选 category
  const effectiveCatIds = new Set(selection.categoryIds);
  for (const c of all.categories) {
    if (wsIdSet.has(c.workspaceId)) effectiveCatIds.add(c.id);
  }
  // 规范化工作区集:单选 category 的 parent ws 纳入(自洽——category.workspaceId 必须指向包内 ws)
  const effectiveWsIds = new Set(selection.workspaceIds);
  for (const c of all.categories) {
    if (effectiveCatIds.has(c.id)) effectiveWsIds.add(c.workspaceId);
  }

  const workspaces = all.workspaces.filter((w) => effectiveWsIds.has(w.id));
  const categories = all.categories.filter((c) => effectiveCatIds.has(c.id));
  const bookmarks = all.bookmarks.filter((b) => effectiveCatIds.has(b.categoryId));
  const bookmarkIds = new Set(bookmarks.map((b) => b.id));
  // pinnedTabs 只跟「整选工作区」(wsIdSet=selection.workspaceIds)——单选 category 连带的 ws
  //(在 effectiveWsIds 但不在 wsIdSet)的常驻标签不连带(决策 B)。
  const pinnedTabs = (all.pinnedTabs ?? []).filter((p) => wsIdSet.has(p.workspaceId));
  const contexts = includeContexts
    ? all.contexts.filter((ctx) => bookmarkIds.has(ctx.bookmarkId))
    : [];
  const cryptoMetadata = includeContexts ? all.cryptoMetadata : null;

  return { workspaces, categories, bookmarks, contexts, pinnedTabs, cryptoMetadata };
}

/** 分享包导入结果(返回给 UI 显示数量 + salt 冲突提示) */
export interface ShareImportResult {
  workspaces: number;
  categories: number;
  bookmarks: number;
  /** 因接收方 salt 不同被过滤的加密 context 数 */
  skippedEncrypted: number;
}

/**
 * 合并导入分享包(接收方)。单事务 put 不 clear,不覆盖接收方现有数据。
 * 编排(design doc 导入步骤5-10):
 *   buildShareData 过滤(复用,决策 B 对称)→ remapShareIds → recomputeRedundancy →
 *   resolveNameConflicts(读接收方同名)→ filterEncryptedBySalt(读接收方 cryptoMetadata)→
 *   mergeImportRaw 单事务 → syncContextMeta 兜底 → broadcast。
 * 不调 lock()(合并不改接收方加密设置)。
 */
export async function applyShareImport(
  data: BackupData,
  selection: ShareSelection,
): Promise<ShareImportResult> {
  // 1. 识别模式:全拷贝(cryptoMetadata 非空)vs 仅结构
  const senderSalt = data.cryptoMetadata?.salt ?? null;
  const includeContexts = data.cryptoMetadata !== null;
  // 2. 接收方过滤(复用 buildShareData,决策 B 对称)
  const selected = buildShareData(data, selection, includeContexts);
  // 3. ID 重映射(5 Map + 双 FK + pinnedTab 主键)
  const remapped = remapShareIds(selected);
  // 4. 冗余字段预修正(按包内实际 context 数)
  const recomputed: BackupData = {
    ...remapped,
    bookmarks: recomputeRedundancy(remapped.bookmarks, remapped.contexts),
  };
  // 5. 读接收方现有同名(workspace/category)+ 现有 ws max order(T2:分享 ws 追加在其后)
  const [existingWs, existingCat] = await Promise.all([
    getAll<Workspace>('workspaces'),
    getAll<Category>('categories'),
  ]);
  const existing: ExistingNames = {
    workspaces: new Set(existingWs.map((w) => w.name)),
    categories: new Set(existingCat.map((c) => c.name)),
  };
  // 接收方现有 ws 最大 order(空库 → -1,新 ws 从 0 起);单用户扩展无并发,maxOrder 读在事务前
  const receiverMaxWsOrder = existingWs.reduce((m, w) => Math.max(m, w.order), -1);
  // 6. 同名后缀 + order 重映射(T2:ws 追加 maxOrder+1;cat/bm/pin 按父容器各自从 0 起)
  const resolved = reorderForImport(resolveNameConflicts(recomputed, existing), receiverMaxWsOrder);
  // 7. 读接收方 cryptoMetadata
  const receiverMeta = (await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton')) ?? null;
  // 8. 死密文过滤(salt 冲突)
  const { contexts: filteredContexts, skippedEncrypted } = filterEncryptedBySalt(
    resolved.contexts,
    senderSalt,
    receiverMeta,
  );
  // 9. cryptoMetadata 写入决策:接收方无 / salt 相同 → 写发送方;salt 不同 → 不写(保留接收方)
  const writeMeta =
    !receiverMeta || senderSalt === null || senderSalt === receiverMeta.salt
      ? resolved.cryptoMetadata
      : undefined;
  // 10. 单事务合并(cryptoMetaToWrite 为 null/undefined 时不写)
  await mergeImportRaw({ ...resolved, contexts: filteredContexts }, writeMeta ?? undefined);
  // 11. syncContextMeta 兜底(非致命)
  try {
    for (const b of resolved.bookmarks) {
      await syncContextMeta(b.id);
    }
  } catch (e) {
    console.warn('[octane] 分享导入重算冗余字段部分失败', e);
  }
  // 12. 广播(不 lock)
  broadcastChange('workspaces', 'put');
  broadcastChange('categories', 'put');
  broadcastChange('bookmarks', 'put');
  broadcastChange('contexts', 'put');
  broadcastChange('pinnedTabs', 'put');
  broadcastImport();
  // 13. 返回数量 + 冲突计数
  return {
    workspaces: resolved.workspaces.length,
    categories: resolved.categories.length,
    bookmarks: resolved.bookmarks.length,
    skippedEncrypted,
  };
}

/**
 * 构建备份 Blob(导出与云上传共用同一份)。
 * - 无 selection / 空选 → 全量备份(kind:'backup'),逐字节与历史一致(灾备网锁定)。
 * - 有 selection → 分享包(kind:'share'),按选择集精确取数,上下文按 includeContexts 全带/全不带。
 */
export async function buildBackupBlob(
  selection?: ShareSelection,
  includeContexts = false,
): Promise<Blob> {
  const data = await exportAllData();
  const hasSelection =
    !!selection && (selection.workspaceIds.length > 0 || selection.categoryIds.length > 0);
  const shareData = hasSelection ? buildShareData(data, selection!, includeContexts) : data;
  const file = {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    kind: (hasSelection ? 'share' : 'backup') as BackupKind,
    exportedAt: Date.now(),
    appVersion: browser.runtime.getManifest().version,
    data: shareData,
  };
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
}
