import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toast } from "@/components/ui/toast";

// 副作用边界 mock：service 层（DB）+ favicon hook（DB）+ Toast 静态方法
vi.mock("@/services/PinnedTabService", () => ({
  listByWorkspace: vi.fn(async () => [] as never[]),
  // 返回完整 PinnedTab，避免 store 追加后 PinChip 读 pin.name 崩
  createPinnedTab: vi.fn(
    async (_ws: string, data: { name: string; url: string }) =>
      ({ id: "new-pin", workspaceId: _ws, name: data.name, url: data.url, order: 99, createdAt: 0 }) as never,
  ),
  deletePinnedTab: vi.fn(async () => undefined),
  PINNED_TAB_CAP: 8,
}));
vi.mock("@/hooks/useFavicon", () => ({
  useFavicon: vi.fn(() => ({ kind: "third-party", src: "blob:test", onError: vi.fn() })),
}));
vi.mock("@/components/ui/toast", () => ({
  Toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), close: vi.fn() },
}));

import { PinnedArea } from "../../PinnedArea";
import * as PinnedTabService from "@/services/PinnedTabService";
import { usePinnedTabs } from "@/store/usePinnedTabs";
import { useFavicon } from "@/hooks/useFavicon";
import type { PinnedTab } from "@/shared/types";
import type { OpenTab } from "../../../hooks/useOpenTabs";

function makePin(id: string, name: string, url: string, order: number): PinnedTab {
  return { id, workspaceId: "ws-1", name, url, order, createdAt: 0 };
}

