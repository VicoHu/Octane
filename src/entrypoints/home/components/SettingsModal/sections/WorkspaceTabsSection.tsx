import { useState } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTabIsolationSetting } from '@/entrypoints/home/utils/workspaceSwitcher';
import { getCurrentWindowId } from '@/store/useWorkspace';
import { countRestorableTabsInWindow } from '@/shared/tabs/workspaceSwitch';
import type { TabIsolationSetting } from '@/shared/tabIsolationSetting';

/**
 * 「工作区与标签」设置分区：控制切换工作区时如何处理已打开的标签。
 *
 * RadioGroup 纵向两选项（设计 rev5 §1）：
 * - 不隔离（默认 off）：切换工作区时，保留所有已打开的标签。
 * - 自动关闭与恢复（close）：离开工作区时关闭其标签；返回该工作区时自动恢复。
 *
 * label 包裹 radio（Base UI Radio.Root 渲染 span + 隐藏 input，包裹使点击 label 任意位置触发）；
 * 说明文案 aria-describedby 绑定；方向键切换由 Base UI RadioGroup 内置。
 * 状态：loading（RadioGroup 禁用 + 提示）→ ready（选中态）。行内反馈，不弹 Toast。
 *
 * T5 首启确认（设计 rev5 §3）：off→close 时若本窗有可归档 tab（N>0），弹 AlertDialog
 * 告知存量 tab 将归入当前工作区，确认后才开启（避免静默归入）。N=0 直接开启。
 * 确认键炭灰主键（非红——开启隔离非危险删除）。close→off 无后果，直接写。
 */
export function WorkspaceTabsSection() {
  const { setting, status, updateSetting } = useTabIsolationSetting();
  const loading = status === 'loading';
  const [confirmN, setConfirmN] = useState<number | null>(null);

  const handleSelect = async (value: TabIsolationSetting) => {
    // off→close：先计数本窗可归档 tab，N>0 弹确认（避免静默归入用户存量 tab）
    if (value === 'close' && setting === 'off') {
      const winId = await getCurrentWindowId();
      const n = winId != null ? await countRestorableTabsInWindow(winId) : 0;
      if (n > 0) {
        setConfirmN(n);
        return;
      }
    }
    await updateSetting(value);
  };

  const confirmEnable = async () => {
    await updateSetting('close');
    setConfirmN(null);
  };

  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
      <div className="font-semibold">切换行为</div>
      {loading && <div className="text-sm text-muted-foreground">正在读取设置…</div>}
      <RadioGroup
        value={setting}
        onValueChange={(v) => void handleSelect(v as TabIsolationSetting)}
        disabled={loading}
        className="flex flex-col gap-3"
      >
        <label className="flex min-h-11 items-start gap-3">
          <RadioGroupItem value="off" aria-describedby="iso-off-desc" className="mt-1" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">不隔离（默认）</span>
            <span id="iso-off-desc" className="text-sm text-muted-foreground">
              切换工作区时，保留所有已打开的标签。
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3">
          <RadioGroupItem value="close" aria-describedby="iso-close-desc" className="mt-1" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">自动关闭与恢复</span>
            <span id="iso-close-desc" className="text-sm text-muted-foreground">
              离开工作区时关闭其标签；返回该工作区时自动恢复。
            </span>
          </span>
        </label>
      </RadioGroup>

      <AlertDialog open={confirmN !== null} onOpenChange={(o) => !o && setConfirmN(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>开启标签隔离?</AlertDialogTitle>
            <AlertDialogDescription>
              当前窗口的 {confirmN ?? 0} 个标签将归入当前工作区。离开该工作区时关闭，返回时自动恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmEnable()}>开启隔离</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
