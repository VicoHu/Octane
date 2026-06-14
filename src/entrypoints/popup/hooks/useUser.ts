/** 当前登录用户。 */
export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

/**
 * 读取当前登录用户。
 *
 * v1 占位：账户系统尚未实现，始终返回 null（guest 态）。
 * 未来接入鉴权后，仅改此 hook 的实现，调用方 UI 结构不变。
 */
export function useUser(): User | null {
  return null;
}
