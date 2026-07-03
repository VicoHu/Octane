import { useState } from 'react';
import { Modal, Input, Button, Toast } from '@douyinfe/semi-ui';
import { unlock } from '@/services/UnlockSession';

interface SidePanelUnlockModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * sidepanel 加密上下文解锁弹窗（仅 unlock 模式）。
 *
 * 与 newtab 的 UnlockModal 区别：不复用 useCrypto store，提交直接调
 * UnlockSession.unlock('sidepanel', pwd)（每次完整 PBKDF2+verifier，防偷看）。
 * 解锁成功后写入共享 octane-derived-key + sidepanel 标记，onChanged 广播触发
 * 所有 useEncryptedContexts 重渲染。TTL 失焦/硬上限锁由 useSidePanelUnlockLifecycle 负责。
 *
 * 宽度：side panel 视口窄（Chrome side panel 最小 ~300px），用 calc(100vw - 32px) 自适应，
 * 避免默认 460px 横向溢出。按钮放 footer（Semi 自动留底部 padding，不贴边）。
 */
export function SidePanelUnlockModal({ open, onClose }: SidePanelUnlockModalProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
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
    }
  };

  return (
    <Modal
      title="解锁加密上下文"
      visible={open}
      onCancel={onClose}
      width="calc(100vw - 32px)"
      maskClosable
      hasCancel={false}
      footer={
        <Button theme="solid" size="large" loading={loading} onClick={handleSubmit}>
          解 锁
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, color: 'var(--semi-color-text-2)', fontSize: 13 }}>
          输入主密码以解锁当前 side panel 的加密上下文。离开超时或达硬上限将自动重新锁定。
        </p>
        <Input
          mode="password"
          placeholder="输入主密码"
          value={password}
          onChange={setPassword}
          onEnterPress={handleSubmit}
          size="large"
          autoFocus
        />
        {error && (
          <div style={{ color: 'var(--semi-color-danger)', fontSize: 13 }}>{error}</div>
        )}
      </div>
    </Modal>
  );
}
