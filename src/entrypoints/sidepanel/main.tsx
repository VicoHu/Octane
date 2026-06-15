import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/global.css';
import App from './App';

// 点扩展图标直达 side panel（Chrome sidePanel API）。
// Firefox 无此 API，运行时可选链保护；M6 适配层在 P3 处理。
// 注：chrome 全局 TS 类型缺失（TS2304），与 useCurrentTabContext 同模式，@types/chrome 列后续统一修。
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true } as never);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
