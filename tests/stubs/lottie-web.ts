// jsdom 无 canvas 支持，lottie-web 模块求值时会跑 canvas.getContext('2d').fillStyle → 崩。
// Semi barrel（@douyinfe/semi-ui/lib/es/index.js）静态 re-export ./lottie，链路
// foundation 顶层 `import lottie from 'lottie-web'`，导致任何 importActual/barrel
// 求值都会触发崩溃。测试环境通过 vitest.config.ts 的 resolve.alias 全局指向此 stub，
// 让所有测试可真实渲染 Semi 组件而无需逐文件 vi.mock。
// 真实渲染 Semi 组件不触发 Lottie 播放，空实现足够；详见 docs/standards/testing.md §4.4。
export default {
  loadAnimation: () => ({
    destroy() {},
    play() {},
    pause() {},
    addEventListener() {},
    removeEventListener() {},
  }),
  destroy() {},
  registerAnimation() {},
};
