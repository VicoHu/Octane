import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { Lock, TriangleAlert } from 'lucide-react';
import { useCrypto } from '@/store/useCrypto';
import styles from './index.module.css';

type Mode = 'setup' | 'unlock' | 'reset';

const COPY: Record<Mode, { title: string; subtitle: string; cta: string }> = {
  setup: {
    title: '设置主密码',
    subtitle: '为加密笔记创建主密码。密码仅存于本机，无法找回，请妥善保管。',
    cta: '创建主密码',
  },
  unlock: {
    title: '欢迎回来',
    subtitle: '输入主密码以解锁加密笔记。',
    cta: '解锁',
  },
  reset: {
    title: '重设主密码',
    subtitle: '检测到旧版加密数据，需重设主密码以启用安全校验。',
    cta: '重设并清除笔记',
  },
};

export const UnlockModal: React.FC = () => {
  const passwordSet = useCrypto((s) => s.passwordSet);
  const unlocked = useCrypto((s) => s.unlocked);
  const loading = useCrypto((s) => s.loading);
  const unlockModalOpen = useCrypto((s) => s.unlockModalOpen);
  const needsReset = useCrypto((s) => s.needsReset);
  const pinEnabled = useCrypto((s) => s.pinEnabled);
  const pinEnvelopeAvailable = useCrypto((s) => s.pinEnvelopeAvailable);
  const setupMasterPassword = useCrypto((s) => s.setupMasterPassword);
  const unlockWithPassword = useCrypto((s) => s.unlockWithPassword);
  const unlockWithPin = useCrypto((s) => s.unlockWithPin);
  const resetPassword = useCrypto((s) => s.resetPassword);
  const refreshPinStatus = useCrypto((s) => s.refreshPinStatus);
  const closeUnlockModal = useCrypto((s) => s.closeUnlockModal);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  // PIN 可用时默认走 PIN（日常零多余点击），「使用主密码」一键回退
  const [usePinInput, setUsePinInput] = useState(true);

  const mode: Mode = needsReset ? 'reset' : !passwordSet ? 'setup' : 'unlock';
  const pinAvailable = mode === 'unlock' && pinEnabled && pinEnvelopeAvailable;
  const showPin = pinAvailable && usePinInput;
  // 可见：手动打开 / 重锁自动弹 / 旧版数据需重设（强制处理，不可关闭）
  const visible = needsReset || unlockModalOpen || (passwordSet && !unlocked);
  const canDismiss = !needsReset && unlockModalOpen;
  const copy = COPY[mode];

  // 切换模式或关闭时清空输入与错误
  // 注：PIN 熔断（pinAvailable 翻 false）无需干预——showPin 由 pinAvailable 短路，自动落回主密码
  useEffect(() => {
    if (!visible) {
      setPassword('');
      setConfirmPassword('');
      setPin('');
      setError('');
      setUsePinInput(true);
    }
  }, [visible, mode]);

  // 防双触发：Enter 连按时避免并发 setup/unlock/reset，防止 session 与密码元数据错乱
  const submittingRef = useRef(false);

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setError('');

      if (showPin) {
        try {
          await unlockWithPin(pin);
          Toast.success('已解锁');
        } catch {
          setError('PIN 错误，连续错误 5 次将停用 PIN');
          // 熔断后信封消失（持久信封模式不触发 session onChanged）——主动重探，
          // 让 pinEnvelopeAvailable 翻 false，showPin 自动落回主密码
          void refreshPinStatus();
        } finally {
          setPin('');
        }
        return;
      }

      // setup / reset 需要二次确认 + 长度校验
      if (mode === 'setup' || mode === 'reset') {
        if (password.length < 12) {
          setError('密码至少 12 个字符');
          return;
        }
        if (password !== confirmPassword) {
          setError('两次密码不一致');
          return;
        }
      }

      if (mode === 'reset') {
        await resetPassword(password);
        Toast.success('主密码已重设');
      } else if (mode === 'setup') {
        await setupMasterPassword(password);
        Toast.success('主密码已设置');
      } else {
        await unlockWithPassword(password);
        Toast.success('已解锁');
      }
      setPassword('');
      setConfirmPassword('');
    } catch (e) {
      setError(mode === 'unlock' ? '密码错误' : (e as Error).message);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Dialog
      open={visible}
      disablePointerDismissal={!canDismiss}
      onOpenChange={(open) => {
        if (!open && canDismiss) closeUnlockModal();
      }}
    >
      <DialogContent
        showCloseButton={canDismiss}
        className={styles.card}
        aria-describedby="unlock-subtitle"
      >
        <DialogHeader className={styles.header}>
          <div className={`${styles.badge} ${mode === 'reset' ? styles.badgeDanger : ''}`}>
            {mode === 'reset' ? <TriangleAlert size={20} /> : <Lock size={20} />}
          </div>
          <DialogTitle>{showPin ? '快速解锁' : copy.title}</DialogTitle>
          <DialogDescription id="unlock-subtitle">
            {showPin ? '输入 PIN 快速解锁，也可改用主密码。' : copy.subtitle}
          </DialogDescription>
        </DialogHeader>

        {mode === 'reset' && (
          <Alert variant="destructive" className={styles.warning}>
            <TriangleAlert className={styles.warningIcon} />
            <AlertDescription>所有已加密笔记将被清除且无法恢复，请确认后再继续。</AlertDescription>
          </Alert>
        )}

        {showPin ? (
          <div className={styles.field}>
            <Input
              type="password"
              inputMode="numeric"
              placeholder="输入 PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
              autoFocus
            />
            <button
              type="button"
              className={styles.switchLink}
              onClick={() => {
                setUsePinInput(false);
                setError('');
              }}
            >
              使用主密码解锁
            </button>
          </div>
        ) : (
          <>
            <div className={styles.field}>
              <Input
                type="password"
                placeholder="输入主密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSubmit();
                }}
                autoFocus
              />
              {pinAvailable && (
                <button
                  type="button"
                  className={styles.switchLink}
                  onClick={() => {
                    setUsePinInput(true);
                    setError('');
                  }}
                >
                  使用 PIN 快速解锁
                </button>
              )}
            </div>

            {(mode === 'setup' || mode === 'reset') && (
              <div className={styles.field}>
                <Input
                  type="password"
                  placeholder="确认主密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSubmit();
                  }}
                />
              </div>
            )}

            {(mode === 'setup' || mode === 'reset') && (
              <div className={styles.hint}>至少 12 个字符，建议混合字母、数字与符号</div>
            )}
          </>
        )}

        {error && (
          <div className={styles.error}>
            <TriangleAlert className="size-4" />
            <span>{error}</span>
          </div>
        )}

        <Button
          variant={mode === 'reset' ? 'destructive' : 'default'}
          size="lg"
          disabled={loading}
          onClick={handleSubmit}
          className={`${styles.submit} w-full`}
        >
          {showPin ? '解锁' : copy.cta}
        </Button>
      </DialogContent>
    </Dialog>
  );
};
