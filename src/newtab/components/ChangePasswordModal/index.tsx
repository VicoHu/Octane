import React, { useState, useEffect } from 'react';
import { Modal, Input, Button, Toast } from '@douyinfe/semi-ui';
import { IconKey, IconAlertTriangle } from '@douyinfe/semi-icons';
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
    <Modal
      title={
        <div className={styles.titleRow}>
          <div className={styles.badge}>
            <IconKey />
          </div>
          <span>修改主密码</span>
        </div>
      }
      visible={visible}
      footer={
        <Button theme="solid" block loading={loading} onClick={handleSubmit} style={{ marginLeft: 0 }}>
          确认修改
        </Button>
      }
      onCancel={onClose}
    >
      <div className={styles.body}>
        <Input
          mode="password"
          placeholder="当前主密码"
          value={oldPassword}
          onChange={setOldPassword}
          onEnterPress={handleSubmit}
          className={styles.input}
        />
        <Input
          mode="password"
          placeholder="新主密码（至少 12 个字符）"
          value={newPassword}
          onChange={setNewPassword}
          onEnterPress={handleSubmit}
          className={styles.input}
        />
        <Input
          mode="password"
          placeholder="确认新主密码"
          value={confirmPassword}
          onChange={setConfirmPassword}
          onEnterPress={handleSubmit}
          className={styles.input}
        />
        {error && (
          <div className={styles.error}>
            <IconAlertTriangle size="small" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};
