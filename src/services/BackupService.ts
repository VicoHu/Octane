import {
  BACKUP_SCHEMA,
  BACKUP_VERSION,
  ACCEPTED_BACKUP_VERSIONS,
} from '@/shared/types';
import type { BackupData, Bookmark, Category, Context, CryptoMetadata, PinnedTab, Workspace } from '@/shared/types';
import { exportAllData, replaceAllDataRaw, broadcastChange, broadcastImport } from '@/shared/db/database';
import { syncContextMeta } from '@/services/ContextService';
import { lock } from '@/services/CryptoService';

export type ValidationResult =
  | { ok: true; data: BackupData }
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
 * 校验已解析的备份对象（不读文件、不碰 DB）。
 * 返回 ok 时 data 为规范化后的 BackupData。
 */
export function validateBackup(parsed: unknown): ValidationResult {
  if (!isObj(parsed)) return { ok: false, error: '备份文件格式无效' };
  if (parsed.schema !== BACKUP_SCHEMA) return { ok: false, error: '不是 octane 备份文件' };
  if (typeof parsed.version !== 'number' || !ACCEPTED_BACKUP_VERSIONS.includes(parsed.version)) {
    return { ok: false, error: '备份版本不受支持，请升级 octane' };
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

  const backupData: BackupData = {
    workspaces: data.workspaces as Workspace[],
    categories: data.categories as Category[],
    bookmarks: data.bookmarks as Bookmark[],
    contexts: data.contexts as Context[],
    pinnedTabs,
    cryptoMetadata: (meta ?? null) as CryptoMetadata | null,
  };
  return { ok: true, data: backupData };
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
  // 广播：side panel（store 级，按 spec 对 5 表显式触发）+ newtab（全量 import 事件）
  broadcastChange('workspaces', 'put');
  broadcastChange('categories', 'put');
  broadcastChange('bookmarks', 'put');
  broadcastChange('contexts', 'put');
  broadcastChange('pinnedTabs', 'put');
  broadcastImport();
}

/**
 * 构建备份 Blob（导出与云上传共用同一份）。
 * 内部取存储态 exportAllData（contexts 含密文，不解密）。
 */
export async function buildBackupBlob(): Promise<Blob> {
  const data = await exportAllData();
  const file = {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    appVersion: browser.runtime.getManifest().version,
    data,
  };
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
}
