import { useMemo, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import type { TodoNavigationGroup } from '@/services/TodoQueryService';
import type { Task, TaskTag, Workspace } from '@/shared/types';

interface TaskMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  sourceTags: TaskTag[];
  workspaces: Workspace[];
  groups: TodoNavigationGroup[];
  loading?: boolean;
  loadError?: string | null;
  moveTask: (input: { taskId: string; workspaceId: string; listId: string | null; tagIds: string[] }) => Promise<unknown>;
}

function initialListId(task: Task, groups: TodoNavigationGroup[]): string | null {
  if (task.listId === null) return null;
  const sourceGroup = groups.find((group) => group.workspace.id === task.workspaceId);
  return sourceGroup?.taskLists.some((list) => list.id === task.listId && list.archivedAt === null)
    ? task.listId
    : null;
}

/** 显式选择跨 Workspace 目标；来源标签只读，不按名称映射。 */
export function TaskMoveDialog({ open, onOpenChange, task, sourceTags, workspaces, groups, loading = false, loadError = null, moveTask }: TaskMoveDialogProps) {
  const [workspaceId, setWorkspaceId] = useState(task.workspaceId);
  const [listId, setListId] = useState<string | null>(() => initialListId(task, groups));
  const [tagIds, setTagIds] = useState<string[]>(() => sourceTags.map((tag) => tag.id));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const group = useMemo(() => groups.find((item) => item.workspace.id === workspaceId), [groups, workspaceId]);
  const lists = group?.taskLists.filter((list) => list.archivedAt === null) ?? [];
  const tags = group?.taskTags ?? [];
  const disabled = loading || saving || loadError !== null;

  const changeWorkspace = (value: string | null) => {
    if (!value) return;
    setWorkspaceId(value);
    setListId(null);
    setTagIds(value === task.workspaceId ? sourceTags.map((tag) => tag.id) : []);
    setError('');
  };
  const toggleTag = (tagId: string, checked: boolean) => {
    setTagIds((previous) => checked ? [...previous, tagId] : previous.filter((id) => id !== tagId));
  };
  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await moveTask({ taskId: task.id, workspaceId, listId, tagIds });
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移动待办失败');
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>移动待办</DialogTitle><DialogDescription>请选择目标工作区、清单和标签。</DialogDescription></DialogHeader>
    {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-label="加载移动选项" />正在读取工作区目标…</div> : loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : <div className="grid gap-3">
      <div className="grid gap-1.5"><Label>目标工作区</Label><Select value={workspaceId} onValueChange={changeWorkspace} disabled={disabled}><SelectTrigger aria-label="目标工作区"><SelectValue>{(value) => workspaces.find((workspace) => workspace.id === value)?.name ?? '选择工作区'}</SelectValue></SelectTrigger><SelectContent>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1.5"><Label>目标清单</Label><Select value={listId ?? '__inbox__'} onValueChange={(value) => setListId(value === '__inbox__' ? null : value ?? null)} disabled={disabled}><SelectTrigger aria-label="目标清单"><SelectValue>{(value) => value === '__inbox__' ? '收集箱' : lists.find((list) => list.id === value)?.name ?? '收集箱'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="__inbox__">收集箱</SelectItem>{lists.map((list) => <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>)}</SelectContent></Select></div>
      <fieldset className="grid gap-2"><legend className="text-sm font-medium">目标标签</legend>{tags.length === 0 ? <p className="text-sm text-muted-foreground">此工作区没有任务标签</p> : tags.map((tag) => <label key={tag.id} className="flex items-center gap-2"><Checkbox checked={tagIds.includes(tag.id)} onCheckedChange={(checked) => toggleTag(tag.id, Boolean(checked))} disabled={disabled} />{tag.name}</label>)}</fieldset>
      {workspaceId !== task.workspaceId && sourceTags.length > 0 && <p className="text-sm text-muted-foreground">来源标签：{sourceTags.map((tag) => tag.name).join('、')}</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>}
    <DialogFooter><Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>取消</Button><Button disabled={disabled} onClick={() => void submit()}>移动待办</Button></DialogFooter>
  </DialogContent></Dialog>;
}
