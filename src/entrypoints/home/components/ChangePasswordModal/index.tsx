import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Toast } from '@/components/ui/toast';
import { Key, TriangleAlert } from 'lucide-react';
import { useCrypto } from '@/store/useCrypto';
import styles from './index.module.css';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export const ChangePasswordModal: React.FC<Props> = ({ visible, onClose }) => {
  const loading = useCrypto((s) => s.loading);
  const changePassword = useCrypto((s) => s.changePassword);
  const pinEnabled = useCrypto((s) => s.pinEnabled);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  // 防双触发：Enter 连按或弹窗关闭重开时，避免并发 reencryptAllContexts 导致
  // 部分 context 用新密钥而 cryptoMetadata 仍指向旧密钥（永久无法解密，数据丢失）
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPin('');
      setError('');
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setError('');
      if (newPassword.length < 12) {
        setError('新密码至少 12 个字符');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('两次新密码不一致');
        return;
      }
      if (newPassword === oldPassword) {
        setError('新密码不能与旧密码相同');
        return;
      }
      // PIN 启用时必填：修改主密码后信封随之重建，PIN 自动保持有效（#96 用户故事）。
      // 忘记 PIN 的用户先到设置区用主密码关闭 PIN，再回来改密。
      if (pinEnabled && pin.length === 0) {
        setError('请填写当前 PIN（修改主密码后 PIN 将自动保持有效）');
        return;
      }
      const pinForEnvelope = pinEnabled ? pin : undefined;
      await changePassword(oldPassword, newPassword, pinForEnvelope);
      Toast.success(
        pinEnabled ? '主密码已修改，加密笔记与 PIN 已同步' : '主密码已修改，加密笔记已同步',
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Dialog open={visible} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <div className={styles.titleRow}>
              <div className={styles.badge}>
                <Key />
              </div>
              <span>修改主密码</span>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className={styles.body}>
          <Input
            type="password"
            placeholder="当前主密码"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            className={styles.input}
          />
          <Input
            type="password"
            placeholder="新主密码（至少 12 个字符）"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            className={styles.input}
          />
          <Input
            type="password"
            placeholder="确认新主密码"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            className={styles.input}
          />
          {pinEnabled && (
            <Input
              type="password"
              inputMode="numeric"
              placeholder="当前快速解锁 PIN（修改后自动保持有效）"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              className={styles.input}
            />
          )}
          {error && (
            <div className={styles.error}>
              <TriangleAlert size={14} />
              <span>{error}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="default" className="w-full" disabled={loading} onClick={handleSubmit}>
            {loading && <Spinner data-icon="inline-start" />}
            确认修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
