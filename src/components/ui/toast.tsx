import type { ReactNode } from 'react';
import { toast as sonnerToast } from 'sonner';

/** Semi Toast 命令式 API 的 drop-in shim：内部转调 sonner。
 *  同时兼容两种调用形态：
 *  - 字符串/ReactNode 首参（多数调用，如 Toast.error('刷新失败')）
 *  - 对象首参（如 Toast.success({ content: <span/>, duration: 5 })）
 *  调用点仅改 import 路径（@douyinfe/semi-ui → @/components/ui/toast），用法不变。 */
type ToastOptions = {
  duration?: number;
  id?: string | number;
  /** sonner action：切换 Toast 的「切回「Y」」按钮依赖此（设计 §2，非"撤销"）。 */
  action?: { label: ReactNode; onClick: () => void };
};
type ToastInput = ReactNode | ({ content: ReactNode } & ToastOptions);

function resolve(input: ToastInput): [ReactNode, ToastOptions] {
  if (input !== null && typeof input === 'object' && !Array.isArray(input) && 'content' in input) {
    const { content, duration, id, action } = input as { content: ReactNode } & ToastOptions;
    return [content, { duration, id, action }];
  }
  return [input, {}];
}

export const Toast = {
  info: (input: ToastInput) => {
    const [msg, opts] = resolve(input);
    return sonnerToast(msg, opts);
  },
  success: (input: ToastInput) => {
    const [msg, opts] = resolve(input);
    return sonnerToast.success(msg, opts);
  },
  error: (input: ToastInput) => {
    const [msg, opts] = resolve(input);
    return sonnerToast.error(msg, opts);
  },
  warning: (input: ToastInput) => {
    const [msg, opts] = resolve(input);
    return sonnerToast.warning(msg, opts);
  },
  loading: (input: ToastInput) => {
    const [msg, opts] = resolve(input);
    return sonnerToast.loading(msg, opts);
  },
  close: (id?: string | number) => sonnerToast.dismiss(id),
};
