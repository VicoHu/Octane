import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildFaviconRenderUrl,
  fetchBestThirdPartyFavicon,
  getThirdPartyCache,
  invalidateFavicon,
  isPrivateFaviconTarget,
  pickHostname,
} from '@/services/FaviconService';
import { isSafeFavIcon } from '@/shared/tabs/safeFavIcon';

export interface FaviconRenderSource {
  kind: 'third-party' | 'tab' | 'chrome';
  src: string;
  onError: (event?: { currentTarget?: { src?: string } }) => void;
}

type ActiveKind = FaviconRenderSource['kind'] | 'none';

function localKind(urlValid: boolean, runtimeFavIconUrl?: string): ActiveKind {
  if (isSafeFavIcon(runtimeFavIconUrl)) return 'tab';
  return urlValid ? 'chrome' : 'none';
}

export function useFavicon(
  url: string,
  runtimeFavIconUrl?: string,
): FaviconRenderSource | null {
  const hostname = pickHostname(url);
  const urlValid = !!hostname;
  const runtimeValid = isSafeFavIcon(runtimeFavIconUrl);
  const safeRuntimeFavIconUrl = runtimeValid ? runtimeFavIconUrl : undefined;
  const fallbackKind = localKind(urlValid, safeRuntimeFavIconUrl);
  const [activeKind, setActiveKind] = useState<ActiveKind>(() => fallbackKind);
  const [thirdPartySource, setThirdPartySource] = useState<{
    src: string;
    cacheId?: string;
  } | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const clearObjectUrl = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setThirdPartySource(null);
  }, []);

  const showThirdPartyBlob = useCallback((blob: Blob, cacheId?: string) => {
    const next = URL.createObjectURL(blob);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = next;
    setThirdPartySource({ src: next, cacheId });
    setActiveKind('third-party');
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    let active = true;

    clearObjectUrl();
    setActiveKind(fallbackKind);

    if (!hostname || isPrivateFaviconTarget(url)) {
      return () => {
        active = false;
      };
    }

    void (async () => {
      try {
        const cache = await getThirdPartyCache(hostname);
        if (!active || generationRef.current !== generation) return;
        if (cache.blob) showThirdPartyBlob(cache.blob, cache.record?.cacheId);
        if (!cache.canRefresh) return;

        const fetched = await fetchBestThirdPartyFavicon(url);
        if (!active || generationRef.current !== generation || !fetched) return;
        showThirdPartyBlob(fetched.blob, fetched.cacheId);
      } catch {
        // IndexedDB / CORS / 网络失败均保持浏览器本地候选。
      }
    })();

    return () => {
      active = false;
    };
  }, [clearObjectUrl, fallbackKind, hostname, safeRuntimeFavIconUrl, showThirdPartyBlob, url]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }, []);

  const onError = useCallback((event?: { currentTarget?: { src?: string } }) => {
    if (activeKind === 'third-party') {
      const failedSrc = event?.currentTarget?.src;
      if (failedSrc && thirdPartySource && failedSrc !== thirdPartySource.src) return;
      const failedCacheId = thirdPartySource?.cacheId;
      clearObjectUrl();
      if (hostname && failedCacheId) void invalidateFavicon(hostname, failedCacheId);
      setActiveKind(runtimeValid ? 'tab' : urlValid ? 'chrome' : 'none');
      return;
    }
    if (activeKind === 'tab') {
      setActiveKind(urlValid ? 'chrome' : 'none');
      return;
    }
    if (activeKind === 'chrome') setActiveKind('none');
  }, [activeKind, clearObjectUrl, hostname, runtimeValid, thirdPartySource, urlValid]);

  if (activeKind === 'third-party' && thirdPartySource) {
    return { kind: 'third-party', src: thirdPartySource.src, onError };
  }
  if (activeKind === 'tab' && runtimeValid) {
    return { kind: 'tab', src: safeRuntimeFavIconUrl!, onError };
  }
  if (activeKind === 'chrome' && urlValid) {
    return { kind: 'chrome', src: buildFaviconRenderUrl(url), onError };
  }
  return null;
}
