import React, { useState, useEffect } from 'react';
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
  const setupMasterPassword = useCrypto((s) => s.setupMasterPassword);
  const unlockWithPassword = useCrypto((s) => s.unlockWithPassword);
  const resetPassword = useCrypto((s) => s.resetPassword);
  const closeUnlockModal = useCrypto((s) => s.closeUnlockModal);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const mode: Mode = needsReset ? 'reset' : !passwordSet ? 'setup' : 'unlock';
  // 可见：手动打开 / 重锁自动弹 / 旧版数据需重设（强制处理，不可关闭）
  const visible = needsReset || unlockModalOpen || (passwordSet && !unlocked);
  const canDismiss = !needsReset && unlockModalOpen;
  const copy = COPY[mode];

  // 切换模式或关闭时清空输入与错误
  useEffect(() => {
    if (!visible) {
      setPassword('');
      setConfirmPassword('');
      setError('');
    }
  }, [visible, mode]);

  const handleSubmit = async () => {
    setError('');

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

    try {
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
    }
  };

  if (!visible) return null;

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-title"
      onClick={(e) => {
        if (canDismiss && e.target === e.currentTarget) closeUnlockModal();
      }}
    >
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={`${styles.badge} ${mode === 'reset' ? styles.badgeDanger : ''}`}>
            {mode === 'reset' ? <TriangleAlert size={20} /> : <Lock size={20} />}
          </div>
          <h2 id="unlock-title" className={styles.title}>{copy.title}</h2>
          <p className={styles.subtitle}>{copy.subtitle}</p>
        </div>

        {mode === 'reset' && (
          <div className={styles.warning}>
            <TriangleAlert className={styles.warningIcon} />
            <span>所有已加密笔记将被清除且无法恢复，请确认后再继续。</span>
          </div>
        )}

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
          {copy.cta}
        </Button>
      </div>
    </div>
  );
};
