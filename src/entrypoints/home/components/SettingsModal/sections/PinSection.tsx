import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getPinConfig, setPinPersistence } from '@/services/CryptoService';
import { readAutoLockConfig } from '@/services/UnlockSession';
import { Toast } from '@/components/ui/toast';
import { useCrypto } from '@/store/useCrypto';
import { PinSetupModal } from '../../PinSetupModal';
import type { PinConfig } from '@/shared/types';

const FORMAT_LABEL: Record<PinConfig['format'], string> = {
  'digits-4': '4 位数字',
  'digits-6': '6 位数字',
  custom: '自定义',
};

/**
 * 快速解锁 PIN 分区（#96）。
 *
 * 启用/修改/关闭走 PinSetupModal（内置主密码门槛）；
 * 「重启后仍可用 PIN 解锁」为本区内的独立开关（信封持久化位置切换），默认关。
 * 弱组合警示：短 PIN + 重启保持同时存在时明示离线暴力破解风险。
 */
export function PinSection() {
  const passwordSet = useCrypto((s) => s.passwordSet);
  const pinEnabled = useCrypto((s) => s.pinEnabled);
  const [pinConfig, setPinConfig] = useState<PinConfig | null>(null);
  const [idleMs, setIdleMs] = useState<number | null>(null);
  const [modalIntent, setModalIntent] = useState<'enable' | 'disable' | null>(null);
  const [switchingPersist, setSwitchingPersist] = useState(false);

  useEffect(() => {
    if (!pinEnabled) {
      setPinConfig(null);
      return;
    }
    void getPinConfig().then(setPinConfig);
  }, [pinEnabled]);

  // 弱组合警示需要联动自动锁定档位（短 PIN + 永不锁定 + 重启保持 = 防护最弱）
  useEffect(() => {
    void readAutoLockConfig().then((cfg) => setIdleMs(cfg.idleMs));
  }, [pinConfig]);

  const handlePersistChange = async (next: boolean) => {
    setSwitchingPersist(true);
    try {
      await setPinPersistence(next);
      setPinConfig(await getPinConfig());
      Toast.success(next ? '已开启重启保持' : '已关闭重启保持，下次重启后需主密码');
    } catch (e) {
      Toast.error((e as Error).message || '操作失败，请先解锁后重试');
    } finally {
      setSwitchingPersist(false);
    }
  };

  if (!passwordSet) {
    return (
      <div className="mt-6 border-t border-border pt-4">
        <div className="mb-1 font-semibold">快速解锁 PIN</div>
        <div className="text-sm text-muted-foreground">先设置主密码后才能启用 PIN。</div>
      </div>
    );
  }

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="mb-1 font-semibold">快速解锁 PIN</div>
      {!pinEnabled ? (
        <>
          <div className="mb-3 text-sm text-muted-foreground">
            可选。用短 PIN 代替主密码日常解锁；主密码保持原有强度要求，仍是唯一加密根。
          </div>
          <Button onClick={() => setModalIntent('enable')}>启用 PIN</Button>
        </>
      ) : (
        <>
          <div className="mb-3 text-sm text-muted-foreground">
            当前：{pinConfig ? FORMAT_LABEL[pinConfig.format] : '已启用'}。
            连续输错 5 次将自动停用 PIN 并要求主密码。
          </div>
          <div className="mb-3 flex items-center gap-3">
            <Switch
              id="pin-persist"
              checked={pinConfig?.persistEnvelope ?? false}
              disabled={switchingPersist || !pinConfig}
              onCheckedChange={(checked) => void handlePersistChange(checked)}
              aria-label="重启浏览器后仍可用 PIN 解锁"
            />
            <label htmlFor="pin-persist" className="text-sm">
              重启浏览器后仍可用 PIN 解锁
            </label>
          </div>
          {pinConfig?.persistEnvelope && (
            <div
              className="mb-3 rounded-sm p-2 text-sm"
              style={{
                background: 'color-mix(in srgb, var(--destructive) 8%, var(--card))',
                color: 'var(--destructive)',
              }}
            >
              {pinConfig.format === 'digits-4' && idleMs === null
                ? '当前为防护最弱组合：4 位 PIN + 永不自动锁定 + 重启保持。能读取本机文件的人可暴力破解（4 位仅 1 万种组合），且不会因闲置自动锁定。请仅在完全个人设备上使用，或考虑提高 PIN 位数与锁定频率。'
                : '已开启重启保持：PIN 加密的解锁信封保存在本机，能读取本机文件的人可暴力破解短 PIN。仅在个人设备上使用。'}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setModalIntent('enable')}>
              修改 PIN
            </Button>
            <Button variant="ghost" onClick={() => setModalIntent('disable')}>
              关闭 PIN
            </Button>
          </div>
        </>
      )}
      <PinSetupModal
        visible={modalIntent !== null}
        intent={modalIntent ?? 'enable'}
        onClose={() => setModalIntent(null)}
      />
    </div>
  );
}
