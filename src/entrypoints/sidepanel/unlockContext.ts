import { createContext, useContext } from 'react';

interface UnlockApi {
  /** 发起 sidepanel 解锁（检查前置条件后弹密码框，或 Toast 引导去 home） */
  requestUnlock: () => void;
}

/** 默认 noop，便于未包 Provider 时（如单元测试）安全调用 */
export const UnlockContext = createContext<UnlockApi>({ requestUnlock: () => {} });

export const useUnlockRequest = () => useContext(UnlockContext).requestUnlock;
