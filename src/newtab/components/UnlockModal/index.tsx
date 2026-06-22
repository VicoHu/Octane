import React, { useState } from 'react';
import { Modal, Input, Button, Toast } from '@douyinfe/semi-ui';
import { IconKey } from '@douyinfe/semi-icons';
import { useCrypto } from '@/store/useCrypto';
import styles from './index.module.css';

export const UnlockModal: React.FC = () => {
  const passwordSet = useCrypto((s) => s.passwordSet);
  const unlocked = useCrypto((s) => s.unlocked);
  const loading = useCrypto((s) => s.loading);
  const unlockModalOpen = useCrypto((s) => s.unlockModalOpen);
  const setupMasterPassword = useCrypto((s) => s.setupMasterPassword);
  const unlockWithPassword = useCrypto((s) => s.unlockWithPassword);
  const closeUnlockModal = useCrypto((s) => s.closeUnlockModal);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  // 可见：手动请求打开（首次设置/手动解锁）OR 已设密码但未解锁（重锁自动弹）。
  const visible = unlockModalOpen || (passwordSet && !unlocked);
  // 仅手动打开时允许关闭（误开可退出）；重锁自动弹时强制处理。
  const canDismiss = unlockModalOpen;

  const handleSubmit = async () => {
    setError('');

    if (!passwordSet) {
      if (password.length < 12) {
        setError('密码至少 12 个字符');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次密码不一致');
        return;
      }
      try {
        await setupMasterPassword(password);
        Toast.success('主密码已设置');
        setPassword('');
        setConfirmPassword('');
      } catch (e) {
        setError((e as Error).message);
      }
    } else {
      try {
        await unlockWithPassword(password);
        Toast.success('已解锁');
        setPassword('');
      } catch {
        setError('密码错误或数据损坏');
      }
    }
  };

  return (
    <Modal
      title={
        <div className={styles.titleRow}>
          <IconKey />
          <span>{passwordSet ? '输入主密码' : '设置主密码'}</span>
        </div>
      }
      visible={visible}
      footer={
        // Semi Modal footer 默认给 .semi-button margin-left:12px（多按钮右对齐间距），
        // block 撑满按钮需清零，否则整体右偏 12px
        <Button theme="solid" block loading={loading} onClick={handleSubmit} style={{ marginLeft: 0 }}>
          {passwordSet ? '解锁' : '设置'}
        </Button>
      }
      closable={canDismiss}
      maskClosable={canDismiss}
      onCancel={closeUnlockModal}
    >
      <div className={styles.body}>
        <Input
          mode="password"
          placeholder="输入主密码"
          value={password}
          onChange={setPassword}
          onEnterPress={handleSubmit}
          className={styles.input}
        />
        {!passwordSet && (
          <Input
            mode="password"
            placeholder="确认密码"
            value={confirmPassword}
            onChange={setConfirmPassword}
            onEnterPress={handleSubmit}
            className={styles.input}
          />
        )}
        {error && (
          <div className={styles.error}>{error}</div>
        )}
      </div>
    </Modal>
  );
};
