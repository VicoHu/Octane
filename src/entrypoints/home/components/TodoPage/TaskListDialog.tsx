import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTodoData } from '@/store/useTodoData';
import type { TaskList, TodoColor, Workspace } from '@/shared/types';

const COLORS: TodoColor[] = ['gray', 'red', 'amber', 'green', 'cyan', 'blue', 'violet', 'pink'];

interface TaskListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  taskList?: TaskList;
  action?: 'create' | 'edit' | 'archive' | 'delete';
}

export function TaskListDialog({ open, onOpenChange, workspaces, currentWorkspaceId, taskList, action = 'create' }: TaskListDialogProps) {
  const createTaskList = useTodoData((state) => state.createTaskList);
  const updateTaskList = useTodoData((state) => state.updateTaskList);
  const archiveTaskList = useTodoData((state) => state.archiveTaskList);
  const getTaskListDeleteImpact = useTodoData((state) => state.getTaskListDeleteImpact);
  const deleteTaskListPermanently = useTodoData((state) => state.deleteTaskListPermanently);
  const [name, setName] = useState(taskList?.name ?? '');
  const [workspaceId, setWorkspaceId] = useState(taskList?.workspaceId ?? currentWorkspaceId ?? workspaces[0]?.id ?? '');
  const [color, setColor] = useState<TodoColor>(taskList?.color ?? 'gray');
  const [error, setError] = useState('');
  const [confirmArchive, setConfirmArchive] = useState<number | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<{ undeletedTaskCount: number; deletedTaskCount: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(taskList?.name ?? '');
    setWorkspaceId(taskList?.workspaceId ?? currentWorkspaceId ?? workspaces[0]?.id ?? '');
    setColor(taskList?.color ?? 'gray');
    setError('');
    setConfirmArchive(null);
    if (action === 'delete' && taskList) void getTaskListDeleteImpact(taskList.id).then(setDeleteImpact);
  }, [action, currentWorkspaceId, getTaskListDeleteImpact, open, taskList, workspaces]);

  const close = () => onOpenChange(false);
  const save = async () => {
    if (name.trim() === '') { setError('清单名称不能为空'); return; }
    try {
      if (action === 'create') await createTaskList(workspaceId, { name, color });
      else if (action === 'edit' && taskList) await updateTaskList(taskList.id, { name, color });
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存清单失败'); }
  };
  const archive = async (allowIncompleteTasks = false) => {
    if (!taskList) return;
    const result = await archiveTaskList(taskList.id, { allowIncompleteTasks });
    if (result.status === 'confirmation-required') setConfirmArchive(result.incompleteCount);
    else close();
  };
  const remove = async () => {
    if (!taskList) return;
    try { await deleteTaskListPermanently(taskList.id); close(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除清单失败'); }
  };
  const title = action === 'create' ? '创建清单' : action === 'edit' ? '编辑清单' : action === 'archive' ? '归档清单' : '删除清单';

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
    {action === 'create' || action === 'edit' ? <div className="grid gap-3">
      <div className="grid gap-1.5"><Label htmlFor="task-list-name">清单名称</Label><Input id="task-list-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label>工作区</Label><Select value={workspaceId} onValueChange={(value) => setWorkspaceId(value ?? '')} disabled={action === 'edit'}><SelectTrigger aria-label="工作区"><SelectValue>{(value) => workspaces.find((workspace) => workspace.id === value)?.name ?? '选择工作区'}</SelectValue></SelectTrigger><SelectContent>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent></Select></div>
      <fieldset className="grid gap-1.5"><legend className="text-sm font-medium">颜色</legend><div className="flex gap-2">{COLORS.map((item) => <button key={item} type="button" aria-label={`${item} 色`} aria-pressed={color === item} className="size-5 rounded-full ring-offset-2 aria-pressed:ring-2 aria-pressed:ring-ring" style={{ backgroundColor: `var(--todo-${item})` }} onClick={() => setColor(item)} />)}</div></fieldset>
    </div> : action === 'archive' ? <DialogDescription>{confirmArchive === null ? '归档后，此清单中的待办会退出活跃视图。' : <><span>其中有 {confirmArchive} 条未完成待办</span><span>，仍要归档吗？</span></>}</DialogDescription> : <DialogDescription>{deleteImpact ? deleteImpact.undeletedTaskCount > 0 ? `此清单仍有 ${deleteImpact.undeletedTaskCount} 条未删除待办，不能永久删除。` : `删除后，${deleteImpact.deletedTaskCount} 条废纸篓待办恢复时将进入收集箱。` : '正在读取删除影响。'}</DialogDescription>}
    {error && <p className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" onClick={close}>取消</Button>{action === 'create' || action === 'edit' ? <Button onClick={() => void save()}>{action === 'create' ? '创建清单' : '保存清单'}</Button> : action === 'archive' ? <Button onClick={() => void archive(confirmArchive !== null)}>归档清单</Button> : <Button variant="destructive" disabled={(deleteImpact?.undeletedTaskCount ?? 1) > 0} onClick={() => void remove()}>删除清单</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
