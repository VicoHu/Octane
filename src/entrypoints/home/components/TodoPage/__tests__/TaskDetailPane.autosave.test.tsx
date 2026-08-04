import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({ loadNavigation: vi.fn(), queryTasks: vi.fn(), getTaskDetail: vi.fn() }));
const taskService = vi.hoisted(() => ({ patchTask: vi.fn() }));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
const preferences = vi.hoisted(() => ({ loadTodoUiPreferences: vi.fn(), saveDetailSplitPercent: vi.fn() }));
const panelGroupRef = vi.hoisted(() => ({
  current: null as null | { setLayout: (layout: Record<string, number>) => Record<string, number> },
}));
vi.mock("@/services/TodoQueryService", () => query);
vi.mock("@/services/TaskService", () => taskService);
vi.mock("@/components/ui/toast", () => ({ Toast: toast }));
vi.mock("@/shared/todoUiPreferences", () => preferences);
vi.mock("@/components/ui/resizable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/resizable")>();
  return { ...actual, useResizablePanelGroupRef: () => panelGroupRef };
});

import { TaskDetailPane, type TaskDetailPaneHandle } from "../TaskDetailPane";
import { TodoPage, type TodoLeaveGuard } from "..";
import { useTodoData } from "@/store/useTodoData";
import { useTodoView } from "@/store/useTodoView";
import { useWorkspace } from "@/store/useWorkspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const task = {
  id: "t1",
  workspaceId: "w1",
  listId: null,
  containerKey: '["w1",null]',
  title: "原始标题",
  description: "",
  priority: "none" as const,
  dueDate: null,
  status: "active" as const,
  order: 0,
  completedAt: null,
  deletedAt: null,
  createdAt: 1,
  updatedAt: 1,
};
const workspace = { id: "w1", name: "工作", icon: "Briefcase", order: 0, createdAt: 1 };
const detail = { task, workspace, taskList: null, taskTags: [], checklistItems: [] } as never;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  useTodoData.getState().reset();
  useTodoView.getState().reset();
  vi.clearAllMocks();
  panelGroupRef.current = null;
  preferences.loadTodoUiPreferences.mockResolvedValue({ detailSplitPercent: null, sortOverrides: {} });
  if (!window.matchMedia)
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  if (!Element.prototype.getAnimations)
    Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  useWorkspace.setState({ workspaces: [workspace], currentWorkspaceId: "w1" });
  useTodoView.setState({ selectedTaskId: "t1" });
  useTodoData.setState({ detail });
  query.getTaskDetail.mockResolvedValue(detail);
  query.loadNavigation.mockResolvedValue({ groups: [], counts: {} });
  taskService.patchTask.mockResolvedValue(task);
});

afterEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

