import { handleMessage } from '@/services/BackupMessaging';
import { handleCommand } from '@/services/CommandHandler';
import { savePendingUpdate, clearPendingUpdate } from '@/services/UpdateStore';
import {
  focusOrCreateHomeTab,
  ensureHomeTabInAllWindows,
  dedupeHomeTabsInWindow,
} from '@/shared/tabs/focusOrCreateHomeTab';
import { sessionContinuity } from '@/shared/tabs/sessionContinuity';
import { registerChromeListener } from '@/entrypoints/background/registerChromeListener';

// 项目无 @types/chrome：声明全局 chrome（运行时 globalThis.chrome），最小子集断言（参考 CommandHandler.ts）。
declare const chrome: unknown;

// onMessage listener 顶层注册：service worker 一加载即注册，
// 避免 listener 在 main() 内因 SW 唤醒时序导致首次 sendMessage 收到 "Receiving end does not exist"。
browser.runtime.onMessage.addListener((msg) => handleMessage(msg));

// 快捷键命令分发（commands API）：顶层注册避 SW 唤醒时序丢首次按键（plan-eng-review A1）。
// try/catch：wxt 0.20 build 期 import background 顶层时注入 fakeBrowser（commands.onCommand
// 未实现，runtime.onMessage 已实现故 onMessage 不报）；runtime(SW) 真实 chrome.commands 不会抛。
const chromeApi = (
  globalThis as unknown as {
    chrome?: {
      commands?: {
        onCommand?: {
          addListener(fn: (command: string) => void): void;
        };
      };
    };
  }
).chrome;
try {
  chromeApi?.commands?.onCommand?.addListener((command) =>
    handleCommand(command).catch((e) =>
      console.error('[octane] onCommand handler 异常', e),
    ),
  );
} catch {
  // wxt build 期 fakeBrowser stub 未实现 commands.onCommand；忽略，SW runtime 正常注册。
}

// Chrome 检测到商店更新包时触发（商店用户被动感知）：持久化待装版本供 home 显示。
// 顶层注册（与 onInstalled 同策略，避 SW 唤醒时序丢事件）。不 reload（不强制重启）。
browser.runtime.onUpdateAvailable.addListener((details: { version: string }) => {
  savePendingUpdate(details.version).catch((e) =>
    console.error('[octane] onUpdateAvailable 保存 pendingUpdate 失败', e),
  );
});

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
    // 更新已装 → 清除 pendingUpdate 提示（避免残留）
    clearPendingUpdate().catch((e) =>
      console.error('[octane] onInstalled(update) 清理 pendingUpdate 失败', e),
    );
  }
});
browser.runtime.onStartup.addListener(() => {
  void (async () => {
    try {
      await ensureHomeTabInAllWindows();
      await sessionContinuity?.startColdRecovery();
    } catch (e) {
      console.error('[octane] onStartup 补齐 logo tab 或恢复标签会话失败', e);
    }
  })();
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
  sessionContinuity?.notifyTopologyChanged();
  if (changeInfo.status !== 'complete' || tab.url !== HOME_URL) return;
  if (tab.windowId == null) return;
  dedupeHomeTabsInWindow(tab.windowId).catch((e) =>
    console.error('[octane] tabs.onUpdated 去重 logo tab 失败', e),
  );
});

// MV3 listener 必须在 worker 加载时同步注册。只有 onStartup 会调用冷恢复；其余事件只更新快照。
const chromeEvents = (globalThis as unknown as {
  chrome?: {
    tabs?: {
      onCreated?: { addListener(listener: () => void): void };
      onRemoved?: { addListener(listener: () => void): void };
      onMoved?: { addListener(listener: () => void): void };
      onAttached?: { addListener(listener: () => void): void };
      onDetached?: { addListener(listener: () => void): void };
    };
    tabGroups?: {
      onCreated?: { addListener(listener: () => void): void };
      onUpdated?: { addListener(listener: () => void): void };
      onMoved?: { addListener(listener: () => void): void };
      onRemoved?: { addListener(listener: () => void): void };
    };
    storage?: {
      onChanged?: { addListener(listener: (changes: Record<string, unknown>, areaName: string) => void): void };
    };
  };
}).chrome;
const requestSessionAutosave = () => sessionContinuity?.notifyTopologyChanged();
registerChromeListener(chromeEvents?.tabs?.onCreated, requestSessionAutosave);
registerChromeListener(chromeEvents?.tabs?.onRemoved, requestSessionAutosave);
registerChromeListener(chromeEvents?.tabs?.onMoved, requestSessionAutosave);
registerChromeListener(chromeEvents?.tabs?.onAttached, requestSessionAutosave);
registerChromeListener(chromeEvents?.tabs?.onDetached, requestSessionAutosave);
registerChromeListener(chromeEvents?.tabGroups?.onCreated, requestSessionAutosave);
registerChromeListener(chromeEvents?.tabGroups?.onUpdated, requestSessionAutosave);
registerChromeListener(chromeEvents?.tabGroups?.onMoved, requestSessionAutosave);
registerChromeListener(chromeEvents?.tabGroups?.onRemoved, requestSessionAutosave);
registerChromeListener(chromeEvents?.storage?.onChanged, (changes, areaName) => {
  if (areaName === 'local' && 'tabIsolationSetting' in changes) {
    void sessionContinuity?.handleIsolationSettingChanged();
  }
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
