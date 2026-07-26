import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useTagFilterMemorySetting } from '@/entrypoints/home/hooks/useTagFilterMemorySetting';
import type { TagFilterMemoryScope } from '@/shared/tagFilterMemorySetting';

/**
 * 「书签」设置分区：配置 Tag 筛选记忆范围（Issue #54）。
 *
 * RadioGroup 三选项：
 * - 仅当前分类（默认）：离开当前分类时清除该分类的 Tag 筛选。
 * - 当前工作区：同一工作区内分别记忆各分类的筛选；离开工作区时清除该工作区全部记忆。
 * - 当前会话：页面生命周期内记忆所有工作区下各分类的筛选；刷新或重新打开后清空。
 *
 * label 包裹 radio（Base UI Radio.Root 渲染 span + 隐藏 input，包裹使点击 label 任意位置触发）；
 * 说明文案 aria-describedby 绑定；方向键切换由 Base UI RadioGroup 内置。
 * 状态：loading（RadioGroup 禁用 + 提示）→ ready（选中态）。行内反馈，不弹 Toast。
 *
 * 仅持久化配置本身；实际筛选记忆只存内存，配置变更不追溯清理或恢复既有记忆。
 */
export function BookmarkSection() {
  const { scope, status, updateScope } = useTagFilterMemorySetting();
  const loading = status === 'loading';

  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
      <div className="font-semibold">Tag 筛选记忆范围</div>
      {loading && <div className="text-sm text-muted-foreground">正在读取设置…</div>}
      <RadioGroup
        value={scope}
        onValueChange={(v) => void updateScope(v as TagFilterMemoryScope)}
        disabled={loading}
        className="flex flex-col gap-3"
      >
        <label className="flex min-h-11 items-start gap-3">
          <RadioGroupItem value="category" aria-describedby="tfm-category-desc" className="mt-1" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">仅当前分类</span>
            <span id="tfm-category-desc" className="text-sm text-muted-foreground">
              离开当前分类时清除该分类的筛选。
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3">
          <RadioGroupItem value="workspace" aria-describedby="tfm-workspace-desc" className="mt-1" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">当前工作区</span>
            <span id="tfm-workspace-desc" className="text-sm text-muted-foreground">
              同一工作区内分别记忆各分类的筛选；离开工作区时清除该工作区全部记忆。
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3">
          <RadioGroupItem value="session" aria-describedby="tfm-session-desc" className="mt-1" />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">当前会话</span>
            <span id="tfm-session-desc" className="text-sm text-muted-foreground">
              页面生命周期内记忆所有分类的筛选；刷新或重新打开后清空。
            </span>
          </span>
        </label>
      </RadioGroup>
    </div>
  );
}
