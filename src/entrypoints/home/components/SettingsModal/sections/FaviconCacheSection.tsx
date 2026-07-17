import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { Typography } from '@/components/ui/typography';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Trash2 } from 'lucide-react';
import { clearAllFavicons } from '@/services/FaviconService';

/**
 * favicon 缓存管理（系统设置 → 数据备份和同步）。
 *
 * 只清空第三方高清 favicon 缓存。浏览器本地 favicon 仍会立即显示，
 * 外网站点随后在后台重新尝试 Icon Horse 高清升级。
 *
 * AlertDialog 受控开关：确认后 fire-and-forget handleClear + 关闭，
 * loading 态走组件内 state + Button disabled。
 */
export function FaviconCacheSection() {
  const [loading, setLoading] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);

  const handleClear = async (): Promise<void> => {
    setLoading(true);
    try {
      await clearAllFavicons();
      Toast.success('已清空第三方 favicon 缓存，将在后台重新获取高清图标');
    } catch {
      Toast.error('清空失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={{ marginTop: 24 }}>
      <Typography.Title heading={5} style={{ marginBottom: 4 }}>favicon 缓存</Typography.Title>
      <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 12 }}>
        仅清除第三方高清图标缓存。浏览器本地图标仍可立即显示，外网站点会在后台重新获取高清图标。
      </Typography.Text>
      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogTrigger render={<Button variant="destructive" disabled={loading} aria-label="清空 favicon 缓存" />}>
          <Trash2 />
          清空缓存
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空 favicon 缓存</AlertDialogTitle>
            <AlertDialogDescription>将删除第三方高清图标缓存；浏览器本地图标不受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                void handleClear();
                setAlertOpen(false);
              }}
            >
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
