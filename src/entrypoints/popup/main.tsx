import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/global.css';
import './popup-reset.css';
import '@/styles/semi-theme-override.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
