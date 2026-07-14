import { build } from 'wxt';

const browserIndex = process.argv.indexOf('--browser');
const browser = browserIndex >= 0 ? process.argv[browserIndex + 1] : undefined;

try {
  await build(browser ? { browser } : undefined);
  // WXT 0.20.x 在当前工具链下完成 build 后仍残留事件循环 handle。
  // core build Promise 已成功 resolve，此处显式退出；真实构建异常仍由 catch 返回非 0。
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
