import { applyImport } from '@/services/BackupService';
import type { BackupData } from '@/shared/types';

export type ImportMessage = { type: 'octane:apply-import'; data: BackupData };
export type HandlerResult = { ok: true } | { ok: false; error: string };

/**
 * background 消息路由。返回 undefined 表示消息与本模块无关（交给其他 listener）。
 * 纯函数（不直接依赖 browser 全局），便于单测；messaging 管道（addListener）在
 * src/entrypoints/background.ts 注册。放在 services 而非 entrypoints：WXT 会把
 * entrypoints/ 下每个文件视为入口，background.handlers 与 background 命名冲突。
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
  return undefined;
}
