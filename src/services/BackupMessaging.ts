import { applyImport, applyShareImport, type ShareImportResult } from '@/services/BackupService';
import type { BackupData, ShareSelection } from '@/shared/types';

export type ImportMessage = { type: 'octane:apply-import'; data: BackupData };
export type ShareImportMessage = {
  type: 'octane:apply-share-import';
  data: BackupData;
  selection: ShareSelection;
};
export type HandlerResult =
  | { ok: true; result?: ShareImportResult }
  | { ok: false; error: string };

/**
 * background 消息路由。返回 undefined 表示消息与本模块无关（交给其他 listener）。
 * 纯函数（不直接依赖 browser 全局），便于单测；messaging 管道（addListener）在
 * src/entrypoints/background.ts 注册。放在 services 而非 entrypoints：WXT 会把
 * entrypoints/ 下每个文件视为入口，background.handlers 与 background 命名冲突。
 *
 * 两条独立通道：octane:apply-import（全量覆盖）与 octane:apply-share-import（分享合并）
 * 互不可越界（kind 误入口防护 C2 消息层）。
 */
export async function handleMessage(
  msg: unknown,
): Promise<HandlerResult | undefined> {
  if (typeof msg !== 'object' || msg === null) return undefined;
  const m = msg as { type?: unknown };
  if (m.type === 'octane:apply-import') {
    try {
      await applyImport((m as ImportMessage).data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message || '导入失败' };
    }
  }
  if (m.type === 'octane:apply-share-import') {
    try {
      const result = await applyShareImport(
        (m as ShareImportMessage).data,
        (m as ShareImportMessage).selection,
      );
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: (e as Error).message || '导入失败' };
    }
  }
  return undefined;
}
