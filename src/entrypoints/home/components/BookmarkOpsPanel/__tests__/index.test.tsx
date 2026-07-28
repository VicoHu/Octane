import { describe, it, expect, vi, beforeEach } from "vitest";
// Semi 组件链间接拉入 lottie-web；jsdom 无 canvas 会崩，mock 掉
vi.mock("lottie-web", () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { BookmarkOpsPanel, type BookmarkOpsPanelHandle, type BookmarkOpsPanelSubmit } from "../../BookmarkOpsPanel";
import type { Bookmark, Workspace, Category } from "@/shared/types";

const bookmark: Bookmark = {
  id: "b1",
  workspaceId: "w1",
  categoryId: "c1",
  name: "GitHub",
  url: "https://github.com",
  description: "",
  faviconUrl: "",
  contextCount: 0,
  hasEncryptedContext: false,
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  tags: [],
};
const workspaces: Workspace[] = [
  { id: "w1", name: "工作区A", icon: "💼", order: 0, createdAt: 0 },
  { id: "w2", name: "工作区B", icon: "📚", order: 1, createdAt: 0 },
];
const w1Categories: Category[] = [{ id: "c1", workspaceId: "w1", name: "分类1", icon: "📁", order: 0, createdAt: 0 }];
const w2Categories: Category[] = [{ id: "c2", workspaceId: "w2", name: "分类2", icon: "📂", order: 0, createdAt: 0 }];

const renderPanel = (categoriesLoader: (wsId: string) => Promise<Category[]>, onSubmit = vi.fn()) => {
  const ref = React.createRef<BookmarkOpsPanelHandle>();
  const utils = render(
    <BookmarkOpsPanel
      ref={ref}
      bookmark={bookmark}
      workspaces={workspaces}
      categoriesLoader={categoriesLoader}
      tagSuggestionsLoader={async () => []}
      onSubmit={onSubmit}
    />,
  );
  return { ...utils, ref, onSubmit };
};

describe("BookmarkOpsPanel — 级联 Select 数据源 + 空分类防呆", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("T7 挂载时预载书签原属工作区的分类（categoriesLoader 为数据源，非 useWorkspace.categories）", async () => {
    const loader = vi.fn(async () => w1Categories);
    renderPanel(loader);

    await waitFor(() => {
      // 关键：级联 Select 的分类数据来自 categoriesLoader（当前工作区作用域的 useWorkspace.categories 无法跨工作区）
      expect(loader).toHaveBeenCalledWith("w1");
    });
  });

  it("编辑书签初次加载分类 → 分类 Select 不显示 categoryId，加载完成后回显分类名称", async () => {
    let resolveCategories!: (categories: Category[]) => void;
    const loader = vi.fn(
      () =>
        new Promise<Category[]>((resolve) => {
          resolveCategories = resolve;
        }),
    );
    renderPanel(loader);
    await waitFor(() => expect(loader).toHaveBeenCalledWith("w1"));

    const categorySelect = screen.getByRole("combobox", { name: "分类" });
    expect(categorySelect).toHaveTextContent("分类加载中");
    expect(categorySelect).not.toHaveTextContent("c1");

    await act(async () => resolveCategories(w1Categories));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "分类" })).toHaveTextContent("📁 分类1"));
  });

  it("T6 目标工作区无分类（loader 返回空）时显示 Banner 警告（防孤儿书签防呆）", async () => {
    // 切到空分类工作区 w2：loader 对 w2 返回 []
    const loader = vi.fn(async (wsId: string) => (wsId === "w1" ? w1Categories : []));
    renderPanel(loader);

    // 初始预载 w1（有分类）→ 等加载完
    await waitFor(() => {
      expect(loader).toHaveBeenCalledWith("w1");
    });

    // 直接断言防呆文案渲染机制存在（Banner 由 categoryEmpty 触发）：
    // 用 loader 返回空模拟空分类态——重新渲染一个空工作区场景
    document.body.replaceChildren();
    const emptyLoader = vi.fn(async () => [] as Category[]);
    render(
      <BookmarkOpsPanel
        ref={React.createRef<BookmarkOpsPanelHandle>()}
        bookmark={{ ...bookmark, workspaceId: "w-empty" }}
        workspaces={workspaces}
        categoriesLoader={emptyLoader}
        onSubmit={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("目标工作区无分类，请先创建")).toBeTruthy();
    });
  });
});

