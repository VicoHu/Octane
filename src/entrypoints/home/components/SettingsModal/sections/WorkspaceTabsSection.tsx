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
 * RadioGroup 纵向四选项（设计 rev5 §1 + v1.1 hide 扩展）：
 * - 不隔离（默认 off）：切换工作区时，保留所有已打开的标签。
 * - 自动关闭与恢复（close）：离开工作区时关闭其标签；返回该工作区时自动恢复。
 * - 折叠·省内存（hide-discard）：离开时折叠为标签组并释放内存，返回时展开重新加载。
 * - 折叠·保状态（hide）：离开时折叠为标签组但保留页面状态，返回时直接展开。
 *
 * label 包裹 radio（Base UI Radio.Root 渲染 span + 隐藏 input，包裹使点击 label 任意位置触发）；
 * 说明文案 aria-describedby 绑定；方向键切换由 Base UI RadioGroup 内置。
 * 状态：loading（RadioGroup 禁用 + 提示）→ ready（选中态）。行内反馈，不弹 Toast。
 *
 * T5/T8 首启确认（设计 rev5 §3）：off→任一归档档（close/hide-discard/hide）时若本窗有
 * 可归档 tab（N>0），弹 AlertDialog 告知存量 tab 将归入当前工作区，确认后才开启（避免静默
 * 归入）。归档档之间互切不弹（已有隔离上下文，不重复首启）。N=0 直接开启。
 * 确认键炭灰主键（非红——开启隔离非危险删除）。
 */
export function WorkspaceTabsSection() {
  const { setting, status, updateSetting } = useTabIsolationSetting();
  const loading = status === 'loading';
  const [confirmN, setConfirmN] = useState<number | null>(null);
  // T8：首启确认时暂存用户选中的 value（confirmEnable 写对应值，非硬编码 close）
  const [pendingValue, setPendingValue] = useState<TabIsolationSetting>('close');

  const handleSelect = async (value: TabIsolationSetting) => {
    // off→任一归档档（close/hide-discard/hide）：先计数本窗可归档 tab，N>0 弹确认
    // 归档互切（如 close→hide）不弹：已有隔离上下文，不重复首启
    if (value !== 'off' && setting === 'off') {
      const winId = await getCurrentWindowId();
      const n = winId != null ? await countRestorableTabsInWindow(winId) : 0;
      if (n > 0) {
        setPendingValue(value);
        setConfirmN(n);
        return;
      }
    }
    await updateSetting(value);
  };

  const confirmEnable = async () => {
    await updateSetting(pendingValue);
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
        <label className="flex min-h-11 items-start gap-3">
          <RadioGroupItem value="hide-discard" aria-describedby="iso-hide-d-desc" className="mt-1" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">折叠·省内存</span>
            <span id="iso-hide-d-desc" className="text-sm text-muted-foreground">
              离开时折叠为标签组并释放内存，返回时还原标签重新加载（页面状态不保留）。
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3">
          <RadioGroupItem value="hide" aria-describedby="iso-hide-desc" className="mt-1" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">折叠·保状态</span>
            <span id="iso-hide-desc" className="text-sm text-muted-foreground">
              离开时折叠为标签组但保留页面状态，返回时还原标签（占用内存）。
            </span>
          </span>
        </label>
      </RadioGroup>

      <AlertDialog open={confirmN !== null} onOpenChange={(o) => !o && setConfirmN(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>开启标签隔离?</AlertDialogTitle>
            <AlertDialogDescription>
              当前窗口的 {confirmN ?? 0} 个标签将归入当前工作区。离开该工作区时按所选模式自动收纳，返回时恢复。
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
