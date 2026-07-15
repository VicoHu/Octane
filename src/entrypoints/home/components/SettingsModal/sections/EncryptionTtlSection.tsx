import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { readTtlConfig, writeTtlConfig } from '@/services/UnlockSession';

/** 单位：秒。grace 下限 1 秒给用户最大自由度（细粒度，特别适合失焦锁定）。 */
const MIN_GRACE_SECONDS = 1;
/**
 * hardCap 下限 = hardCap tick 间隔（30s）。useSidePanelUnlockLifecycle 的 setInterval 每 30s
 * 检查一次 hardCap，若 hardCap < 30s 会因 tick 触发不及时而形同虚设——故下限对齐 tick。
 */
const MIN_HARDCAP_SECONDS = 30;
/** grace 上限 1 小时（失焦锁定超过 1h 已无意义，改用硬上限） */
const MAX_GRACE_SECONDS = 3600;
/** hardCap 上限 24 小时 */
const MAX_HARD_CAP_SECONDS = 86_400;

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, Math.round(v)));
}

/**
 * 加密上下文自动锁定分区（side panel TTL 配置）。
 *
 * 仅作用于 side panel：home 解锁不联动 side panel，side panel 按失焦时长（grace）
 * + 硬上限（hardCap）独立锁定。配置存 chrome.storage.local（单位 ms，跨会话保留），
 * UI 以「秒」展示（细粒度，失焦锁定可设 30s/90s 等短值），sidepanel 下次 isUnlocked 重检生效。
 */
export function EncryptionTtlSection() {
  const [grace, setGrace] = useState(300); // 默认 5min = 300s
  const [hardCap, setHardCap] = useState(1800); // 默认 30min = 1800s
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const cfg = await readTtlConfig();
      setGrace(clamp(Math.round(cfg.grace / 1000), MIN_GRACE_SECONDS, MAX_GRACE_SECONDS));
      setHardCap(clamp(Math.round(cfg.hardCap / 1000), MIN_HARDCAP_SECONDS, MAX_HARD_CAP_SECONDS));
      setLoaded(true);
    })();
  }, []);

  const commitGrace = async (v: number | string | null | undefined) => {
    const raw = Number(v);
    // 展示原始输入值：不逐键 clamp（原 Semi InputNumber 在 blur 才 clamp），
    // 否则 user.type 过程中被钳回 min（如清空→1，再输 90 变 190），仅持久化值 clamp。
    setGrace(raw);
    const seconds = clamp(raw, MIN_GRACE_SECONDS, MAX_GRACE_SECONDS);
    await writeTtlConfig({ grace: seconds * 1000 });
  };
  const commitHardCap = async (v: number | string | null | undefined) => {
    const raw = Number(v);
    setHardCap(raw);
    const seconds = clamp(raw, MIN_HARDCAP_SECONDS, MAX_HARD_CAP_SECONDS);
    await writeTtlConfig({ hardCap: seconds * 1000 });
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
      <Row label="失焦锁定" hint="side panel 失焦超过该时长自动锁回（短暂切窗不打扰，如 30/90 秒）">
        <Input
          type="number"
          data-testid="ttl-grace"
          value={grace}
          min={MIN_GRACE_SECONDS}
          max={MAX_GRACE_SECONDS}
          onChange={(e) => commitGrace(Number(e.target.value))}
          disabled={!loaded}
        />
      </Row>
      <Row label="硬上限" hint="解锁后最长时长，无论是否活跃必锁（防一直盯着永不锁）">
        <Input
          type="number"
          data-testid="ttl-hardcap"
          value={hardCap}
          min={MIN_HARDCAP_SECONDS}
          max={MAX_HARD_CAP_SECONDS}
          onChange={(e) => commitHardCap(Number(e.target.value))}
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