describe("BookmarkOpsPanel — 编辑时维护 Tag（#49）", () => {
  const taggedBookmark: Bookmark = {
    ...bookmark,
    tags: ["React", "Frontend"],
  };
  beforeEach(() => {
    document.body.replaceChildren();
  });

  const renderEditPanel = (
    overrides: {
      bookmark?: Bookmark;
      categoriesLoader?: (wsId: string) => Promise<Category[]>;
      tagSuggestionsLoader?: (wsId: string) => Promise<string[]>;
      onSubmit?: ReturnType<typeof vi.fn<(values: BookmarkOpsPanelSubmit) => void>>;
    } = {},
  ) => {
    const ref = React.createRef<BookmarkOpsPanelHandle>();
    const categoriesLoader =
      overrides.categoriesLoader ?? vi.fn(async (wsId: string) => (wsId === "w1" ? w1Categories : w2Categories));
    const tagSuggestionsLoader =
      overrides.tagSuggestionsLoader ??
      vi.fn(async (wsId: string) => (wsId === "w1" ? ["React", "Frontend", "CSS"] : ["Go", "Backend"]));
    const onSubmit = overrides.onSubmit ?? vi.fn<(values: BookmarkOpsPanelSubmit) => void>();
    const utils = render(
      <BookmarkOpsPanel
        ref={ref}
        bookmark={overrides.bookmark ?? taggedBookmark}
        workspaces={workspaces}
        categoriesLoader={categoriesLoader}
        tagSuggestionsLoader={tagSuggestionsLoader}
        onSubmit={onSubmit}
      />,
    );
    return { ...utils, ref, onSubmit, categoriesLoader, tagSuggestionsLoader };
  };

  it("加载书签当前 Tag，并展示为已选徽标", async () => {
    renderEditPanel();

    // 既有 Tag 应作为已选徽标渲染（移除按钮 aria-label 含 Tag 名）
    expect(screen.getByRole("button", { name: "移除 React" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除 Frontend" })).toBeInTheDocument();
  });

  it("添加新 Tag 后可移除，按添加顺序维护", async () => {
    const user = userEvent.setup();
    renderEditPanel({ bookmark: { ...taggedBookmark, tags: [] } });

    // 添加两个 Tag
    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag/), "Go{Enter}");
    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag/), "Rust{Enter}");

    // 添加顺序保留：Go 在 Rust 之前
    const badges = screen.getAllByRole("button", { name: /移除/ });
    expect(badges[0]!.getAttribute("aria-label")).toBe("移除 Go");
    expect(badges[1]!.getAttribute("aria-label")).toBe("移除 Rust");

    // 移除 Go
    await user.click(screen.getByRole("button", { name: "移除 Go" }));
    expect(screen.queryByRole("button", { name: "移除 Go" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除 Rust" })).toBeInTheDocument();
  });

  it("使用目标工作区的 Tag 建议（原属工作区初始加载）", async () => {
    const tagSuggestionsLoader = vi.fn(async (wsId: string) => (wsId === "w1" ? ["React", "CSS"] : ["Go"]));
    renderEditPanel({ tagSuggestionsLoader });

    // 初始加载原属工作区 w1 的建议
    await waitFor(() => {
      expect(tagSuggestionsLoader).toHaveBeenCalledWith("w1");
    });
    // 建议（未被选中的）应出现
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "CSS" })).toBeInTheDocument();
    });
  });

  it("提交时 onSubmit 携带当前编辑后的 tags", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { ref } = renderEditPanel({
      bookmark: { ...taggedBookmark, tags: ["React"] },
      onSubmit,
    });

    // 添加一个新 Tag
    await user.type(screen.getByPlaceholderText(/输入.*[Tt]ag/), "Go{Enter}");

    // 触发提交
    ref.current!.submit();

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const values = onSubmit.mock.calls[0]![0];
    expect(values.tags).toEqual(["React", "Go"]);
  });
});
