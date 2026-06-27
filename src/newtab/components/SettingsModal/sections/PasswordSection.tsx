import { useState } from 'react';
import { Button } from '@douyinfe/semi-ui';
import { useCrypto } from '@/store/useCrypto';
import { ChangePasswordModal } from '@/newtab/components/ChangePasswordModal';

/**
 * 主密码分区：从 Sidebar 迁移的 UI 层（useCrypto store 不变，见 plan-eng-review A4）。
 *
 * 状态自适应：未设→设置；已设未解锁→解锁；已解锁→锁定（区别于 Dropdown「点击即关」，
 * 锁定后 Modal 不自动关闭，按钮文案随 unlocked 刷新，见 outside voice P2）。
 * UnlockModal 由 App 级全局渲染，此处只触发 openUnlockModal；修改密码用 ChangePasswordModal。
 */
export function PasswordSection() {
  const passwordSet = useCrypto((s) => s.passwordSet);
  const unlocked = useCrypto((s) => s.unlocked);
  const openUnlockModal = useCrypto((s) => s.openUnlockModal);
  const lockSession = useCrypto((s) => s.lockSession);
  const [showChange, setShowChange] = useState(false);

  const label = !passwordSet ? '设置主密码' : unlocked ? '锁定主密码' : '解锁主密码';
  const onClick = () => {
    if (unlocked) lockSession();
    else openUnlockModal();
  };

  return (
    <div style={{ paddingTop: 8 }}>
      <Button theme="solid" onClick={onClick}>
        {label}
      </Button>
      {unlocked && passwordSet && (
        <Button
          theme="borderless"
          style={{ marginLeft: 8 }}
          onClick={() => setShowChange(true)}
        >
          修改主密码
        </Button>
      )}
      <ChangePasswordModal
        visible={showChange}
        onClose={() => setShowChange(false)}
      />
    </div>
  );
}
