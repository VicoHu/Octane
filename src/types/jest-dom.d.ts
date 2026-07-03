// 让 src config（include 只有 src，不含 tests/setup.ts）也能识别 jest-dom 的 vitest matcher
// 类型增强（toBeInTheDocument / toBeVisible / toBeDisabled 等）。src 下 __tests__ 用到这些 matcher。
// test config 通过 tests/setup.ts 的 import 已加载；本文件补 src config 的可见性。
import '@testing-library/jest-dom/vitest';
