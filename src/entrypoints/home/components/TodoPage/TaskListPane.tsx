/* eslint-disable react-hooks/refs */
import { useEffect, useState, type ComponentProps } from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownAZ, ChevronDown, ListFilter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Toast } from "@/components/ui/toast";
import { isTaskDragEnabled } from "@/shared/tasks/taskRules";
import { useTodoData } from "@/store/useTodoData";
import { useTodoView } from "@/store/useTodoView";
import { useWorkspace } from "@/store/useWorkspace";
import type { TaskRow as TaskRowData } from "@/services/TodoQueryService";
import type { Task } from "@/shared/types";
import { QuickAddTask } from "./QuickAddTask";
import { TaskRow } from "./TaskRow";
import { TodoNavigationTrigger } from "./TodoNavigation";
import { useLocalToday } from "../../hooks/useLocalToday";
import styles from "./index.module.css";

function titleForView(view: ReturnType<typeof useTodoView.getState>["view"], rows: TaskRowData[]): string {
  if (view.kind === "today") return "今天";
  if (view.kind === "next7") return "未来 7 天";
  if (view.kind === "inbox") return "收集箱";
  if (view.kind === "trash") return "废纸篓";
  return (
    rows[0]?.taskList?.name ??
    (view.kind === "tag" ? rows[0]?.taskTags.find((tag) => tag.id === view.tagId)?.name ?? "标签" : "已归档清单")
  );
}

function SortableTaskRow({
  row,
  enabled,
  ...props
}: { row: TaskRowData; enabled: boolean } & Omit<ComponentProps<typeof TaskRow>, "row">) {
  const sortable = useSortable({ id: row.id, disabled: !enabled });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      {...(enabled ? { ...sortable.attributes, ...sortable.listeners } : {})}
    >
      <TaskRow row={row} {...props} />
    </div>
  );
}

