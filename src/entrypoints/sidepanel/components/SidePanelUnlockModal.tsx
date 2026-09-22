import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { unlock, unlockWithPin } from '@/services/UnlockSession';
import { isPinEnabled, hasPinEnvelope, getPinConfig } from '@/services/CryptoService';
import { PinCodeInput } from '@/components/PinCodeInput';
import type { PinFormat } from '@/shared/types';

interface SidePanelUnlockModalProps {
  open: boolean;
  onClose: () => void;
}

/** PIN 输入与主密码输入之间的切换链接样式（sidepanel 内联风格，home 侧用 UnlockModal 的 css module） */
const switchLinkStyle: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  fontSize: 13,
  color: 'var(--primary)',
  cursor: 'pointer',
  textAlign: 'center',
};

/** 与 home UnlockModal 保持一致的 PIN 错误文案 */
const PIN_ERROR_TEXT = 'PIN 错误，连续错误 5 次将停用 PIN';

/**
 * sidepanel 加密上下文解锁弹窗（仅 unlock 模式）。
 *
 * 与 home 的 UnlockModal 区别：不复用 useCrypto store，提交直接调
 * UnlockSession（每次完整校验，防偷看）。解锁成功后写入共享 octane-derived-key +
 * sidepanel 标记，onChanged 广播触发所有 useEncryptedContexts 重渲染。
 * 闲置自动锁定由 useSidePanelUnlockLifecycle 负责。
 *
 * PIN 启用且信封可用时默认显示 PIN 输入（#96），「使用主密码」一键回退；
 * 连续输错熔断后信封消失，自动落回主密码。
 *
 * 宽度：side panel 视口窄（Chrome side panel 最小 ~300px），用 calc(100vw - 32px) 自适应，
 * 避免默认 460px 横向溢出。按钮放 footer（Semi 自动留底部 padding，不贴边）。
 */
export function SidePanelUnlockModal({ open, onClose }: SidePanelUnlockModalProps) {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pinAvailable, setPinAvailable] = useState(false);
  const [pinFormat, setPinFormat] = useState<PinFormat | null>(null);
  const [usePinInput, setUsePinInput] = useState(true);
  // 防双触发：Enter 连按时避免并发 unlock（session 广播与状态错乱）
  const submittingRef = useRef(false);

  // 弹窗打开时探测 PIN 可用性（熔断/关闭后信封消失 → false）；
  // 探测失败（如非扩展环境无 IndexedDB）按不可用处理，落回主密码
  useEffect(() => {
    if (!open) {
      setPin('');
      setPassword('');
      setError('');
      setUsePinInput(true);
      return;
    }
    void (async () => {
      const enabled = await isPinEnabled();
      setPinAvailable(enabled ? await hasPinEnvelope() : false);
      const cfg = enabled ? await getPinConfig() : null;
      setPinFormat(cfg?.format ?? null);
    })().catch(() => setPinAvailable(false));
  }, [open]);

  const showPin = pinAvailable && usePinInput;

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setError('');
      setLoading(true);
      if (showPin) {
        const ok = await unlockWithPin('sidepanel', pin);
        if (ok) {
          Toast.success('已解锁');
          onClose();
        } else {
          setError(PIN_ERROR_TEXT);
          // 熔断后信封消失 → 探测翻 false，showPin 自动落回主密码
          const stillAvailable = await hasPinEnvelope();
          setPinAvailable(stillAvailable);
        }
        setPin('');
        return;
      }
      const ok = await unlock('sidepanel', password);
      if (ok) {
        Toast.success('已解锁');
        setPassword('');
        onClose();
      } else {
        setError('密码错误');
      }
    } catch (e) {
      setError((e as Error).message || '解锁失败');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{showPin ? '快速解锁' : '解锁加密上下文'}</DialogTitle>
        </DialogHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, color: 'var(--muted-foreground)', fontSize: 13 }}>
            {showPin
              ? '输入 PIN 快速解锁当前 side panel。'
              : '输入主密码以解锁当前 side panel 的加密上下文。页面不可见超时后将自动重新锁定。'}
          </p>
          {showPin ? (
            <>
              {pinFormat === 'digits-4' || pinFormat === 'digits-6' ? (
                <PinCodeInput
                  key={pinFormat}
                  id="sidepanel-unlock-pin"
                  aria-label="PIN"
                  length={pinFormat === 'digits-4' ? 4 : 6}
                  value={pin}
                  onChange={setPin}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmit();
                  }}
                />
              ) : (
                <Input
                  type="password"
                  placeholder="输入 PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmit();
                  }}
                  className="h-9"
                  autoFocus
                />
              )}
              <button
                type="button"
                onClick={() => {
                  setUsePinInput(false);
                  setError('');
                }}
                style={switchLinkStyle}
              >
                使用主密码解锁
              </button>
            </>
          ) : (
            <>
              <Input
                type="password"
                placeholder="输入主密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
                className="h-9"
                autoFocus
              />
              {pinAvailable && (
                <button
                  type="button"
                  onClick={() => {
                    setUsePinInput(true);
                    setError('');
                  }}
                  style={switchLinkStyle}
                >
                  使用 PIN 快速解锁
                </button>
              )}
            </>
          )}
          {error && (
            <div style={{ color: 'var(--destructive)', fontSize: 13 }}>{error}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="default" size="lg" disabled={loading} onClick={handleSubmit}>
            {loading ? '解锁中…' : '解 锁'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
