import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Button, Toast } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { useFavicon } from '@/hooks/useFavicon';
import { invalidateFavicon, refreshFavicon, pickHostname } from '@/services/FaviconService';
import styles from './index.module.css';

interface BookmarkFaviconPreviewProps {
  /** 绑定到表单当前 URL 值，跟随用户编辑实时预览 */
  url: string;
}

/**
 * 编辑/创建书签表单的 favicon 预览 + 刷新按钮（D2-refresh）。
 *
 * - 预览走 useFavicon（blob 优先，未命中 _favicon 占位）
 * - 刷新按钮：调 refreshFavicon 无条件重抓；成功后用返回结果中的 blob 直渲（overrideSource），
 *   避免 useFavicon 的 effect 依赖仅 [url] 导致刷新后预览不更新
 * - URL 非法时刷新按钮 disabled
 */
export function BookmarkFaviconPreview({ url }: BookmarkFaviconPreviewProps) {
  const faviconSrc = useFavicon(url);
  const [refreshing, setRefreshing] = useState(false);
  const [overrideSource, setOverrideSource] = useState<{
    src: string;
    cacheId?: string;
  } | null>(null);
  const hostname = pickHostname(url);
  const urlValid = !!hostname;
  const mountedRef = useRef(false);
  const currentUrlRef = useRef(url);
  const refreshRequestRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
    };
  }, []);

  // url 变化：使旧请求失效，并清空 override（避免切 url 后仍显示旧 override）
  useLayoutEffect(() => {
    currentUrlRef.current = url;
    refreshRequestRef.current += 1;
    setRefreshing(false);
    setOverrideSource(null);
  }, [url]);

  // 卸载或 override 切换：revoke 旧的 object URL
  useEffect(() => {
    return () => {
      if (overrideSource) URL.revokeObjectURL(overrideSource.src);
    };
  }, [overrideSource]);

  const handleRefresh = async () => {
    if (!urlValid || refreshing) return;
    const requestUrl = url;
    const requestId = ++refreshRequestRef.current;
    const requestIsCurrent = () => mountedRef.current
      && currentUrlRef.current === requestUrl
      && refreshRequestRef.current === requestId;

    setRefreshing(true);
    try {
      const refreshed = await refreshFavicon(requestUrl);
      if (!requestIsCurrent()) return;
      if (!refreshed) {
        Toast.error('刷新失败，稍后重试');
        return;
      }
      const objUrl = URL.createObjectURL(refreshed.blob);
      setOverrideSource({ src: objUrl, cacheId: refreshed.cacheId });
    } catch {
      if (requestIsCurrent()) Toast.error('刷新失败，稍后重试');
    } finally {
      if (requestIsCurrent()) setRefreshing(false);
    }
  };

  const imgSrc = overrideSource?.src ?? faviconSrc?.src;
  const handleImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    if (overrideSource) {
      if (event.currentTarget.src !== overrideSource.src) return;
      setOverrideSource(null);
      if (hostname && overrideSource.cacheId) {
        void invalidateFavicon(hostname, overrideSource.cacheId).catch(() => undefined);
      }
      return;
    }
    faviconSrc?.onError(event);
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
