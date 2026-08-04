import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTodoData } from "@/store/useTodoData";
import type { TodoView } from "@/services/TodoQueryService";
import type { TaskPriority, Workspace } from "@/shared/types";
import styles from "./index.module.css";

interface QuickAddTaskProps {
  view: TodoView;
  scopeMode: "current" | "all";
  currentWorkspaceId: string | null;
  today: string;
  priority: TaskPriority | "all";
  containerWorkspaceId?: string;
  tagWorkspaceId?: string;
  workspaces?: Workspace[];
}

export function QuickAddTask({
  view,
  scopeMode,
  currentWorkspaceId,
  today,
  priority,
  containerWorkspaceId,
  tagWorkspaceId,
  workspaces = [],
}: QuickAddTaskProps) {
  const createTask = useTodoData((state) => state.createTask);
  const [title, setTitle] = useState("");
  const [workspaceId, setWorkspaceId] = useState(
    containerWorkspaceId ?? tagWorkspaceId ?? currentWorkspaceId ?? workspaces[0]?.id ?? "",
  );
  const [dueDate, setDueDate] = useState(view.kind === "today" || view.kind === "next7" ? today : "");
  const isSystemAggregate =
    scopeMode === "all" && (view.kind === "today" || view.kind === "next7" || view.kind === "inbox");

  useEffect(() => {
    setWorkspaceId(containerWorkspaceId ?? tagWorkspaceId ?? currentWorkspaceId ?? workspaces[0]?.id ?? "");
    setDueDate(view.kind === "today" || view.kind === "next7" ? today : "");
  }, [containerWorkspaceId, currentWorkspaceId, tagWorkspaceId, today, view.kind, workspaces]);

  const input = useMemo(
    () => ({
      workspaceId,
      listId: view.kind === "list" ? view.listId : null,
      ...(view.kind === "tag" ? { tagIds: [view.tagId] } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(priority === "all" ? {} : { priority }),
    }),
    [dueDate, priority, view, workspaceId],
  );
  const submit = async () => {
    if (title.trim() === "" || workspaceId === "") return;
    await createTask({ ...input, title: title.trim() });
    setTitle("");
  };

  return (
    <div className={styles.quickAdd} aria-label="快速添加">
      <div className={styles.quickAddInput}>
        <Plus />
        <Input
          aria-label="快速添加待办"
          placeholder="添加待办"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </div>
      {isSystemAggregate && (
        <div className={styles.quickAddControl}>
          <Label className="sr-only">工作区</Label>
          <Select value={workspaceId} onValueChange={(value) => setWorkspaceId(value ?? "")}>
            <SelectTrigger aria-label="工作区">
              <SelectValue>
                {(value) => workspaces.find((workspace) => workspace.id === value)?.name ?? "选择工作区"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {view.kind === "next7" && (
        <div className={styles.quickAddControl}>
          <Label className="sr-only" htmlFor="quick-add-due-date">
            截止日期
          </Label>
          <Input
            id="quick-add-due-date"
            aria-label="截止日期"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}
