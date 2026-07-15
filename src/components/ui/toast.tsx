import type { ReactNode } from 'react';
import { toast as sonnerToast } from 'sonner';

/** Semi Toast 命令式 API 的 drop-in shim：内部转调 sonner。
 *  代码库全部为字符串首参调用（如 Toast.error('刷新失败')），故签名 message: ReactNode。
 *  调用点仅改 import 路径（@douyinfe/semi-ui → @/components/ui/toast），用法不变。 */
type ToastOptions = { duration?: number; id?: string | number };

export const Toast = {
  info: (message: ReactNode, opts?: ToastOptions) => sonnerToast(message, opts),
  success: (message: ReactNode, opts?: ToastOptions) => sonnerToast.success(message, opts),
  error: (message: ReactNode, opts?: ToastOptions) => sonnerToast.error(message, opts),
  warning: (message: ReactNode, opts?: ToastOptions) => sonnerToast.warning(message, opts),
  close: (id?: string | number) => sonnerToast.dismiss(id),
};
