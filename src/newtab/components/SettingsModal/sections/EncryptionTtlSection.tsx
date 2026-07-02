import { useState, useEffect } from 'react';
import { InputNumber } from '@douyinfe/semi-ui';
import { readTtlConfig, writeTtlConfig } from '@/services/UnlockSession';

const MIN_MINUTES = 1;
const MAX_GRACE_MINUTES = 60;
const MAX_HARD_CAP_MINUTES = 240;

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

/**
 * 加密上下文自动锁定分区（side panel TTL 配置）。
 *
 * 仅作用于 side panel：home 解锁不联动 side panel，side panel 按失焦时长（grace）
 * + 硬上限（hardCap）独立锁定。配置存 chrome.storage.local 跨会话保留，
 * sidepanel 下次 isUnlocked 重检即生效。
 */
export function EncryptionTtlSection() {
  const [grace, setGrace] = useState(5);
  const [hardCap, setHardCap] = useState(30);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const cfg = await readTtlConfig();
      setGrace(clamp(Math.round(cfg.grace / 60_000), MIN_MINUTES, MAX_GRACE_MINUTES));
      setHardCap(clamp(Math.round(cfg.hardCap / 60_000), MIN_MINUTES, MAX_HARD_CAP_MINUTES));
      setLoaded(true);
    })();
  }, []);

  const commitGrace = async (v: number | string | null | undefined) => {
    const minutes = clamp(Number(v), MIN_MINUTES, MAX_GRACE_MINUTES);
    setGrace(minutes);
    await writeTtlConfig({ grace: minutes * 60_000 });
  };
  const commitHardCap = async (v: number | string | null | undefined) => {
    const minutes = clamp(Number(v), MIN_MINUTES, MAX_HARD_CAP_MINUTES);
    setHardCap(minutes);
    await writeTtlConfig({ hardCap: minutes * 60_000 });
  };

  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 16,
        borderTop: '1px solid var(--semi-color-border)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>加密上下文自动锁定</div>
      <div style={{ color: 'var(--semi-color-text-2)', fontSize: 13, marginBottom: 12 }}>
        仅作用于 side panel。home 页解锁不联动 side panel。
      </div>
      <Row label="失焦锁定" hint="side panel 失焦超过该时长自动锁回（短暂切窗不打扰）">
        <InputNumber
          data-testid="ttl-grace"
          value={grace}
          min={MIN_MINUTES}
          max={MAX_GRACE_MINUTES}
          suffix="分钟"
          onChange={commitGrace}
          disabled={!loaded}
        />
      </Row>
      <Row label="硬上限" hint="解锁后最长时长，无论是否活跃必锁（防一直盯着永不锁）">
        <InputNumber
          data-testid="ttl-hardcap"
          value={hardCap}
          min={MIN_MINUTES}
          max={MAX_HARD_CAP_MINUTES}
          suffix="分钟"
          onChange={commitHardCap}
          disabled={!loaded}
        />
      </Row>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ width: 96 }}>
        <div style={{ fontSize: 13 }}>{label}</div>
      </div>
      <div style={{ marginRight: 12 }}>{children}</div>
      <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, flex: 1 }}>{hint}</div>
    </div>
  );
}
