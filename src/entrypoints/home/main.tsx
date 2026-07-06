// React 19 适配：Semi 的 Toast/Modal/Notification 静态方法内部用 createRoot 自建 portal，
// React 19 移除了 react-dom 的 createRoot 导出，必须在使用 Semi 组件前注入 adapter。
// 必须在最顶部，先于任何 Semi 组件 import。
import '@douyinfe/semi-ui/react19-adapter';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