export function TaskListPane({
  onOpenNavigation,
  onTaskSelect,
  onBeforeTaskDelete,
}: {
  onOpenNavigation: () => void;
  onTaskSelect?: (taskId: string) => void | Promise<void>;
  onBeforeTaskDelete?: (taskId: string) => Promise<boolean>;
}) {
  const queryResult = useTodoData((state) => state.queryResult);
  const navigation = useTodoData((state) => state.navigation);
  const setTaskCompletion = useTodoData((state) => state.setTaskCompletion);
  const softDeleteTask = useTodoData((state) => state.softDeleteTask);
  const restoreTask = useTodoData((state) => state.restoreTask);
  const reorderTasks = useTodoData((state) => state.reorderTasks);
  const scopeMode = useTodoView((state) => state.scopeMode);
  const view = useTodoView((state) => state.view);
  const selectedTaskId = useTodoView((state) => state.selectedTaskId);
  const statusFilter = useTodoView((state) => state.statusFilter);
  const priorityFilter = useTodoView((state) => state.priorityFilter);
  const searchQuery = useTodoView((state) => state.searchQuery);
  const sortMode = useTodoView((state) => state.sortMode);
  const setStatusFilter = useTodoView((state) => state.setStatusFilter);
  const setPriorityFilter = useTodoView((state) => state.setPriorityFilter);
  const setSearchQuery = useTodoView((state) => state.setSearchQuery);
  const setSortMode = useTodoView((state) => state.setSortMode);
  const selectTask = useTodoView((state) => state.selectTask);
  const setMobileDetailOpen = useTodoView((state) => state.setMobileDetailOpen);
  const workspaces = useWorkspace((state) => state.workspaces);
  const currentWorkspaceId = useWorkspace((state) => state.currentWorkspaceId);
  const today = useLocalToday();
  const [completedOpen, setCompletedOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [pendingCompletion, setPendingCompletion] = useState<{ task: Task; incompleteChecklistCount: number } | null>(
    null,
  );
  // hiddenIds 是针对当前列表的乐观隐藏（完成/删除 + 撤销 Toast）；
  // 列表上下文一变，新查询已含最新写入，过期的隐藏集合应清空，否则切到废纸篓也看不到刚删的任务。
  useEffect(() => {
    setHiddenIds(new Set());
  }, [scopeMode, view, statusFilter, priorityFilter, searchQuery, sortMode]);
  const active = (queryResult?.active ?? []).filter((row) => !hiddenIds.has(row.id));
  const completed = (queryResult?.completed ?? []).filter((row) => !hiddenIds.has(row.id));
  const rows = [...active, ...completed];
  const fixedStatus = view.kind === "today" || view.kind === "next7" || view.kind === "trash";
  const canQuickAdd =
    searchQuery.trim() === "" && statusFilter !== "completed" && view.kind !== "trash" && view.kind !== "archivedList";
  const dragEnabled = isTaskDragEnabled({
    workspaceCount: scopeMode === "current" ? 1 : navigation?.groups.length ?? 0,
    containerCount: view.kind === "inbox" || view.kind === "list" ? 1 : 0,
    sort: sortMode,
    search: searchQuery,
    statusFilter,
    priorityFilter,
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const containerWorkspaceId =
    view.kind === "list"
      ? navigation?.groups.flatMap((group) => group.taskLists).find((list) => list.id === view.listId)?.workspaceId
      : undefined;
  const tagWorkspaceId =
    view.kind === "tag"
      ? navigation?.groups.flatMap((group) => group.taskTags).find((tag) => tag.id === view.tagId)?.workspaceId
      : undefined;
  const select = (taskId: string) => {
    if (onTaskSelect) {
      void onTaskSelect(taskId);
      return;
    }
    selectTask(taskId);
    setMobileDetailOpen(true);
  };
  const applyCompletion = (task: Task, checked: boolean) => {
    if (checked && statusFilter === "active") setHiddenIds((ids) => new Set(ids).add(task.id));
    Toast.success({
      content: checked ? "待办已完成" : "待办已恢复",
      duration: 5000,
      action: {
        label: "撤销",
        onClick: () => {
          void setTaskCompletion(task.id, !checked).then(() =>
            setHiddenIds((ids) => {
              const next = new Set(ids);
              next.delete(task.id);
              return next;
            }),
          );
        },
      },
    });
  };
  const complete = async (task: Task, checked: boolean) => {
    const result = await setTaskCompletion(task.id, checked);
    if (result.status === "confirmation-required") {
      setPendingCompletion({ task, incompleteChecklistCount: result.incompleteChecklistCount });
      return;
    }
    applyCompletion(task, checked);
  };
  const confirmCompletion = async () => {
    if (!pendingCompletion) return;
    const { task } = pendingCompletion;
    const result = await setTaskCompletion(task.id, true, { allowIncompleteChecklist: true });
    if (result.status === "updated") {
      setPendingCompletion(null);
      applyCompletion(task, true);
    }
  };
  const remove = async (task: Task) => {
    if (selectedTaskId === task.id && onBeforeTaskDelete && !(await onBeforeTaskDelete(task.id))) return;
    const visible = rows;
    const index = visible.findIndex((row) => row.id === task.id);
    await softDeleteTask(task.id);
    setHiddenIds((ids) => new Set(ids).add(task.id));
    if (selectedTaskId === task.id) {
      selectTask(null);
      selectTask(visible[index + 1]?.id ?? visible[index - 1]?.id ?? null);
    }
    Toast.success({
      content: "待办已移至废纸篓",
      duration: 5000,
      action: {
        label: "恢复",
        onClick: () => {
          void restoreTask(task.id).then(() =>
            setHiddenIds((ids) => {
              const next = new Set(ids);
              next.delete(task.id);
              return next;
            }),
          );
        },
      },
    });
  };
  const onDragEnd = async ({ active: dragged, over }: DragEndEvent) => {
    if (!dragEnabled || !over || dragged.id === over.id) return;
    const oldIndex = active.findIndex((row) => row.id === dragged.id);
    const newIndex = active.findIndex((row) => row.id === over.id);
    if (oldIndex < 0 || newIndex < 0 || !currentWorkspaceId) return;
    try {
      await reorderTasks(
        currentWorkspaceId,
        view.kind === "list" ? view.listId : null,
        arrayMove(active, oldIndex, newIndex).map((row) => row.id),
      );
    } catch {
      Toast.error("重排待办失败，已恢复原顺序");
    }
  };
  const title = titleForView(view, rows);
  const manualAvailable = scopeMode === "current" && (view.kind === "inbox" || view.kind === "list");

  return (
    <section className={styles.listPane} aria-label="待办列表" data-drag-enabled={dragEnabled}>
      <header className={styles.taskListHeader}>
        <div className={styles.taskListTitle}>
          <TodoNavigationTrigger onClick={onOpenNavigation} />
          <div>
            <h1>{title}</h1>
            <span>{queryResult?.total ?? 0} 条结果</span>
          </div>
        </div>
        {!fixedStatus && (
          <ToggleGroup
            className={styles.segmented}
            value={[statusFilter]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "active" || next === "completed" || next === "all") setStatusFilter(next);
            }}
            spacing={0}
            variant="outline"
          >
            <ToggleGroupItem value="active">进行中</ToggleGroupItem>
            <ToggleGroupItem value="completed">已完成</ToggleGroupItem>
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
          </ToggleGroup>
        )}
        <div className={styles.taskListControls}>
          <Button
            variant="outline"
            size="sm"
            aria-label="搜索待办"
            className={searchQuery.trim() !== "" ? styles.searchTriggerActive : undefined}
            onClick={() => setSearchOpen(true)}
          >
            <Search />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" aria-label="优先级筛选">
                  <ListFilter />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {(["all", "high", "medium", "low", "none"] as const).map((priority) => (
                <DropdownMenuItem key={priority} onClick={() => setPriorityFilter(priority)}>
                  {priority === "all"
                    ? "全部优先级"
                    : priority === "high"
                      ? "高优先级"
                      : priority === "medium"
                        ? "中优先级"
                        : priority === "low"
                          ? "低优先级"
                          : "无优先级"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" aria-label="排序">
                  <ArrowDownAZ />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {manualAvailable && <DropdownMenuItem onClick={() => setSortMode("manual")}>手动排序</DropdownMenuItem>}
              <DropdownMenuItem onClick={() => setSortMode("dueDate")}>截止日期</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode("priority")}>优先级</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortMode("createdAt")}>创建时间</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {canQuickAdd && (
        <QuickAddTask
          view={view}
          scopeMode={scopeMode}
          currentWorkspaceId={currentWorkspaceId}
          today={today}
          priority={priorityFilter}
          containerWorkspaceId={containerWorkspaceId}
          tagWorkspaceId={tagWorkspaceId}
          workspaces={workspaces}
        />
      )}
      <ScrollArea className={styles.taskScroll}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onDragEnd(event)}>
          <SortableContext items={active.map((row) => row.id)} strategy={verticalListSortingStrategy}>
            {active.map((row) => (
              <SortableTaskRow
                key={row.id}
                row={row}
                enabled={dragEnabled}
                selected={selectedTaskId === row.id}
                scopeMode={scopeMode}
                today={today}
                onSelect={select}
                onToggleCompletion={(task, checked) => void complete(task, checked)}
                onDelete={(task) => void remove(task)}
              />
            ))}
          </SortableContext>
        </DndContext>
        {completed.length > 0 && (
          <section className={styles.completedGroup}>
            <button
              type="button"
              className={styles.completedHeading}
              onClick={() => setCompletedOpen((value) => !value)}
              aria-expanded={completedOpen}
            >
              已完成 {completed.length} <ChevronDown />
            </button>
            {completedOpen &&
              completed.map((row) => (
                <TaskRow
                  key={row.id}
                  row={row}
                  selected={selectedTaskId === row.id}
                  scopeMode={scopeMode}
                  today={today}
                  onSelect={select}
                  onToggleCompletion={(task, checked) => void complete(task, checked)}
                  onDelete={(task) => void remove(task)}
                />
              ))}
          </section>
        )}
        {rows.length === 0 && <p className={styles.emptyTasks}>暂无待办</p>}
      </ScrollArea>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>搜索待办</DialogTitle>
          </DialogHeader>
          <div className={styles.searchDialogInput}>
            <Search />
            <Input
              autoFocus
              aria-label="搜索当前视图"
              placeholder="搜索待办"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  setSearchOpen(false);
                }
              }}
            />
            {searchQuery !== "" && (
              <Button variant="ghost" size="icon-sm" aria-label="清空搜索" onClick={() => setSearchQuery("")}>
                <X />
              </Button>
            )}
          </div>
          <p className={styles.searchDialogHint}>搜索当前视图中的待办，结果实时生效</p>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={pendingCompletion !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCompletion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>完成待办</AlertDialogTitle>
            <AlertDialogDescription>
              还有 {pendingCompletion?.incompleteChecklistCount ?? 0} 个未完成检查项
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmCompletion()}>仍然完成</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
