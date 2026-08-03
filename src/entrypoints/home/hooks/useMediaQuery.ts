import { useCallback, useMemo, useSyncExternalStore } from 'react';

/** TodoPage 专用媒体查询订阅，服务端和 jsdom 默认视为非匹配。 */
export function useMediaQuery(query: string): boolean {
  const mediaQueryList = useMemo(
    () => (typeof window === 'undefined' ? null : window.matchMedia(query)),
    [query],
  );
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!mediaQueryList) return () => undefined;
      mediaQueryList.addEventListener('change', onStoreChange);
      return () => mediaQueryList.removeEventListener('change', onStoreChange);
    },
    [mediaQueryList],
  );
  const getSnapshot = useCallback(() => mediaQueryList?.matches ?? false, [mediaQueryList]);
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
