import { useUnlockLifecycle } from '@/hooks/useUnlockLifecycle';

/**
 * sidepanel 解锁生命周期监听（sidepanel 根组件挂载一次）。
 * 统一自动锁定模型（#96）后为 useUnlockLifecycle('sidepanel') 的薄封装，保留原名以稳定引用。
 */
export function useSidePanelUnlockLifecycle(): void {
  useUnlockLifecycle('sidepanel');
}
