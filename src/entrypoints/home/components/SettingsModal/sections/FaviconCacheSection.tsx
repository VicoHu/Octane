import { useState } from 'react';
import { Button, Popconfirm, Toast, Typography } from '@douyinfe/semi-ui';
import { IconDelete } from '@douyinfe/semi-icons';
import { clearAllFavicons } from '@/services/FaviconService';

/**
 * favicon 缓存管理（系统设置 → 数据备份和同步）。
 *
 * 清空本地 favicon 缓存（`favicons` store），下次访问书签时 useFavicon 未命中，
 * 重新走抓取链（icon.horse → DuckDuckGo → 源站）入库。
 *
 * Popconfirm onConfirm 用 `void` 包装（不返回 Promise），避免 Semi Popconfirm
 * 进入异步 loading 模式后 overlay(z-index 1030) 遮挡 Toast(1010)——与 BookmarkCard
 * 删除确认同坑。loading 态走组件内 state + Button loading。
 */
export function FaviconCacheSection() {
  const [loading, setLoading] = useState(false);

  const handleClear = async (): Promise<void> => {
    setLoading(true);
    try {
      await clearAllFavicons();
      Toast.success('已清空 favicon 缓存，下次访问书签将重新抓取');
    } catch {
      Toast.error('清空失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={{ marginTop: 24 }}>
      <Typography.Title heading={5} style={{ marginBottom: 4 }}>favicon 缓存</Typography.Title>
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
        书签图标缓存在本地以加快加载。清空后下次访问书签时会重新从网络抓取。
      </Typography.Text>
      <Popconfirm
        title="清空 favicon 缓存"
        content="将删除所有书签图标的本地缓存，下次访问时重新抓取。"
        onConfirm={() => {
          void handleClear();
        }}
      >
        <Button
          theme="borderless"
          type="danger"
          icon={<IconDelete />}
          loading={loading}
          aria-label="清空 favicon 缓存"
        >
          清空缓存
        </Button>
      </Popconfirm>
    </section>
  );
}