describe("TaskDetailPane 草稿保护", () => {
  it("保存中的最新 revision 会通过真实 TaskService 串行提交", async () => {
    const user = userEvent.setup();
    const pending = deferred<typeof task>();
    taskService.patchTask.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(task);
    const ref = { current: null as TaskDetailPaneHandle | null };
    render(<TaskDetailPane ref={ref} mobile={false} onBack={vi.fn()} />);
    const title = screen.getByLabelText("标题");
    await user.clear(title);
    await user.type(title, "第一版");
    const save = ref.current!.commitDraft();
    await user.type(title, "最终版");
    pending.resolve(task);
    await expect(save).resolves.toBe(true);
    expect(taskService.patchTask).toHaveBeenNthCalledWith(1, "t1", { title: "第一版", description: "" });
    expect(taskService.patchTask).toHaveBeenNthCalledWith(2, "t1", { title: "第一版最终版", description: "" });
  });

  it("空标题保存失败后输入合法标题仍可经失焦保存", async () => {
    const user = userEvent.setup();
    render(<TaskDetailPane mobile={false} onBack={vi.fn()} />);
    const title = screen.getByLabelText("标题");
    await user.clear(title);
    await user.tab();
    expect(await screen.findByText("标题不能为空")).toBeInTheDocument();
    await user.type(title, "恢复可保存");
    await user.tab();
    await waitFor(() =>
      expect(taskService.patchTask).toHaveBeenCalledWith("t1", { title: "恢复可保存", description: "" }),
    );
  });

  it("快速成功和 Ctrl+Enter 不显示 Spinner", async () => {
    const user = userEvent.setup();
    render(<TaskDetailPane mobile={false} onBack={vi.fn()} />);
    const title = screen.getByLabelText("标题");
    await user.clear(title);
    await user.type(title, "快捷保存");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() =>
      expect(taskService.patchTask).toHaveBeenCalledWith("t1", { title: "快捷保存", description: "" }),
    );
    expect(screen.queryByRole("status", { name: "保存中" })).not.toBeInTheDocument();
  });

  it("切换 view 在保存失败时保持原 view", async () => {
    const user = userEvent.setup();
    taskService.patchTask.mockRejectedValue(new Error("写入失败"));
    useTodoView.setState({ view: { kind: "inbox" } });
    useTodoData.setState({
      navigation: {
        groups: [],
        counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: {} },
      } as never,
    });
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "未保存");
    await user.click(screen.getByRole("button", { name: "今天" }));
    expect(await screen.findByText("未保存的修改")).toBeInTheDocument();
    expect(useTodoView.getState().view).toEqual({ kind: "inbox" });
  });

  it("切换 scope 在保存失败时保持 current", async () => {
    const user = userEvent.setup();
    taskService.patchTask.mockRejectedValue(new Error("写入失败"));
    useTodoData.setState({
      navigation: {
        groups: [],
        counts: { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: {} },
      } as never,
    });
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "未保存");
    await user.click(screen.getByRole("button", { name: "所有工作区" }));
    expect(await screen.findByText("未保存的修改")).toBeInTheDocument();
    expect(useTodoView.getState().scopeMode).toBe("current");
  });

  it("桌面关闭详情在保存失败时被阻断", async () => {
    const user = userEvent.setup();
    taskService.patchTask.mockRejectedValue(new Error("写入失败"));
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "未保存");
    await user.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(await screen.findByText("未保存的修改")).toBeInTheDocument();
    expect(useTodoView.getState().selectedTaskId).toBe("t1");
    await user.click(screen.getByRole("button", { name: "留在当前待办" }));
  });

  it("选择另一 Task 时保存失败保持原选择，放弃后才切换", async () => {
    const user = userEvent.setup();
    taskService.patchTask.mockRejectedValue(new Error("写入失败"));
    const next = { ...task, id: "t2", title: "下一条" };
    const rows = {
      active: [
        {
          id: "t1",
          task,
          workspace,
          taskList: null,
          listName: "收集箱",
          taskTags: [],
          hiddenTagCount: 0,
          checklistCompletedCount: 0,
          checklistTotalCount: 0,
          searchMatch: null,
        },
        {
          id: "t2",
          task: next,
          workspace,
          taskList: null,
          listName: "收集箱",
          taskTags: [],
          hiddenTagCount: 0,
          checklistCompletedCount: 0,
          checklistTotalCount: 0,
          searchMatch: null,
        },
      ],
      completed: [],
      total: 2,
      effectiveSort: "manual",
    } as never;
    useTodoData.setState({ queryResult: rows });
    query.queryTasks.mockResolvedValue(rows);
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "未保存");
    await user.click(screen.getByRole("button", { name: "下一条" }));
    expect(await screen.findByText("未保存的修改")).toBeInTheDocument();
    expect(useTodoView.getState().selectedTaskId).toBe("t1");
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(useTodoView.getState().selectedTaskId).toBe("t2"));
  });

  it("移动端返回保存失败时保留详情，放弃后才回列表", async () => {
    const user = userEvent.setup();
    taskService.patchTask.mockRejectedValue(new Error("写入失败"));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (value: string) => ({
        matches: value === "(max-width: 760px)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    useTodoView.setState({ mobileDetailOpen: true });
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "未保存");
    await user.click(screen.getByRole("button", { name: "返回列表" }));
    expect(await screen.findByText("未保存的修改")).toBeInTheDocument();
    expect(useTodoView.getState().mobileDetailOpen).toBe(true);
    expect(screen.getByLabelText("标题")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() => expect(useTodoView.getState().mobileDetailOpen).toBe(false));
  });

  it("注册给 App 的离开 gate 在失败时阻止动作，放弃后继续", async () => {
    const user = userEvent.setup();
    taskService.patchTask.mockRejectedValue(new Error("写入失败"));
    const leave = vi.fn();
    let guard: TodoLeaveGuard | null = null;
    render(
      <TodoPage
        active
        activePage="tasks"
        onNavigate={vi.fn()}
        onRegisterLeaveGuard={(next) => {
          guard = next;
        }}
      />,
    );
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "阻止离开");
    await guard!(leave);
    expect(leave).not.toHaveBeenCalled();
    expect(await screen.findByText("未保存的修改")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(leave).toHaveBeenCalledOnce();
  });

  it("收到外部失效后重读当前详情，已不存在的任务会清除选择", async () => {
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await waitFor(() => expect(query.getTaskDetail).toHaveBeenCalledWith("t1"));
    query.getTaskDetail.mockClear();
    query.getTaskDetail.mockResolvedValue(null);

    act(() => useTodoData.getState().invalidate());

    await waitFor(() => expect(query.getTaskDetail).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(useTodoView.getState().selectedTaskId).toBeNull());
  });

  it("连续失效时旧轮 null 详情不会清除新轮仍有效的选择", async () => {
    const oldDetail = deferred<typeof detail | null>();
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await waitFor(() => expect(query.getTaskDetail).toHaveBeenCalledWith("t1"));
    query.getTaskDetail.mockReset();
    query.getTaskDetail.mockReturnValueOnce(oldDetail.promise).mockResolvedValueOnce(detail);

    act(() => useTodoData.getState().invalidate());
    await waitFor(() => expect(query.getTaskDetail).toHaveBeenCalledTimes(1));
    act(() => useTodoData.getState().invalidate());
    await waitFor(() => expect(query.getTaskDetail).toHaveBeenCalledTimes(2));

    await act(async () => {
      oldDetail.resolve(null);
      await oldDetail.promise;
    });

    expect(useTodoView.getState().selectedTaskId).toBe("t1");
  });

  it("外部删除当前清单后回退到今天并重新查询", async () => {
    const counts = { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: { l1: 0 }, tag: {} };
    const activeList = {
      id: "l1",
      workspaceId: "w1",
      name: "发布",
      normalizedName: "发布",
      color: "green",
      order: 0,
      archivedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const navigationWithList = {
      groups: [{ workspace, taskLists: [activeList], taskTags: [], counts }],
      counts,
    } as never;
    const navigationWithoutList = {
      groups: [{ workspace, taskLists: [], taskTags: [], counts: { ...counts, list: {} } }],
      counts: { ...counts, list: {} },
    } as never;
    useTodoView.setState({ view: { kind: "list", listId: "l1" } });
    query.loadNavigation.mockReset();
    query.loadNavigation.mockResolvedValueOnce(navigationWithList).mockResolvedValueOnce(navigationWithoutList);
    query.queryTasks.mockResolvedValue({ active: [], completed: [], total: 0, effectiveSort: "manual" });

    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await waitFor(() => expect(query.loadNavigation).toHaveBeenCalledTimes(1));
    act(() => useTodoData.getState().invalidate());

    await waitFor(() => expect(useTodoView.getState().view).toEqual({ kind: "today" }));
    await waitFor(() =>
      expect(query.queryTasks).toHaveBeenLastCalledWith(expect.objectContaining({ view: { kind: "today" } })),
    );
  });

  it("外部删除当前归档清单后回退到今天并重新查询", async () => {
    const counts = { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 1, list: {}, tag: {} };
    const archivedList = {
      id: "l1",
      workspaceId: "w1",
      name: "归档",
      normalizedName: "归档",
      color: "gray",
      order: 0,
      archivedAt: 2,
      createdAt: 1,
      updatedAt: 2,
    };
    const navigationWithList = {
      groups: [{ workspace, taskLists: [archivedList], taskTags: [], counts }],
      counts,
    } as never;
    const navigationWithoutList = {
      groups: [{ workspace, taskLists: [], taskTags: [], counts: { ...counts, archivedLists: 0 } }],
      counts: { ...counts, archivedLists: 0 },
    } as never;
    useTodoView.setState({ view: { kind: "archivedList", listId: "l1" } });
    query.loadNavigation.mockReset();
    query.loadNavigation.mockResolvedValueOnce(navigationWithList).mockResolvedValueOnce(navigationWithoutList);
    query.queryTasks.mockResolvedValue({ active: [], completed: [], total: 0, effectiveSort: "manual" });

    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await waitFor(() => expect(query.loadNavigation).toHaveBeenCalledTimes(1));
    act(() => useTodoData.getState().invalidate());

    await waitFor(() => expect(useTodoView.getState().view).toEqual({ kind: "today" }));
    await waitFor(() =>
      expect(query.queryTasks).toHaveBeenLastCalledWith(expect.objectContaining({ view: { kind: "today" } })),
    );
  });

  it("外部删除当前任务标签后回退到今天并重新查询", async () => {
    const counts = { today: 0, next7: 0, inbox: 0, trash: 0, archivedLists: 0, list: {}, tag: { tag1: 0 } };
    const tag = {
      id: "tag1",
      workspaceId: "w1",
      name: "重要",
      normalizedName: "重要",
      color: "red",
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const navigationWithTag = { groups: [{ workspace, taskLists: [], taskTags: [tag], counts }], counts } as never;
    const navigationWithoutTag = {
      groups: [{ workspace, taskLists: [], taskTags: [], counts: { ...counts, tag: {} } }],
      counts: { ...counts, tag: {} },
    } as never;
    useTodoView.setState({ view: { kind: "tag", tagId: "tag1" } });
    query.loadNavigation.mockReset();
    query.loadNavigation.mockResolvedValueOnce(navigationWithTag).mockResolvedValueOnce(navigationWithoutTag);
    query.queryTasks.mockResolvedValue({ active: [], completed: [], total: 0, effectiveSort: "manual" });

    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await waitFor(() => expect(query.loadNavigation).toHaveBeenCalledTimes(1));
    act(() => useTodoData.getState().invalidate());

    await waitFor(() => expect(useTodoView.getState().view).toEqual({ kind: "today" }));
    await waitFor(() =>
      expect(query.queryTasks).toHaveBeenLastCalledWith(expect.objectContaining({ view: { kind: "today" } })),
    );
  });

  it("切回非激活页面后移除移动端全局触控态", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(max-width: 760px)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    const { rerender } = render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    expect(screen.getByRole("region", { name: "待办事项" })).toHaveAttribute("data-todo-mobile", "true");

    rerender(<TodoPage active={false} activePage="home" onNavigate={vi.fn()} />);

    expect(screen.getByRole("region", { name: "待办事项" })).not.toHaveAttribute("data-todo-mobile");
  });

  it("异步恢复分栏比例后不重挂载详情，并回写实际夹紧比例", async () => {
    const savedSplit = deferred<{ detailSplitPercent: number | null; sortOverrides: Record<string, never> }>();
    preferences.loadTodoUiPreferences.mockReturnValue(savedSplit.promise);
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("标题")).toHaveValue("原始标题"));
    const draftInput = screen.getByLabelText("标题");
    const setLayout = vi.fn().mockReturnValue({ "task-list": 60, "task-detail": 40 });
    panelGroupRef.current = { setLayout };

    await act(async () => {
      savedSplit.resolve({ detailSplitPercent: 65, sortOverrides: {} });
      await savedSplit.promise;
    });

    expect(setLayout).toHaveBeenCalledWith({ "task-list": 65, "task-detail": 35 });
    expect(useTodoView.getState().detailSplitPercent).toBe(60);
    expect(preferences.saveDetailSplitPercent).not.toHaveBeenCalled();
    expect(screen.getByLabelText("标题")).toBe(draftInput);
  });

  it("桌面断点变化会重新应用当前比例并回写夹紧结果", async () => {
    const listeners = new Map<string, Set<() => void>>();
    const matches = new Map<string, boolean>([
      ["(max-width: 760px)", false],
      ["(min-width: 1200px)", false],
    ]);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        get matches() {
          return matches.get(query) ?? false;
        },
        addEventListener: (_type: string, listener: () => void) => {
          const registered = listeners.get(query) ?? new Set();
          registered.add(listener);
          listeners.set(query, registered);
        },
        removeEventListener: (_type: string, listener: () => void) => listeners.get(query)?.delete(listener),
      }),
    });
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await waitFor(() => expect(panelGroupRef.current).not.toBeNull());
    const setLayout = vi.fn().mockReturnValue({ "task-list": 58, "task-detail": 42 });
    panelGroupRef.current = { setLayout };

    act(() => {
      matches.set("(min-width: 1200px)", true);
      listeners.get("(min-width: 1200px)")?.forEach((listener) => listener());
    });

    await waitFor(() => expect(setLayout).toHaveBeenCalledWith({ "task-list": 50, "task-detail": 50 }));
    expect(useTodoView.getState().detailSplitPercent).toBe(58);
  });

  it("双击分隔线重置 50:50，并持久化 Group 返回的实际比例", async () => {
    const user = userEvent.setup();
    render(<TodoPage active activePage="tasks" onNavigate={vi.fn()} />);
    await waitFor(() => expect(panelGroupRef.current).not.toBeNull());
    const setLayout = vi.fn().mockReturnValue({ "task-list": 52, "task-detail": 48 });
    panelGroupRef.current = { setLayout };

    await user.dblClick(screen.getByRole("separator"));

    expect(setLayout).toHaveBeenCalledWith({ "task-list": 50, "task-detail": 50 });
    expect(useTodoView.getState().detailSplitPercent).toBe(52);
    expect(preferences.saveDetailSplitPercent).toHaveBeenCalledWith(52);
  });
});
