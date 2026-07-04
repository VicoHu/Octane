import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Octane',
    description: '书签 + 上下文 + 安全 — 浏览器里最方便的带上下文书签夹',
    permissions: ['storage', 'tabs', 'sidePanel', 'favicon'],
    host_permissions: ['https://*.aliyuncs.com/*', 'https://*.myqcloud.com/*', 'https://dav.jianguoyun.com/*'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; style-src 'self' 'unsafe-inline'",
    },
    icons: {
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
    // 全局快捷键：open-home 走 background onCommand handler；_execute_side_panel_action 是
    // Chrome 116+ 保留命令，由 Chrome 直接打开 side panel（不经 onCommand——sidePanel.open 需
    // user gesture，onCommand 非手势，故 side panel 只能用保留命令）。
    minimum_chrome_version: '116',
    commands: {
      'open-home': {
        suggested_key: { default: 'Alt+Shift+H' },
        description: '打开 Octane 首页',
      },
      '_execute_side_panel_action': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '打开 Octane 侧边栏',
      },
    },
  },
});
