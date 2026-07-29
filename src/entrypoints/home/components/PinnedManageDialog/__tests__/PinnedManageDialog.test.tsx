import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import type { ReactNode } from "react";

// 副作用边界 mock（testing.md §2 原则 3）：
// - PinnedTabService：IndexedDB 读写层，store 业务逻辑真实跑，只隔掉 DB
// - dnd-kit/core：pointer 序列 + 碰撞检测在 jsdom 不可控（已实测 reorder 不触发），
//   换成直接调 onDragEnd 的薄壳，测「算序列 + 调 store」接线（项目允许的副作用边界）
vi.mock("@/services/PinnedTabService", () => ({
  listByWorkspace: vi.fn(async () => []),
  deletePinnedTab: vi.fn(async () => {}),
  reorderPinnedTabs: vi.fn(async () => {}),
  createPinnedTab: vi.fn(),
  PINNED_TAB_CAP: 8,
}));
vi.mock("@dnd-kit/core", async (importActual) => {
  const actual = await importActual<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    // 薄壳：渲染 children，不跑 sensor/碰撞，把 onDragEnd 暴露给测试直接调。
    // 用 useEffect 捕获（绑定 commit/unmount 生命周期，避免 render 期间赋值的副作用反模式）
    DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: (e: unknown) => void }) => {
      useEffect(() => {
        lastDragEnd = onDragEnd;
        return () => {
          lastDragEnd = null;
        };
      }, [onDragEnd]);
      return <>{children}</>;
    },
  };
});

import { PinnedManageDialog } from "../index";
import { usePinnedTabs } from "@/store/usePinnedTabs";
import * as PinnedTabService from "@/services/PinnedTabService";
import type { PinnedTab } from "@/shared/types";

// 测试通过此句柄直接驱动 DndContext 的 onDragEnd（绕过 jsdom 不可控的 pointer 序列）
let lastDragEnd: ((e: unknown) => void) | null = null;

function seedPinnedTabs(tabs: PinnedTab[]) {
  usePinnedTabs.setState({ pinnedTabs: tabs });
}

