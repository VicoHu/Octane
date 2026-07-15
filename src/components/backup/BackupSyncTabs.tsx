import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LocalBackupSection } from './LocalBackupSection';
import { CloudBackupSection } from './CloudBackupSection';
import { ShareSection } from './ShareSection';

/**
 * 数据备份和同步 子 tabs（SettingsModal 的 backup pane 内）。
 *
 * 顶部 card 类型：与外层左 line 形成 纵/横 区分；与 CloudBackupSection 内部 s3/webdav
 * 的 line 形成层级区分（子级功能=card，服务商=line）。
 * Base UI Tabs 默认 keepMounted=true（等价原 Semi keepDOM）：本地/云端/分享间切换保留各自状态（如云端表单输入）。
 */
export function BackupSyncTabs() {
  return (
    <Tabs defaultValue="local">
      <TabsList>
        <TabsTrigger value="local">本地备份</TabsTrigger>
        <TabsTrigger value="cloud">云端同步</TabsTrigger>
        <TabsTrigger value="share">分享</TabsTrigger>
      </TabsList>
      <TabsContent value="local">
        <LocalBackupSection />
      </TabsContent>
      <TabsContent value="cloud">
        <CloudBackupSection />
      </TabsContent>
      <TabsContent value="share">
        <ShareSection />
      </TabsContent>
    </Tabs>
  );
}
