import React, { useState } from 'react';
import { Modal, Input, Button, Toast } from '@douyinfe/semi-ui';
import { IconKey } from '@douyinfe/semi-icons';
import { useCrypto } from '@/store/useCrypto';

export const UnlockModal: React.FC = () => {
  const passwordSet = useCrypto((s) => s.passwordSet);
  const unlocked = useCrypto((s) => s.unlocked);
  const loading = useCrypto((s) => s.loading);
  const setupMasterPassword = useCrypto((s) => s.setupMasterPassword);
  const unlockWithPassword = useCrypto((s) => s.unlockWithPassword);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  // 仅在已设置密码但未解锁时显示
  const visible = passwordSet && !unlocked;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconKey />
          <span>输入主密码</span>
        </div>
      }
      visible={visible}
      footer={null}
      closable={false}
      maskClosable={false}
    >
      <div style={{ padding: '8px 0' }}>
        <Input
          mode="password"
          placeholder="输入主密码"
          value={password}
          onChange={setPassword}
          onEnterPress={handleSubmit}
          style={{ marginBottom: 12 }}
        />
        {!passwordSet && (
          <Input
            mode="password"
            placeholder="确认密码"
            value={confirmPassword}
            onChange={setConfirmPassword}
            onEnterPress={handleSubmit}
            style={{ marginBottom: 12 }}
          />
        )}
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 8 }}>{error}</div>
        )}
        <Button
          theme="solid"
          block
          loading={loading}
          onClick={handleSubmit}
        >
          解锁
        </Button>
      </div>
    </Modal>
  );
};
