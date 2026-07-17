import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LocalBackupSection } from './LocalBackupSection';
import { CloudBackupSection } from './CloudBackupSection';
import { ShareSection } from './ShareSection';

/**
 * 数据备份和同步 子 tabs（SettingsModal 的 backup pane 内）。
 *
 * 顶部 card 类型：与外层左 line 形成 纵/横 区分；与 CloudBackupSection 内部 s3/webdav
 * 的 line 形成层级区分（子级功能=card，服务商=line）。
 * 显式 keepMounted 保留各 tab 状态（等价原 Semi keepDOM）：Base UI Tabs.Panel 默认 keepMounted=false，切换会卸载 inactive 面板、丢失未保存输入（如云端凭证），故三个 TabsContent 均传 keepMounted。
 */
export function BackupSyncTabs() {
  return (
    <Tabs defaultValue="local" orientation="horizontal">
      <TabsList aria-label="备份方式" aria-orientation="horizontal">
        <TabsTrigger value="local">本地备份</TabsTrigger>
        <TabsTrigger value="cloud">云端同步</TabsTrigger>
        <TabsTrigger value="share">分享</TabsTrigger>
      </TabsList>
      <TabsContent value="local" keepMounted>
        <LocalBackupSection />
      </TabsContent>
      <TabsContent value="cloud" keepMounted>
        <CloudBackupSection />
      </TabsContent>
      <TabsContent value="share" keepMounted>
        <ShareSection />
      </TabsContent>
    </Tabs>
  );
}
