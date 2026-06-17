import { handleMessage } from '@/services/BackupMessaging';

// onMessage listener 顶层注册：service worker 一加载即注册，
// 避免 listener 在 main() 内因 SW 唤醒时序导致首次 sendMessage 收到 "Receiving end does not exist"。
browser.runtime.onMessage.addListener((msg) => handleMessage(msg));

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
