import {
  BACKUP_SCHEMA,
  BACKUP_VERSION,
} from '@/shared/types';
import type { BackupData, Bookmark, Category, Context, CryptoMetadata, Workspace } from '@/shared/types';
import { replaceAllDataRaw, broadcastChange, broadcastImport } from '@/shared/db/database';
import { syncContextMeta } from '@/services/ContextService';
import { lock } from '@/services/CryptoService';

export type ValidationResult =
  | { ok: true; data: BackupData }
  | { ok: false; error: string };

const DATA_TABLES = ['workspaces', 'categories', 'bookmarks', 'contexts'] as const;

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
  if (parsed.version !== BACKUP_VERSION) return { ok: false, error: '备份版本不受支持，请升级 octane' };

  const data = parsed.data;
  if (!isObj(data)) return { ok: false, error: '备份数据缺失' };
  for (const t of DATA_TABLES) {
    if (!Array.isArray(data[t])) return { ok: false, error: `备份数据表 ${t} 缺失或非数组` };
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
 */
export async function applyImport(data: BackupData): Promise<void> {
  await replaceAllDataRaw(data);
  // 重算冗余字段：防备份被篡改导致解锁 gate 错乱
  for (const b of data.bookmarks) {
    await syncContextMeta(b.id);
  }
  // 清 session 旧密钥：salt 已变，旧密钥与新数据不匹配
  await lock();
  // 广播：side panel（store 级）+ newtab（全量 import 事件）
  broadcastChange('bookmarks', 'put');
  broadcastImport();
}