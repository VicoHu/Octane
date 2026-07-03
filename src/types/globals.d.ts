// 全局类型声明：解决 wxt/tsc 下 ambient 类型缺失问题

// 1. chrome 全局变量：@types/chrome 用 `declare namespace chrome`（类型命名空间），
//    不创建全局 var，故 `chrome.tabs` 等值位置访问报 Cannot find name 'chrome'。
//    这里把命名空间桥接为全局变量，保留全部类型信息。
/// <reference types="chrome" />
declare const chrome: typeof globalThis.chrome;

// 2. vitest 全局 API（describe/it/expect/afterEach 等）。
//    vitest.config.ts 开启了 globals: true，运行时可用，但类型需显式引入。
/// <reference types="vitest/globals" />