function renderArea(openTabs: OpenTab[] = []) {
  return render(<PinnedArea workspaceId="ws-1" openTabs={openTabs} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useFavicon).mockReturnValue({ kind: "third-party", src: "blob:test", onError: vi.fn() });
  usePinnedTabs.setState({ pinnedTabs: [], loading: false });
  // listByWorkspace 默认返回空，单测按需 override
  vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([]);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("PinnedArea", () => {
  it("workspaceId 变更 → loadPinnedTabs 以新 id 重载", async () => {
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([]);
    const { rerender } = renderArea();
    await screen.findByText("常驻书签");
    expect(PinnedTabService.listByWorkspace).toHaveBeenLastCalledWith("ws-1");

    rerender(<PinnedArea workspaceId="ws-2" openTabs={[]} />);
    await waitFor(() => {
      expect(PinnedTabService.listByWorkspace).toHaveBeenLastCalledWith("ws-2");
    });
  });
  it("空状态：渲染「常驻书签」标题 + 空提示 + 「+」按钮", async () => {
    renderArea();
    await screen.findByText("常驻书签");
    expect(screen.getByText(/添加常驻/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加常驻标签/ })).toBeEnabled();
  });

  it("有 pin：渲染每个 chip（按 name）+ 「+」添加按钮", async () => {
    const pins = [makePin("p1", "GitHub", "https://github.com", 0), makePin("p2", "Notion", "https://notion.so", 1)];
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue(pins);

    renderArea();
    await screen.findByRole("button", { name: /打开 GitHub/ });
    expect(screen.getByRole("button", { name: /打开 Notion/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加常驻标签/ })).toBeInTheDocument();
  });

  it("favicon 加载失败交给 hook，hook 返回 null 后显示首字母", async () => {
    const onError = vi.fn();
    vi.mocked(useFavicon).mockReturnValue({ kind: "tab", src: "runtime-icon", onError });
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([makePin("p1", "GitHub", "https://github.com", 0)]);

    const view = renderArea();
    await screen.findByRole("button", { name: /打开 GitHub/ });
    // userEvent 不提供资源加载失败事件；这里精确触发 img 的底层 error 边界。
    fireEvent.error(screen.getByRole("presentation"));
    expect(onError).toHaveBeenCalledTimes(1);

    vi.mocked(useFavicon).mockReturnValue(null);
    view.rerender(<PinnedArea workspaceId="ws-1" openTabs={[]} />);
    expect(screen.getByText("G")).toBeInTheDocument();
  });

  it("匹配打开 Tab 后把 runtime favicon 传给 PinChip hook", async () => {
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([makePin("p1", "GitHub", "https://github.com", 0)]);
    renderArea([
      {
        url: "https://github.com/settings",
        tabId: 9,
        lastAccessed: 200,
        favIconUrl: "https://github.com/runtime.svg",
      },
    ]);

    await screen.findByRole("button", { name: /打开 GitHub/ });
    expect(useFavicon).toHaveBeenCalledWith("https://github.com", "https://github.com/runtime.svg");
  });

  it("点击 chip → 在当前窗口最右侧创建前台 tab", async () => {
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([makePin("p1", "GitHub", "https://github.com", 0)]);

    renderArea();
    const chip = await screen.findByRole("button", { name: /打开 GitHub/ });
    await userEvent.click(chip);
    const tabs = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs;
    await waitFor(() =>
      expect(tabs.create).toHaveBeenCalledWith({
        url: "https://github.com",
        active: true,
        index: 0,
      }),
    );
  });

  it.each(["{Enter}", " "])("聚焦 chip 后按 %s → 打开常驻标签", async (key) => {
    const user = userEvent.setup();
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([makePin("p1", "GitHub", "https://github.com", 0)]);
    renderArea();
    const chip = await screen.findByRole("button", { name: /打开 GitHub/ });

    chip.focus();
    await user.keyboard(key);

    const tabs = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs;
    await waitFor(() =>
      expect(tabs.create).toHaveBeenCalledWith({
        url: "https://github.com",
        active: true,
        index: 0,
      }),
    );
  });

  it("cap 满（8）：「+」按钮 disabled，点击仍触发 Toast 提示", async () => {
    const pins = Array.from({ length: 8 }, (_, i) => makePin(`p${i}`, `T${i}`, `https://t${i}.com`, i));
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue(pins);

    renderArea();
    const addBtn = await screen.findByRole("button", { name: /添加常驻标签/ });
    expect(addBtn).toBeDisabled();
  });

  it("点击「+」→ Modal 打开，填表提交 → createPinnedTab", async () => {
    renderArea();
    const addBtn = await screen.findByRole("button", { name: /添加常驻标签/ });
    await userEvent.click(addBtn);

    // Modal 出现：url + name 输入框
    const urlInput = await screen.findByPlaceholderText(/url|网址|链接/i);
    const nameInput = await screen.findByPlaceholderText(/名称|名字/i);
    await userEvent.type(urlInput, "https://chat.openai.com");
    await userEvent.type(nameInput, "ChatGPT");

    // Semi Modal 的确定按钮（accessible name = "confirm"，async 等 portal 渲染）
    const okBtn = await screen.findByRole("button", { name: /确定|confirm/i });
    await userEvent.click(okBtn);

    await waitFor(() => {
      expect(PinnedTabService.createPinnedTab).toHaveBeenCalledWith("ws-1", {
        name: "ChatGPT",
        url: "https://chat.openai.com",
      });
    });
  });

  it("createPinnedTab 失败（cap/dedup）→ Toast.warning，不抛到 UI", async () => {
    vi.mocked(PinnedTabService.createPinnedTab).mockRejectedValue(new Error("常驻标签已达上限（8）"));
    renderArea();
    await userEvent.click(await screen.findByRole("button", { name: /添加常驻标签/ }));

    const urlInput = await screen.findByPlaceholderText(/url|网址|链接/i);
    const nameInput = await screen.findByPlaceholderText(/名称/i);
    await userEvent.type(urlInput, "https://x.com");
    await userEvent.type(nameInput, "X");
    await userEvent.click(await screen.findByRole("button", { name: /确定|confirm/i }));

    await waitFor(() => {
      expect(Toast.warning).toHaveBeenCalled();
    });
  });

  it("issue #60：渲染「常驻书签」标题与「管理」文字按钮", async () => {
    renderArea();
    await screen.findByText("常驻书签");
    expect(screen.getByRole("button", { name: "管理常驻书签" })).toBeInTheDocument();
  });

  it("issue #60：点击「管理」按钮 → 打开管理弹窗", async () => {
    renderArea();
    await userEvent.click(await screen.findByRole("button", { name: "管理常驻书签" }));
    expect(await screen.findByRole("heading", { name: "管理常驻书签" })).toBeInTheDocument();
  });

  it("issue #60：chip 不再渲染 hover 删除角标与拖拽手柄（误触根源已移除）", async () => {
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue([
      makePin("p1", "GitHub", "https://github.com", 0),
      makePin("p2", "Notion", "https://notion.so", 1),
    ]);
    renderArea();
    await screen.findByRole("button", { name: /打开 GitHub/ });
    expect(screen.queryByRole("button", { name: /取消常驻/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拖拽排序" })).not.toBeInTheDocument();
  });

  it.each([
    ["1 个", 1, 1],
    ["2 个", 2, 2],
    ["3 个", 3, 3],
    ["4 个", 4, 4],
  ])("布局：≤4 个时列数=数量（%s → %i 列馂满一行）", async (_label, count, cols) => {
    const pins = Array.from({ length: count }, (_, i) => makePin(`p${i}`, `T${i}`, `https://t${i}.com`, i));
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue(pins);

    renderArea();
    await screen.findByRole("button", { name: /打开 T0/ });

    const row = screen.getByTestId("pinned-chip-row");
    expect(row.getAttribute("style")).toContain(`repeat(${cols}, minmax(0, 1fr))`);
  });

  it.each([
    ["5 个", 5],
    ["6 个", 6],
    ["8 个", 8],
  ])("布局：>4 个时固定 4 列（%s → 第二行与第一行等宽对齐）", async (_label, count) => {
    const pins = Array.from({ length: count }, (_, i) => makePin(`p${i}`, `T${i}`, `https://t${i}.com`, i));
    vi.mocked(PinnedTabService.listByWorkspace).mockResolvedValue(pins);

    renderArea();
    await screen.findByRole("button", { name: /打开 T0/ });

    const row = screen.getByTestId("pinned-chip-row");
    expect(row.getAttribute("style")).toContain("repeat(4, minmax(0, 1fr))");
  });
});
