import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Octane',
    description: '书签 + 笔记 + 安全 — 浏览器里最方便的带笔记书签夹',
    permissions: ['storage', 'tabs', 'sidePanel'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; style-src 'self' 'unsafe-inline'",
    },
    icons: {
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
});
