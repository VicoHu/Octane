import { useState, useEffect, useCallback } from 'react';
import {
  getTagFilterMemoryScope,
  setTagFilterMemoryScope,
  DEFAULT_TAG_FILTER_MEMORY_SCOPE,
  type TagFilterMemoryScope,
} from '@/shared/tagFilterMemorySetting';

export type TagFilterMemoryLoadStatus = 'loading' | 'ready' | 'error';

/**
 * Tag 筛选记忆范围设置 hook（供设置分区 UI 读/写 scope）。
 *
 * - 挂载时读 storage.local 的 scope（默认 category）→ status: loading→ready。
 * - updateScope：写 storage + 同步 React state（行内即时反馈，不弹 Toast）。
 *
 * Content 的记忆执行逻辑实时读 storage（非本 hook 的 state），保证多窗口/设置改动后
 * 总是用最新值；本 hook 的 state 仅驱动设置分区 RadioGroup 的选中态。
 */
export function useTagFilterMemorySetting() {
  const [scope, setScope] = useState<TagFilterMemoryScope>(DEFAULT_TAG_FILTER_MEMORY_SCOPE);
  const [status, setStatus] = useState<TagFilterMemoryLoadStatus>('loading');

  useEffect(() => {
    let active = true;
    getTagFilterMemoryScope()
      .then((s) => {
        if (active) {
          setScope(s);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const updateScope = useCallback(async (value: TagFilterMemoryScope) => {
    await setTagFilterMemoryScope(value);
    setScope(value);
  }, []);

  return { scope, status, updateScope };
}
