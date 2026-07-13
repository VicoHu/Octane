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
  onError: () => void;
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
  const fallbackKind = localKind(urlValid, runtimeFavIconUrl);
  const [activeKind, setActiveKind] = useState<ActiveKind>(() => fallbackKind);
  const [thirdPartyObjectUrl, setThirdPartyObjectUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const clearObjectUrl = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setThirdPartyObjectUrl(null);
  }, []);

  const showThirdPartyBlob = useCallback((blob: Blob) => {
    const next = URL.createObjectURL(blob);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = next;
    setThirdPartyObjectUrl(next);
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
        if (cache.blob) showThirdPartyBlob(cache.blob);
        if (!cache.canRefresh) return;

        const fetched = await fetchBestThirdPartyFavicon(url);
        if (!active || generationRef.current !== generation || !fetched) return;
        showThirdPartyBlob(fetched.blob);
      } catch {
        // IndexedDB / CORS / 网络失败均保持浏览器本地候选。
      }
    })();

    return () => {
      active = false;
    };
  }, [clearObjectUrl, fallbackKind, hostname, showThirdPartyBlob, url]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }, []);

  const onError = useCallback(() => {
    if (activeKind === 'third-party') {
      clearObjectUrl();
      if (hostname) void invalidateFavicon(hostname);
      setActiveKind(runtimeValid ? 'tab' : urlValid ? 'chrome' : 'none');
      return;
    }
    if (activeKind === 'tab') {
      setActiveKind(urlValid ? 'chrome' : 'none');
      return;
    }
    if (activeKind === 'chrome') setActiveKind('none');
  }, [activeKind, clearObjectUrl, hostname, runtimeValid, urlValid]);

  if (activeKind === 'third-party' && thirdPartyObjectUrl) {
    return { kind: 'third-party', src: thirdPartyObjectUrl, onError };
  }
  if (activeKind === 'tab' && runtimeValid) {
    return { kind: 'tab', src: runtimeFavIconUrl!, onError };
  }
  if (activeKind === 'chrome' && urlValid) {
    return { kind: 'chrome', src: buildFaviconRenderUrl(url), onError };
  }
  return null;
}
