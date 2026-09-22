import { useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { readAutoLockConfig, writeAutoLockConfig, AUTOLOCK_PRESETS_MS } from '@/services/UnlockSession';

function presetLabel(ms: number): string {
  if (ms === 0) return '立即（页面不可见即锁定）';
  return `${Math.round(ms / 60_000)} 分钟`;
}

/** 档位表由 AUTOLOCK_PRESETS_MS 派生（单一事实源），另加「永不」（null 不在档位表内） */
const OPTIONS: { value: string; label: string }[] = [
  ...AUTOLOCK_PRESETS_MS.map((ms) => ({ value: String(ms), label: presetLabel(ms) })),
  { value: 'never', label: '永不' },
];

/**
 * 自动锁定分区（#96 统一模型）：home 与 sidepanel 共用。
 * 语义 = 页面不可见（切换标签页 / 最小化 / 失焦）持续该时长后锁定；
 * 浏览器重启始终锁定（重启保持由「快速解锁 PIN」分区独立控制）。
 */
export function AutoLockSection() {
  const [value, setValue] = useState<string>('never');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const cfg = await readAutoLockConfig();
      setValue(cfg.idleMs === null ? 'never' : String(cfg.idleMs));
      setLoaded(true);
    })();
  }, []);

  const handleChange = async (next: string | null) => {
    if (next === null) return;
    setValue(next);
    await writeAutoLockConfig(next === 'never' ? null : Number(next));
  };

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="mb-1 font-semibold">自动锁定</div>
      <div className="mb-3 text-sm text-muted-foreground">
        页面不可见持续所选时长后自动锁定加密内容，home 与 side panel 共用此设置。浏览器重启后始终需要重新解锁。
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor="autolock-preset" className="w-40 text-sm">闲置多久后锁定</label>
        <Select value={value} onValueChange={(v) => void handleChange(v)} disabled={!loaded}>
          <SelectTrigger id="autolock-preset" className="w-56" aria-label="闲置多久后锁定">
            {/* Base UI 的 SelectValue 在 items 未挂载时回退显示原始 value，改为自渲染当前档位 label */}
            {OPTIONS.find((opt) => opt.value === value)?.label}
          </SelectTrigger>
          <SelectContent>
            {OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
