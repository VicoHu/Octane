export type ChromeListener<T extends (...args: never[]) => void> = {
  addListener(listener: T): void;
};

const WXT_FAKE_BROWSER_ERROR = "Mock the function yourself using your testing framework";

function isWxtFakeBrowserNotImplementedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("not implemented.") && message.includes(WXT_FAKE_BROWSER_ERROR);
}

/**
 * 注册 MV3 listener。WXT 构建注入的 fakeBrowser 对未实现事件会抛出特征错误；
 * 真实 Chrome 注册失败必须继续抛出，避免静默丢失 autosave 或 isolation listener。
 */
export function registerChromeListener<T extends (...args: never[]) => void>(
  event: ChromeListener<T> | undefined,
  listener: T,
): void {
  try {
    event?.addListener(listener);
  } catch (error) {
    if (isWxtFakeBrowserNotImplementedError(error)) return;
    throw error;
  }
}
