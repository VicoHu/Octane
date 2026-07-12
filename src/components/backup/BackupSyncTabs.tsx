import { Tabs } from '@douyinfe/semi-ui';
import { LocalBackupSection } from './LocalBackupSection';
import { CloudBackupSection } from './CloudBackupSection';
import { ShareSection } from './ShareSection';

/**
 * 数据备份和同步 子 tabs（SettingsModal 的 backup pane 内）。
 *
 * 顶部 card 类型：与外层左 line 形成 纵/横 区分；与 CloudBackupSection 内部 s3/webdav
 * 的 line 形成层级区分（子级功能=card，服务商=line）。
 * keepDOM（默认 true，显式表意）：本地/云端/分享间切换保留各自状态（如云端表单输入）。
 */
export function BackupSyncTabs() {
  return (
    <Tabs type="card" keepDOM>
      <Tabs.TabPane tab="本地备份" itemKey="local">
        <LocalBackupSection />
      </Tabs.TabPane>
      <Tabs.TabPane tab="云端同步" itemKey="cloud">
        <CloudBackupSection />
      </Tabs.TabPane>
      <Tabs.TabPane tab="分享" itemKey="share">
        <ShareSection />
      </Tabs.TabPane>
    </Tabs>
  );
}
