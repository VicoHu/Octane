import { useEffect } from 'react';
import { isUnlocked, markHidden, markVisible } from '@/services/UnlockSession';

/** hardCap 周期检查间隔（用户一直停留在 sidepanel 时兜底触发硬上限锁） */
const HARD_CAP_TICK_MS = 30_000;

/**
 * sidepanel 解锁生命周期监听（在 sidepanel 根组件挂载一次）。
 *
 * - setInterval 30s tick：周期调 isUnlocked('sidepanel')，hardCap 超时则内部清标记
 *   （触发 storage.onChanged → useEncryptedContexts 重渲染）。兜底「一直盯着永不锁」。
 * - visibilitychange：失焦记 hiddenAt，重新可见时 markVisible + 重检（grace 超时锁）。
 * - window blur/focus：与 visibilitychange 互补，覆盖部分不触发 visibilitychange 的场景。
 *
 * 仅在 sidepanel 页面注册（常驻 HTML 页面，可靠），绝不在 background/SW 用定时器（MV3 SW 休眠）。
 * 三路感知任一变化都通过 chrome.storage.session 写 → onChanged 广播给所有 useEncryptedContexts。
 */
export function useSidePanelUnlockLifecycle(): void {
  useEffect(() => {
    const tick = () => {
      void isUnlocked('sidepanel');
    };
    const onVisibility = () => {
      if (document.hidden) {
        void markHidden('sidepanel');
      } else {
        void markVisible('sidepanel').then(() => isUnlocked('sidepanel'));
      }
    };
    const onBlur = () => {
      void markHidden('sidepanel');
    };
    const onFocus = () => {
      void markVisible('sidepanel').then(() => isUnlocked('sidepanel'));
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    const timerId = window.setInterval(tick, HARD_CAP_TICK_MS);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timerId);
    };
  }, []);
}
