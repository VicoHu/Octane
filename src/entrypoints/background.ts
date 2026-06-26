import { handleMessage } from '@/services/BackupMessaging';
import {
  focusOrCreateHomeTab,
  ensureHomeTabInAllWindows,
  dedupeHomeTabsInWindow,
} from '@/shared/tabs/focusOrCreateHomeTab';

// onMessage listener 顶层注册：service worker 一加载即注册，
// 避免 listener 在 main() 内因 SW 唤醒时序导致首次 sendMessage 收到 "Receiving end does not exist"。
browser.runtime.onMessage.addListener((msg) => handleMessage(msg));

// logo tab 常驻保证：顶层注册（与 onMessage 同策略，避免 SW 唤醒时序丢事件）。
// 放弃 newtab override 后，改为每窗口常驻一个 pinned home tab（见 home entrypoint + focusOrCreateHomeTab）。
// - install：首次安装，当前窗口唤起 logo tab
// - update / startup：升级 / 浏览器启动，补齐所有窗口
// - windows.onCreated：每个新窗口放一个 logo tab
browser.runtime.onInstalled.addListener((details) => {
  const reason = details.reason;
  if (reason === 'install') {
    focusOrCreateHomeTab().catch((e) =>
      console.error('[octane] onInstalled(install) 唤起 logo tab 失败', e),
    );
  } else if (reason === 'update') {
    ensureHomeTabInAllWindows().catch((e) =>
      console.error('[octane] onInstalled(update) 补齐 logo tab 失败', e),
    );
  }
});
browser.runtime.onStartup.addListener(() => {
  ensureHomeTabInAllWindows().catch((e) =>
    console.error('[octane] onStartup 补齐 logo tab 失败', e),
  );
});
browser.windows.onCreated.addListener((window) => {
  if (window.id != null) {
    focusOrCreateHomeTab(window.id).catch((e) =>
      console.error('[octane] windows.onCreated 唤起 logo tab 失败', e),
    );
  }
});

// logo tab 去重：windows.onCreated 早于 session restore，可能误建第二个 pinned
// home tab。监听 home tab 加载完成（complete），对所在窗口去重，保留首个。
// 顶层注册（与上面 listener 同策略，避免 SW 唤醒时序丢事件）。
const HOME_URL = browser.runtime.getURL('/home.html');
browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || tab.url !== HOME_URL) return;
  if (tab.windowId == null) return;
  dedupeHomeTabsInWindow(tab.windowId).catch((e) =>
    console.error('[octane] tabs.onUpdated 去重 logo tab 失败', e),
  );
});

export default defineBackground({
  main() {
    // 左击扩展图标直达 side panel（Chrome sidePanel API）。
    //
    // 必须在 background(service worker) 调用：side panel 页面只有在被打开时才加载，
    // 若放在 side panel 的 main.tsx，首次使用（side panel 从未打开）时这段代码不执行，
    // openPanelOnActionClick 保持默认 false → 左击走 default_popup 开 popup（缺陷）。
    // setPanelBehavior 是 upsert：每次 service worker 启动设置，确保安装后即生效。
    //
    // 本版本专注 Chrome（不做 Firefox sidebar_action 适配）。
    // chrome 全局 TS 类型缺失（TS2304），类型断言绕过，@types/chrome 列后续统一修。
    (chrome as unknown as {
      sidePanel: {
        setPanelBehavior: (behavior: { openPanelOnActionClick: boolean }) => Promise<void>;
      };
    }).sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((err) => {
        console.error('[octane] setPanelBehavior 失败', err);
      });
  },
});
