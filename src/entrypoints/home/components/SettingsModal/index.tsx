import {
  Dialog,
  DialogContent,
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
 * 系统设置中心：左 Tabs(variant=line, vertical) 分类 + 右详情。
 * 四分区：快捷键 / 数据备份和同步（子 card tabs：本地·云端·分享）/ 数据维护（favicon）/ 主密码。
 *
 * Dialog 浅色（Portal 到 body，与 home 浅色主体一致；design review dark scope 决议）。
 */
export function SettingsModal({ visible, onCancel }: SettingsModalProps) {
  return (
    <Dialog open={visible} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className={styles.dialogContent}>
        <DialogHeader>
          <DialogTitle>系统设置</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="shortcuts" orientation="vertical" className={styles.settingsTabs}>
          <TabsList variant="line" aria-label="设置分类" className={styles.settingsNav}>
            <TabsTrigger value="shortcuts">快捷键</TabsTrigger>
            <TabsTrigger value="backup">数据备份和同步</TabsTrigger>
            <TabsTrigger value="maintenance">数据维护</TabsTrigger>
            <TabsTrigger value="password">主密码</TabsTrigger>
          </TabsList>
          <TabsContent value="shortcuts" className={styles.settingsContent}>
            <ShortcutsSection />
          </TabsContent>
          <TabsContent value="backup" className={styles.settingsContent}>
            <BackupSyncTabs />
          </TabsContent>
          <TabsContent value="maintenance" className={styles.settingsContent}>
            <FaviconCacheSection />
          </TabsContent>
          <TabsContent value="password" className={styles.settingsContent}>
            <PasswordSection />
            <EncryptionTtlSection />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
