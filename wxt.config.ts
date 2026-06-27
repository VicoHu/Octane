import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // Vite 8 的 worker pool（MessagePort）在 build 完成后不会关闭，导致进程挂起不退出。
    // 在所有产物落盘后强制退出。dev/serve 不会触发 build:done；
    // wxt zip 内部也会先 build，需放行以免打断后续打包流程。
    'build:done': () => {
      if (process.argv.slice(2).includes('zip')) return;
      console.log('\n✓ Build 完成，产物已写入 .output/chrome-mv3/');
      process.exit(0);
    },
  },
  manifest: {
    name: 'Octane',
    description: '书签 + 笔记 + 安全 — 浏览器里最方便的带笔记书签夹',
    permissions: ['storage', 'tabs', 'sidePanel'],
    host_permissions: ['https://*.aliyuncs.com/*', 'https://*.myqcloud.com/*'],
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
