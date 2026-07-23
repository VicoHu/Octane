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
import { switchWorkspaceBySetting, type SwitchProgress } from '@/shared/tabs/workspaceSwitch';
import { Toast } from '@/components/ui/toast';
import { Progress } from '@/components/ui/progress';
import {
  getTabIsolationSetting,
  setTabIsolationSetting,
  type TabIsolationSetting,
} from '@/shared/tabIsolationSetting';

/** T8 loading Toast 进度文案（phase + count/total）。 */
function progressLabel(p: SwitchProgress, toName: string): string {
  switch (p.phase) {
    case 'archive':
      return '正在保存当前标签…';
    case 'dispose':
      return `正在关闭当前标签 ${p.count}/${p.total}`;
    case 'restore':
      return `正在恢复「${toName}」标签 ${p.count}/${p.total}`;
    case 'done':
      return '即将完成…';
  }
}

/**
 * T8 切换进度 loading Toast 内容（订阅 store switching，自动随进度更新 Progress + 文案）。
 * 渲染在 sonner toast content 内；switching.total>0 时显示 shadcn Progress（count/total → %）。
 */
export function LoadingToastContent({ toId }: { toId: string }) {
  const switching = useWorkspace((s) => s.switching);
  const toName = useWorkspace((s) => s.workspaces.find((w) => w.id === toId)?.name ?? toId);
  if (!switching) {
    return <span>{`正在切换到「${toName}」…`}</span>;
  }
  const pct = switching.total > 0 ? Math.round((switching.count / switching.total) * 100) : 0;
  return (
    <div className="flex w-full flex-col gap-2">
      <span className="text-sm">{progressLabel(switching, toName)}</span>
      {switching.total > 0 && <Progress value={pct} />}
    </div>
  );
}

export async function switchWorkspace(toId: string): Promise<void> {
  const setting = await getTabIsolationSetting();
  const windowId = await getCurrentWindowId();
  const isClose = setting === 'close' && windowId != null;

  // T8：立即设 switching state（入口 aria-disabled + 目标项 Spinner，防重复点击/误判失败）
  if (isClose) {
    useWorkspace.setState({ switching: { toId, phase: 'archive', count: 0, total: 0 } });
  }

  // T8：>300ms loading Toast（同 id 更新；快切换 <300ms 不打扰）
  const toastId = isClose ? `ws-switch-${toId}` : null;
  let loadingTimer: ReturnType<typeof setTimeout> | undefined;
  if (toastId) {
    loadingTimer = setTimeout(() => {
      // content 订阅 store switching，自动随 onProgress 更新 Progress + 文案
      Toast.loading({ id: toastId, content: <LoadingToastContent toId={toId} /> });
    }, 300);
  }

  const onProgress = isClose
    ? (p: SwitchProgress) => {
        useWorkspace.setState({ switching: { toId, ...p } });
      }
    : undefined;

  try {
    const result = await switchWorkspaceBySetting({
      toId,
      setting,
      windowId,
      selectWorkspace: useWorkspace.getState().selectWorkspace,
      onProgress,
    });
    // T4：close 模式且关闭了 tab（N>0）→ 弹切换结果 Toast（action「切回」非"撤销"——完整反转切换）
    if (result.closedCount > 0 && result.fromId) {
      const workspaces = useWorkspace.getState().workspaces;
      const toName = workspaces.find((w) => w.id === toId)?.name ?? toId;
      const fromName = workspaces.find((w) => w.id === result.fromId)?.name ?? result.fromId;
      Toast.success({
        content: `已切换到「${toName}」，已关闭 ${result.closedCount} 个标签`,
        action: {
          label: `切回「${fromName}」`,
          // undo 回滚 tab/binding，再 selectWorkspace(fromId) 同步 store 选中态
          //（undo 不碰 store，不补则 AppRail active 停留 toId）
          onClick: () => {
            void result.undo().then(() => {
              const fid = result.fromId;
              if (fid) void useWorkspace.getState().selectWorkspace(fid);
            });
          },
        },
      });
    }
  } finally {
    if (loadingTimer) clearTimeout(loadingTimer);
    if (toastId) Toast.close(toastId);
    if (isClose) useWorkspace.setState({ switching: null });
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
