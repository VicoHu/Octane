export default defineBackground({
  main() {
    // 左击扩展图标直达 side panel（Chrome sidePanel API）。
    //
    // 必须在 background(service worker) 调用：side panel 页面只有在被打开时才加载，
    // 若放在 side panel 的 main.tsx，首次使用（side panel 从未打开）时这段代码不执行，
    // openPanelOnActionClick 保持默认 false → 左击走 default_popup 开 popup（缺陷）。
    // setPanelBehavior 是 upsert：每次 service worker 启动设置，确保安装后即生效。
    //
    // Firefox 无 sidePanel API，可选链保护；M6 适配层在 P3 处理。
    // 注：chrome 全局 TS 类型缺失（TS2304），与 useCurrentTabContext 同模式，@types/chrome 列后续统一修。
    const sidePanel = (chrome as unknown as {
      sidePanel?: {
        setPanelBehavior?: (behavior: { openPanelOnActionClick: boolean }) => Promise<void>;
      };
    }).sidePanel;
    sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch((err) => {
      console.error('[octane] setPanelBehavior 失败', err);
    });
  },
});
