import { describe, it, expect } from "vitest";
import { computeReorderIds } from "../order";
import type { PinnedTab } from "@/shared/types";

const makePin = (id: string, order: number): PinnedTab => ({
  id,
  workspaceId: "ws-1",
  name: id,
  url: `https://${id}.com`,
  order,
  createdAt: 0,
});

describe("computeReorderIds — 拖拽重排 id 序列计算", () => {
  it("把 active 拖到 over 位置：返回重排后的 id 序列", () => {
    const tabs = [makePin("a", 0), makePin("b", 1), makePin("c", 2)];

    // a 拖到 c 的位置 → [b, c, a]
    expect(computeReorderIds(tabs, "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("向后拖（c 拖到 a 位置）：返回重排后的 id 序列", () => {
    const tabs = [makePin("a", 0), makePin("b", 1), makePin("c", 2)];

    expect(computeReorderIds(tabs, "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("相邻交换（a↔b）", () => {
    const tabs = [makePin("a", 0), makePin("b", 1)];

    expect(computeReorderIds(tabs, "a", "b")).toEqual(["b", "a"]);
    expect(computeReorderIds(tabs, "b", "a")).toEqual(["b", "a"]);
  });

  it("active 与 over 相同 → null（同位，无需重排）", () => {
    const tabs = [makePin("a", 0), makePin("b", 1)];

    expect(computeReorderIds(tabs, "a", "a")).toBeNull();
  });

  it("over 不在列表中（非法落区）→ null", () => {
    const tabs = [makePin("a", 0), makePin("b", 1)];

    expect(computeReorderIds(tabs, "a", "zzz")).toBeNull();
  });

  it("active 不在列表中 → null", () => {
    const tabs = [makePin("a", 0), makePin("b", 1)];

    expect(computeReorderIds(tabs, "zzz", "a")).toBeNull();
  });
});
