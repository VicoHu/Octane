/**
 * 工作区切换门控入口（home 层，AppRail/Sidebar 共用，设计 rev4 #13 单命令不各自拼装）。
 *
 * 实时读隔离设置（storage.local）+ 本窗 id，委托 switchWorkspaceBySetting 分流：
 * - close + windowId：requestWorkspaceSwitch 编排 tab（archive/dispose/restore + binding）
 *   + selectWorkspace 同步 store 选中态/分类。
 * - off 或非扩展环境（windowId=null）：仅 selectWorkspace（当前行为，不碰 tab）。
 *
 * 实时读 storage（非 React state 缓存）保证总是用最新设置，不受多窗口/设置改动后 state 过期影响。
 * 进度反馈（Spinner/aria-disabled/loading Toast）为 T8 范围，届时以 hook 形态承载 React state。
 */
import { useCallback, useEffect, useState } from 'react';
import { useWorkspace, getCurrentWindowId } from '@/store/useWorkspace';
import { switchWorkspaceBySetting } from '@/shared/tabs/workspaceSwitch';
import { Toast } from '@/components/ui/toast';
import {
  getTabIsolationSetting,
  setTabIsolationSetting,
  type TabIsolationSetting,
} from '@/shared/tabIsolationSetting';

export async function switchWorkspace(toId: string): Promise<void> {
  const setting = await getTabIsolationSetting();
  const windowId = await getCurrentWindowId();
  const result = await switchWorkspaceBySetting({
    toId,
    setting,
    windowId,
    selectWorkspace: useWorkspace.getState().selectWorkspace,
  });
  // T4：close 模式且关闭了 tab（N>0）→ 弹切换结果 Toast（action「切回」非"撤销"——完整反转切换）
  if (result.closedCount > 0 && result.fromId) {
    const workspaces = useWorkspace.getState().workspaces;
    const toName = workspaces.find((w) => w.id === toId)?.name ?? toId;
    const fromName = workspaces.find((w) => w.id === result.fromId)?.name ?? result.fromId;
    Toast.success({
      content: `已切换到「${toName}」，已关闭 ${result.closedCount} 个标签`,
      action: { label: `切回「${fromName}」`, onClick: () => void result.undo() },
    });
  }
}

export type TabIsolationLoadStatus = 'loading' | 'ready' | 'error';

/**
 * 工作区标签隔离设置 hook（供设置分区 UI 读/写 setting）。
 *
 * - 挂载时读 storage.local 的 setting（默认 off）→ status: loading→ready。
 * - updateSetting：写 storage + 同步 React state（行内即时反馈，不弹 Toast）。
 *
 * 门控切换入口 switchWorkspace 实时读 storage（非本 hook 的 state），保证多窗口/设置
 * 改动后门控总是用最新值；本 hook 的 state 仅驱动设置分区 RadioGroup 的选中态。
 */
export function useTabIsolationSetting() {
  const [setting, setSetting] = useState<TabIsolationSetting>('off');
  const [status, setStatus] = useState<TabIsolationLoadStatus>('loading');

  useEffect(() => {
    let active = true;
    getTabIsolationSetting()
      .then((s) => {
        if (active) {
          setSetting(s);
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

  const updateSetting = useCallback(async (value: TabIsolationSetting) => {
    await setTabIsolationSetting(value);
    setSetting(value);
  }, []);

  return { setting, status, updateSetting };
}
