import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { BackupSyncTabs } from '@/components/backup/BackupSyncTabs';
import { PasswordSection } from './sections/PasswordSection';
import { EncryptionTtlSection } from './sections/EncryptionTtlSection';
import { FaviconCacheSection } from './sections/FaviconCacheSection';
import styles from './index.module.css';

interface SettingsModalProps {
  visible: boolean;
  onCancel: () => void;
}

/**
 * 系统设置中心：左侧分类导航 + 右侧设置详情。
 * 四分区：快捷键 / 数据备份和同步 / 数据维护 / 主密码。
 */
export function SettingsModal({ visible, onCancel }: SettingsModalProps) {
  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className={styles.dialogContent}>
        <DialogHeader className={styles.dialogHeader}>
          <DialogTitle className={styles.dialogTitle}>系统设置</DialogTitle>
          <DialogDescription className={styles.dialogDescription}>
            管理快捷键、数据与安全选项
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="shortcuts" orientation="vertical" className={styles.settingsTabs}>
          <TabsList variant="line" aria-label="设置分类" className={styles.settingsNav}>
            <TabsTrigger value="shortcuts">快捷键</TabsTrigger>
            <TabsTrigger value="backup">数据备份和同步</TabsTrigger>
            <TabsTrigger value="maintenance">数据维护</TabsTrigger>
            <TabsTrigger value="password">主密码</TabsTrigger>
          </TabsList>
          <TabsContent value="shortcuts" className={styles.settingsContent}>
            <header className={styles.sectionHeader}>
              <h2>快捷键</h2>
              <p>查看并管理浏览器扩展快捷键。</p>
            </header>
            <ShortcutsSection />
          </TabsContent>
          <TabsContent value="backup" className={styles.settingsContent}>
            <header className={styles.sectionHeader}>
              <h2>数据备份和同步</h2>
              <p>导出本地数据，或配置云端同步与分享。</p>
            </header>
            <BackupSyncTabs />
          </TabsContent>
          <TabsContent value="maintenance" className={styles.settingsContent}>
            <header className={styles.sectionHeader}>
              <h2>数据维护</h2>
              <p>清理并维护书签图标缓存。</p>
            </header>
            <FaviconCacheSection />
          </TabsContent>
          <TabsContent value="password" className={styles.settingsContent}>
            <header className={styles.sectionHeader}>
              <h2>主密码</h2>
              <p>管理主密码和加密内容的自动锁定策略。</p>
            </header>
            <PasswordSection />
            <EncryptionTtlSection />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
