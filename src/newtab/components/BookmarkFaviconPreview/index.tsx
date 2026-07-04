import { useState } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { useFavicon } from '@/newtab/hooks/useFavicon';
import { refreshFavicon, pickHostname } from '@/services/FaviconService';
import styles from './index.module.css';

interface BookmarkFaviconPreviewProps {
  /** 绑定到表单当前 URL 值，跟随用户编辑实时预览 */
  url: string;
}

/**
 * 编辑/创建书签表单的 favicon 预览 + 刷新按钮（D2-refresh）。
 *
 * - 预览走 useFavicon（blob 优先，未命中 _favicon 占位）
 * - 刷新按钮：调 refreshFavicon 无条件重抓；失败 Toast 提示且预览保持原样
 * - URL 非法时刷新按钮 disabled
 */
export function BookmarkFaviconPreview({ url }: BookmarkFaviconPreviewProps) {
  const faviconSrc = useFavicon(url);
  const [refreshing, setRefreshing] = useState(false);
  const urlValid = !!pickHostname(url);

  const handleRefresh = async () => {
    if (!urlValid || refreshing) return;
    setRefreshing(true);
    try {
      const blob = await refreshFavicon(url);
      if (!blob) {
        Toast.error('刷新失败，稍后重试');
      }
    } catch {
      Toast.error('刷新失败，稍后重试');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.favicon}>
        {faviconSrc ? (
          <img src={faviconSrc.src} alt="" className={styles.img} />
        ) : (
          <div className={styles.fallback}>?</div>
        )}
      </div>
      <Button
        theme="borderless"
        type="tertiary"
        icon={<IconRefresh />}
        aria-label="刷新 favicon"
        loading={refreshing}
        disabled={!urlValid || refreshing}
        onClick={handleRefresh}
      />
    </div>
  );
}
