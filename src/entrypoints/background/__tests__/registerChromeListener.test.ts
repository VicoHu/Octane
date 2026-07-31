import { describe, expect, it, vi } from "vitest";
import { registerChromeListener } from "../registerChromeListener";

const fakeBrowserError = () =>
  new Error(
    "Browser.tabs.onMoved.addListener not implemented.\n\n" +
      "Mock the function yourself using your testing framework, or submit a PR with an in-memory implementation.",
  );

describe("registerChromeListener", () => {
  it("成功注册 Chrome listener", () => {
    const addListener = vi.fn();
    const listener = vi.fn();

    registerChromeListener({ addListener }, listener);

    expect(addListener).toHaveBeenCalledWith(listener);
  });

  it("跳过 WXT fakeBrowser 的未实现 listener 错误", () => {
    const addListener = vi.fn(() => {
      throw fakeBrowserError();
    });

    expect(() => registerChromeListener({ addListener }, vi.fn())).not.toThrow();
  });

  it("重新抛出非 fakeBrowser 的注册错误", () => {
    const registrationError = new Error("Chrome listener registration failed");
    const addListener = vi.fn(() => {
      throw registrationError;
    });

    expect(() => registerChromeListener({ addListener }, vi.fn())).toThrow(registrationError);
  });
});
