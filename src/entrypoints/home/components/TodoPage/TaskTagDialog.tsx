import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTodoData } from '@/store/useTodoData';
import type { TaskTag, TodoColor, Workspace } from '@/shared/types';

const COLORS: TodoColor[] = ['gray', 'red', 'amber', 'green', 'cyan', 'blue', 'violet', 'pink'];

interface TaskTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  taskTag?: TaskTag;
  action?: 'create' | 'edit' | 'delete';
}

export function TaskTagDialog({ open, onOpenChange, workspaces, currentWorkspaceId, taskTag, action = 'create' }: TaskTagDialogProps) {
  const createTaskTag = useTodoData((state) => state.createTaskTag);
  const updateTaskTag = useTodoData((state) => state.updateTaskTag);
  const getTaskTagDeleteImpact = useTodoData((state) => state.getTaskTagDeleteImpact);
  const deleteTaskTag = useTodoData((state) => state.deleteTaskTag);
  const [name, setName] = useState(taskTag?.name ?? '');
  const [workspaceId, setWorkspaceId] = useState(taskTag?.workspaceId ?? currentWorkspaceId ?? workspaces[0]?.id ?? '');
  const [color, setColor] = useState<TodoColor>(taskTag?.color ?? 'gray');
  const [impact, setImpact] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(taskTag?.name ?? ''); setWorkspaceId(taskTag?.workspaceId ?? currentWorkspaceId ?? workspaces[0]?.id ?? ''); setColor(taskTag?.color ?? 'gray'); setError(''); setImpact(null);
    if (action === 'delete' && taskTag) void getTaskTagDeleteImpact(taskTag.id).then(({ affectedTaskCount }) => setImpact(affectedTaskCount));
  }, [action, currentWorkspaceId, getTaskTagDeleteImpact, open, taskTag, workspaces]);

  const close = () => onOpenChange(false);
  const save = async () => {
    if (name.trim() === '') { setError('标签名称不能为空'); return; }
    try {
      if (action === 'create') await createTaskTag(workspaceId, { name, color });
      else if (taskTag) await updateTaskTag(taskTag.id, { name, color });
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存标签失败'); }
  };
  const remove = async () => { if (!taskTag) return; await deleteTaskTag(taskTag.id); close(); };
  const title = action === 'create' ? '创建标签' : action === 'edit' ? '编辑标签' : '删除标签';

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
    {action === 'delete' ? <DialogDescription>{impact === null ? '正在读取删除影响。' : <><span>将从 {impact} 条待办移除此标签</span><span>，不会删除待办。</span></>}</DialogDescription> : <div className="grid gap-3">
      <div className="grid gap-1.5"><Label htmlFor="task-tag-name">标签名称</Label><Input id="task-tag-name" value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="grid gap-1.5"><Label>工作区</Label><Select value={workspaceId} onValueChange={(value) => setWorkspaceId(value ?? '')} disabled={action === 'edit'}><SelectTrigger aria-label="工作区"><SelectValue>{(value) => workspaces.find((workspace) => workspace.id === value)?.name ?? '选择工作区'}</SelectValue></SelectTrigger><SelectContent>{workspaces.map((workspace) => <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>)}</SelectContent></Select></div>
      <fieldset className="grid gap-1.5"><legend className="text-sm font-medium">颜色</legend><div className="flex gap-2">{COLORS.map((item) => <button key={item} type="button" aria-label={`${item} 色`} aria-pressed={color === item} className="size-5 rounded-full ring-offset-2 aria-pressed:ring-2 aria-pressed:ring-ring" style={{ backgroundColor: `var(--todo-${item})` }} onClick={() => setColor(item)} />)}</div></fieldset>
    </div>}
    {error && <p className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" onClick={close}>取消</Button><Button variant={action === 'delete' ? 'destructive' : 'default'} onClick={() => void (action === 'delete' ? remove() : save())}>{action === 'delete' ? '删除标签' : action === 'create' ? '创建标签' : '保存标签'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
