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
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>系统设置</DialogTitle>
        </DialogHeader>
        <div style={{ maxHeight: '70vh', overflow: 'auto', paddingBottom: 'var(--space-xl)' }}>
          <Tabs defaultValue="shortcuts">
            <TabsList>
              <TabsTrigger value="shortcuts">快捷键</TabsTrigger>
              <TabsTrigger value="backup">数据备份和同步</TabsTrigger>
              <TabsTrigger value="maintenance">数据维护</TabsTrigger>
              <TabsTrigger value="password">主密码</TabsTrigger>
            </TabsList>
            <TabsContent value="shortcuts">
              <ShortcutsSection />
            </TabsContent>
            <TabsContent value="backup">
              <BackupSyncTabs />
            </TabsContent>
            <TabsContent value="maintenance">
              <FaviconCacheSection />
            </TabsContent>
            <TabsContent value="password">
              <PasswordSection />
              <EncryptionTtlSection />
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
