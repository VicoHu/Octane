import { useEffect, useState } from 'react';
import {
  getCachedBlob,
  fetchAndStoreFavicon,
  buildFaviconRenderUrl,
  pickHostname,
} from '@/services/FaviconService';

export type FaviconSrc =
  | { kind: 'blob'; src: string } // createObjectURL 结果
  | { kind: 'remote'; src: string } // _favicon 占位 URL
  | null; // 无可用源 → 首字母回退

/**
 * 书签 favicon 渲染源。
 *
 * 优先级：
 * 1. DB 命中 → createObjectURL(blob)，秒开 + 离线可用
 * 2. 未命中 → _favicon chrome-extension URL（同步可渲染占位），同时后台抓取入库
 * 3. 后台抓取成功 → 切 blob 态
 *
 * 卸载 / url 变化 → revoke 旧 blob URL，丢弃过期后台抓取结果（active flag）。
 * 非 http(s) / 空 url（pickHostname 返回 null）→ 返回 null（首字母回退）。
 */
export function useFavicon(url: string): FaviconSrc {
  const valid = !!pickHostname(url);
  const [src, setSrc] = useState<FaviconSrc>(() =>
    valid ? { kind: 'remote', src: buildFaviconRenderUrl(url) } : null,
  );

  useEffect(() => {
    if (!valid) {
      setSrc(null);
      return;
    }
    // 立即给 remote 占位（避免等 DB 时空白）
    setSrc({ kind: 'remote', src: buildFaviconRenderUrl(url) });

    let active = true;
    let objectUrl: string | null = null;

    (async () => {
      const cached = await getCachedBlob(new URL(url).hostname);
      if (!active) return;
      if (cached) {
        objectUrl = URL.createObjectURL(cached);
        setSrc({ kind: 'blob', src: objectUrl });
        return;
      }
      // 未命中：后台抓取，成功后切 blob 态
      const fetched = await fetchAndStoreFavicon(url);
      if (!active || !fetched) return;
      objectUrl = URL.createObjectURL(fetched);
      setSrc({ kind: 'blob', src: objectUrl });
    })().catch(() => {
      // 抓取失败保持 remote 占位，静默（BookmarkCard onError 回退首字母）
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return src;
}
