import { Modal, Tabs } from '@douyinfe/semi-ui';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { BackupSyncTabs } from '@/components/backup/BackupSyncTabs';
import { PasswordSection } from './sections/PasswordSection';
import { EncryptionTtlSection } from './sections/EncryptionTtlSection';
import { FaviconCacheSection } from './sections/FaviconCacheSection';

interface SettingsModalProps {
  visible: boolean;
  onCancel: () => void;
}

/**
 * 系统设置中心：左 Semi Tabs(type=line) 分类 + 右详情。
 * 四分区：快捷键 / 数据备份和同步（子 card tabs：本地·云端·分享）/ 数据维护（favicon）/ 主密码。
 *
 * Modal 浅色（Portal 到 body，与 home 浅色主体一致；design review dark scope 决议）。
 */
export function SettingsModal({ visible, onCancel }: SettingsModalProps) {
  return (
    <Modal
      title="系统设置"
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={720}
      bodyStyle={{
        maxHeight: '70vh',
        overflow: 'auto',
        // Semi Modal body 默认 padding:0，垂直间距靠各区域 marginY(24)；footer=null 时
        // 底部仅 body-wrapper marginBottom 撑开，内容易贴 Modal 底。显式补 paddingBottom（token）。
        paddingBottom: 'var(--space-xl)',
      }}
    >
      <Tabs type="line" tabPosition="left" keepDOM={false}>
        <Tabs.TabPane tab="快捷键" itemKey="shortcuts">
          <ShortcutsSection />
        </Tabs.TabPane>
        <Tabs.TabPane tab="数据备份和同步" itemKey="backup">
          <BackupSyncTabs />
        </Tabs.TabPane>
        <Tabs.TabPane tab="数据维护" itemKey="maintenance">
          <FaviconCacheSection />
        </Tabs.TabPane>
        <Tabs.TabPane tab="主密码" itemKey="password">
          <PasswordSection />
          <EncryptionTtlSection />
        </Tabs.TabPane>
      </Tabs>
    </Modal>
  );
}
