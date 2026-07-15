import React, { useState, useEffect } from 'react';
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

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
    }
  }, [visible]);

  const handleSubmit = async () => {
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
    try {
      await changePassword(oldPassword, newPassword);
      Toast.success('主密码已修改，加密笔记已同步');
      onClose();
    } catch (e) {
      setError((e as Error).message);
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
