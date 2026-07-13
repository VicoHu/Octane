import { useEffect, useState } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { useFavicon } from '@/hooks/useFavicon';
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
 * - 刷新按钮：调 refreshFavicon 无条件重抓；成功后用返回 blob 直渲（overrideSrc），
 *   避免 useFavicon 的 effect 依赖仅 [url] 导致刷新后预览不更新
 * - URL 非法时刷新按钮 disabled
 */
export function BookmarkFaviconPreview({ url }: BookmarkFaviconPreviewProps) {
  const faviconSrc = useFavicon(url);
  const [refreshing, setRefreshing] = useState(false);
  const [overrideSrc, setOverrideSrc] = useState<string | null>(null);
  const urlValid = !!pickHostname(url);

  // url 变化：清空 override（避免切 url 后仍显示旧 override）
  useEffect(() => {
    setOverrideSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [url]);

  // 卸载或 override 切换：revoke 旧的 object URL
  useEffect(() => {
    return () => {
      if (overrideSrc) URL.revokeObjectURL(overrideSrc);
    };
  }, [overrideSrc]);

  const handleRefresh = async () => {
    if (!urlValid || refreshing) return;
    setRefreshing(true);
    try {
      const blob = await refreshFavicon(url);
      if (!blob) {
        Toast.error('刷新失败，稍后重试');
        return;
      }
      const objUrl = URL.createObjectURL(blob);
      setOverrideSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objUrl;
      });
    } catch {
      Toast.error('刷新失败，稍后重试');
    } finally {
      setRefreshing(false);
    }
  };

  const imgSrc = overrideSrc ?? faviconSrc?.src;
  const handleImageError = () => {
    if (overrideSrc) {
      URL.revokeObjectURL(overrideSrc);
      setOverrideSrc(null);
      return;
    }
    faviconSrc?.onError();
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.favicon}>
        {imgSrc ? (
          <img src={imgSrc} alt="" className={styles.img} onError={handleImageError} />
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
