import { CalendarClock, CheckSquare, Flag, MoreVertical, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskRow as TaskRowData } from "@/services/TodoQueryService";
import type { Task } from "@/shared/types";
import { PRIORITY_LABELS } from "@/shared/tasks/taskRules";
import styles from "./index.module.css";

interface TaskRowProps {
  row: TaskRowData;
  selected: boolean;
  scopeMode: "current" | "all";
  today?: string;
  trash?: boolean;
  onSelect: (taskId: string) => void;
  onToggleCompletion: (task: Task, completed: boolean) => void;
  onDelete: (task: Task) => void;
  onRestore?: (task: Task) => void;
  onPermanentDelete?: (task: Task) => void;
}

export function TaskRow({
  row,
  selected,
  scopeMode,
  today,
  trash,
  onSelect,
  onToggleCompletion,
  onDelete,
  onRestore,
  onPermanentDelete,
}: TaskRowProps) {
  const { task } = row;
  const isOverdue = task.status === "active" && task.dueDate !== null && today !== undefined && task.dueDate < today;
  return (
    <div
      className={`${styles.taskRow} ${selected ? styles.taskRowSelected : ""} ${
        task.status === "completed" ? styles.taskRowCompleted : ""
      }`}
      role="button"
      tabIndex={0}
      aria-label={task.title}
      onClick={() => onSelect(task.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(task.id);
        }
      }}
    >
      <span
        className={styles.taskRowCompletion}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Checkbox
          aria-label={`${task.status === "completed" ? "取消完成" : "完成"}${task.title}`}
          checked={task.status === "completed"}
          onCheckedChange={(checked) => onToggleCompletion(task, Boolean(checked))}
        />
      </span>
      <div className={styles.taskRowMain}>
        <div className={styles.taskRowTitleLine}>
          <span className={styles.taskRowTitle}>{task.title}</span>
          {task.priority !== "none" && (
            <span
              className={`${styles.priority} ${
                styles[`priority${task.priority[0]!.toUpperCase()}${task.priority.slice(1)}`]
              }`}
              aria-label={PRIORITY_LABELS[task.priority]}
            >
              <Flag />
              {PRIORITY_LABELS[task.priority]}
            </span>
          )}
        </div>
        {row.searchMatch?.summary && (
          <p className={styles.taskSearchSummary}>
            {row.searchMatch.source === "checklist" ? "检查项：" : "描述："}
            <span>{row.searchMatch.summary}</span>
          </p>
        )}
        <div className={styles.taskRowMeta}>
          {task.dueDate && (
            <span className={isOverdue ? styles.overdue : ""}>
              <CalendarClock />
              {isOverdue ? "已逾期 " : ""}
              {task.dueDate}
            </span>
          )}
          {row.checklistTotalCount > 0 && (
            <span>
              <CheckSquare />
              {row.checklistCompletedCount}/{row.checklistTotalCount}
            </span>
          )}
          <span>{row.listName}</span>
          {row.taskTags.map((tag) => (
            <Badge key={tag.id} variant="secondary">
              {tag.name}
            </Badge>
          ))}
          {row.hiddenTagCount > 0 && <Badge variant="secondary">+{row.hiddenTagCount}</Badge>}
          {scopeMode === "all" && (
            <span className={styles.workspaceMeta}>
              {row.workspace.icon} <span>{row.workspace.name}</span>
            </span>
          )}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${task.title}更多操作`}
              className={styles.rowMore}
              onClick={(event) => event.stopPropagation()}
            />
          }
        >
          <MoreVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {trash ? (
            <>
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation();
                  onRestore?.(task);
                }}
              >
                <RotateCcw data-icon="inline-start" />
                恢复待办
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  onPermanentDelete?.(task);
                }}
              >
                <Trash2 data-icon="inline-start" />
                永久删除
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(task);
              }}
            >
              删除待办
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
