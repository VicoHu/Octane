/**
 * 工作区标签隔离开关：chrome.storage.local key `tabIsolationSetting` = 'off' | 'close'。
 *
 * off（默认）= 不隔离：切换工作区只改选中（selectWorkspace 纯 UI）。
 * close = 自动关闭与恢复：切换走 requestWorkspaceSwitch 编排（离开工作区关闭其标签，返回时自动恢复）。
 *
 * 安全访问 chrome.storage.local（参考 windowWorkspaceBinding 范式）：非扩展环境返回 'off' / 空操作。
 */
export type TabIsolationSetting = 'off' | 'close';

const KEY = 'tabIsolationSetting';

interface ChromeStorageLocal {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (data: Record<string, unknown>) => Promise<void>;
}

function getLocal(): ChromeStorageLocal | null {
  const g = globalThis as Record<string, unknown>;
  const chrome = g['chrome'];
  if (chrome && typeof chrome === 'object') {
    const storage = (chrome as Record<string, unknown>)['storage'];
    if (storage && typeof storage === 'object') {
      const local = (storage as Record<string, unknown>)['local'];
      if (local && typeof local === 'object') {
        return local as ChromeStorageLocal;
      }
    }
  }
  return null;
}

/** 读隔离设置；不存在或非扩展环境 → 'off'（默认不隔离）。 */
export async function getTabIsolationSetting(): Promise<TabIsolationSetting> {
  const local = getLocal();
  if (!local) return 'off';
  const r = await local.get([KEY]);
  // 仅接受 'close'；未设置 / 非法值 / 非 'close' → 'off'（默认不隔离）
  return r[KEY] === 'close' ? 'close' : 'off';
}

/** 写隔离设置。 */
export async function setTabIsolationSetting(value: TabIsolationSetting): Promise<void> {
  const local = getLocal();
  if (!local) return;
  await local.set({ [KEY]: value });
}