function makePin(overrides: Partial<PinnedTab> = {}): PinnedTab {
  return {
    id: "pin-1",
    workspaceId: "ws-1",
    name: "GitHub",
    url: "https://github.com",
    order: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("PinnedManageDialog — 常驻书签管理弹窗", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastDragEnd = null;
    seedPinnedTabs([]);
  });

  it("open=false 时不渲染弹窗", () => {
    render(<PinnedManageDialog open={false} onOpenChange={vi.fn()} workspaceId="ws-1" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("open 时渲染标题与每个常驻项的名字", () => {
    seedPinnedTabs([
      makePin({ id: "pin-1", name: "GitHub", order: 0 }),
      makePin({ id: "pin-2", name: "Notion", order: 1 }),
    ]);

    render(<PinnedManageDialog open onOpenChange={vi.fn()} workspaceId="ws-1" />);

    expect(screen.getByText("管理常驻书签")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Notion")).toBeInTheDocument();
  });

  it("点击某项删除按钮 → 该项从列表消失", async () => {
    const user = userEvent.setup();
    seedPinnedTabs([
      makePin({ id: "pin-1", name: "GitHub", order: 0 }),
      makePin({ id: "pin-2", name: "Notion", order: 1 }),
    ]);

    render(<PinnedManageDialog open onOpenChange={vi.fn()} workspaceId="ws-1" />);

    const deleteBtn = screen.getByRole("button", { name: "取消常驻 GitHub" });
    await user.click(deleteBtn);

    // store.deletePinnedTab 调用 service（mock）后过滤切片，GitHub 消失
    expect(PinnedTabService.deletePinnedTab).toHaveBeenCalledWith("pin-1");
    await waitFor(() => expect(screen.queryByText("GitHub")).not.toBeInTheDocument());
    // Notion 仍在
    expect(screen.getByText("Notion")).toBeInTheDocument();
  });

  it("空列表时显示空提示", () => {
    render(<PinnedManageDialog open onOpenChange={vi.fn()} workspaceId="ws-1" />);

    expect(screen.getByText(/暂无常驻书签/)).toBeInTheDocument();
  });

  it("每项渲染拖拽手柄（常显 grip，排序能力收敛至此）", () => {
    seedPinnedTabs([
      makePin({ id: "pin-1", name: "GitHub", order: 0 }),
      makePin({ id: "pin-2", name: "Notion", order: 1 }),
    ]);

    render(<PinnedManageDialog open onOpenChange={vi.fn()} workspaceId="ws-1" />);

    // seam：grip 手柄存在（排序能力收敛至此）。
    // 排序的 id 序列计算由 computeReorderIds 纯函数测试覆盖（order.test.ts）；
    // drag-end → store 接线由下方「拖拽接线」测试组覆盖（mock DndContext 直接驱动 onDragEnd）。
    const grips = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-roledescription") === "可拖拽项");
    expect(grips).toHaveLength(2);
  });
});

describe("PinnedManageDialog — 拖拽接线（mock DndContext 直接驱动 onDragEnd）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastDragEnd = null;
  });

  // render 后等 onDragEnd 句柄就绪（useEffect commit 后赋值），再驱动 drag-end
  async function fireDragEnd(e: unknown) {
    await waitFor(() => expect(lastDragEnd).not.toBeNull());
    await act(async () => {
      lastDragEnd!(e);
    });
  }

  it("有效 drop → reorderPinnedTabs 收到正确 workspaceId 与重排后的 id 序列", async () => {
    seedPinnedTabs([
      makePin({ id: "pin-1", name: "GitHub", order: 0 }),
      makePin({ id: "pin-2", name: "Notion", order: 1 }),
      makePin({ id: "pin-3", name: "Linear", order: 2 }),
    ]);
    render(<PinnedManageDialog open onOpenChange={vi.fn()} workspaceId="ws-99" />);

    // pin-1 拖到 pin-3 位置 → [pin-2, pin-3, pin-1]
    await fireDragEnd({ active: { id: "pin-1" }, over: { id: "pin-3" } });

    expect(PinnedTabService.reorderPinnedTabs).toHaveBeenCalledWith("ws-99", ["pin-2", "pin-3", "pin-1"]);
  });

  it("同位 drop（active===over）→ 不调 reorderPinnedTabs", async () => {
    seedPinnedTabs([
      makePin({ id: "pin-1", name: "GitHub", order: 0 }),
      makePin({ id: "pin-2", name: "Notion", order: 1 }),
    ]);
    render(<PinnedManageDialog open onOpenChange={vi.fn()} workspaceId="ws-1" />);

    await fireDragEnd({ active: { id: "pin-1" }, over: { id: "pin-1" } });

    expect(PinnedTabService.reorderPinnedTabs).not.toHaveBeenCalled();
  });

  it("非法落区（over=null）→ 不调 reorderPinnedTabs", async () => {
    seedPinnedTabs([
      makePin({ id: "pin-1", name: "GitHub", order: 0 }),
      makePin({ id: "pin-2", name: "Notion", order: 1 }),
    ]);
    render(<PinnedManageDialog open onOpenChange={vi.fn()} workspaceId="ws-1" />);

    await fireDragEnd({ active: { id: "pin-1" }, over: null });

    expect(PinnedTabService.reorderPinnedTabs).not.toHaveBeenCalled();
  });

  it("rerender 换 workspaceId 后，handler 跟随新 workspace（证明非陈旧句柄）", async () => {
    seedPinnedTabs([
      makePin({ id: "pin-1", name: "GitHub", order: 0 }),
      makePin({ id: "pin-2", name: "Notion", order: 1 }),
    ]);
    const { rerender } = render(<PinnedManageDialog open onOpenChange={vi.fn()} workspaceId="ws-1" />);

    rerender(<PinnedManageDialog open onOpenChange={vi.fn()} workspaceId="ws-77" />);
    await fireDragEnd({ active: { id: "pin-1" }, over: { id: "pin-2" } });

    expect(PinnedTabService.reorderPinnedTabs).toHaveBeenCalledWith("ws-77", ["pin-2", "pin-1"]);
  });
});
