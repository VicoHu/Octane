import { useEffect } from 'react';
import { isUnlocked, markHidden, markVisible } from '@/services/UnlockSession';

/** 周期检查间隔（用户一直停留在页面时兜底触发闲置锁定） */
const IDLE_TICK_MS = 30_000;

/**
 * surface 解锁生命周期监听（在对应页面根组件挂载一次）。
 *
 * - setInterval 周期调 isUnlocked(surface)：闲置超时则内部清标记
 *   （触发 storage.onChanged → useEncryptedContexts 重渲染）。兜底「一直开着永不检」。
 * - visibilitychange：失焦记 hiddenAt，重新可见时 markVisible + 重检（闲置超时锁）。
 * - window blur/focus：与 visibilitychange 互补，覆盖部分不触发 visibilitychange 的场景。
 *
 * 仅在常驻 HTML 页面注册（home / sidepanel），绝不在 background/SW 用定时器（MV3 SW 休眠）。
 */
export function useUnlockLifecycle(surface: 'home' | 'sidepanel'): void {
  useEffect(() => {
    const tick = () => {
      void isUnlocked(surface);
    };
    const onVisibility = () => {
      if (document.hidden) {
        void markHidden(surface);
      } else {
        void markVisible(surface).then(() => isUnlocked(surface));
      }
    };
    const onBlur = () => {
      void markHidden(surface);
    };
    const onFocus = () => {
      void markVisible(surface).then(() => isUnlocked(surface));
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    const timerId = window.setInterval(tick, IDLE_TICK_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timerId);
    };
  }, [surface]);
}
