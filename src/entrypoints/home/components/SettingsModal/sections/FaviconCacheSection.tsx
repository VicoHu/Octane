import { useState } from 'react';
import { Button, Popconfirm, Toast, Typography } from '@douyinfe/semi-ui';
import { IconDelete } from '@douyinfe/semi-icons';
import { clearAllFavicons } from '@/services/FaviconService';

/**
 * favicon 缓存管理（系统设置 → 数据备份和同步）。
 *
 * 只清空第三方高清 favicon 缓存。浏览器本地 favicon 仍会立即显示，
 * 外网站点随后在后台重新尝试 Icon Horse / DuckDuckGo 高清升级。
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
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
        仅清除第三方高清图标缓存。浏览器本地图标仍可立即显示，外网站点会在后台重新获取高清图标。
      </Typography.Text>
      <Popconfirm
        title="清空 favicon 缓存"
        content="将删除第三方高清图标缓存；浏览器本地图标不受影响。"
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
