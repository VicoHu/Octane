import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, RotateCcw, Trash2, X } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Toast } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { TodoNavigationSnapshot } from '@/services/TodoQueryService';
import type { ChecklistItem, TaskPriority } from '@/shared/types';
import { useTodoData } from '@/store/useTodoData';
import { useTodoView } from '@/store/useTodoView';
import { useWorkspace } from '@/store/useWorkspace';
import { useLocalToday } from '../../hooks/useLocalToday';
import { TaskMoveDialog } from './TaskMoveDialog';
import styles from './index.module.css';

export interface TaskDetailPaneHandle {
  commitDraft(): Promise<boolean>;
  discardDraft(): void;
  hasDirtyDraft(): boolean;
}

interface TaskDetailPaneProps {
  mobile: boolean;
  onBack: () => void;
  onClose?: () => void;
}

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'none', label: '无优先级' },
  { value: 'high', label: '高优先级' },
  { value: 'medium', label: '中优先级' },
  { value: 'low', label: '低优先级' },
];

type Draft = { title: string; description: string; revision: number };

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function formatTime(value: number | null): string {
  return value === null ? '未记录' : new Date(value).toLocaleString();
}

function ReadonlyField({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.detailField}><span className={styles.fieldLabel}>{label}</span><div className={styles.readonlyValue}>{children}</div></div>;
}

function IconButton({ label, children, onClick, disabled, className }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean; className?: string }) {
  return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-sm" className={className} aria-label={label} disabled={disabled} onClick={onClick} />}><span data-icon="inline-start">{children}</span></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function ChecklistRow({ item, editable, pending, onUpdate, onComplete, onMove, onDelete }: {
  item: ChecklistItem;
  editable: boolean;
  pending: { completion: boolean; text: boolean; reorder: boolean; delete: boolean };
  onUpdate: (itemId: string, text: string) => Promise<boolean>;
  onComplete: (itemId: string, completed: boolean) => void;
  onMove: (item: ChecklistItem, direction: -1 | 1) => void;
  onDelete: (itemId: string) => void;
}) {
  const [text, setText] = useState(item.text);
  const save = async () => {
    if (text === item.text) return;
    if (!await onUpdate(item.id, text)) setText(item.text);
  };
  if (!editable) return <div className={styles.checklistItem}><Checkbox aria-label={`完成${item.text}`} checked={item.isCompleted} disabled /> <span>{item.text}</span></div>;
  return <div className={styles.checklistItem}>
    <Checkbox aria-label={`完成${item.text}`} checked={item.isCompleted} disabled={pending.completion} onCheckedChange={(checked) => onComplete(item.id, Boolean(checked))} />
    <Input aria-label={`检查项${item.text}`} value={text} disabled={pending.text} onChange={(event) => setText(event.target.value)} onBlur={() => void save()} />
    <IconButton label={`上移「${item.text}」`} disabled={pending.reorder} onClick={() => onMove(item, -1)}><ArrowUp /></IconButton>
    <IconButton label={`下移「${item.text}」`} disabled={pending.reorder} onClick={() => onMove(item, 1)}><ArrowDown /></IconButton>
    <IconButton label={`删除「${item.text}」`} disabled={pending.delete} onClick={() => onDelete(item.id)}><Trash2 /></IconButton>
  </div>;
}

/** 详情面板只经 Todo store 写入；文本草稿使用 revision 串行提交避免并发覆盖。 */
export const TaskDetailPane = forwardRef<TaskDetailPaneHandle, TaskDetailPaneProps>(function TaskDetailPane({ mobile, onBack, onClose }, ref) {
  const selectedTaskId = useTodoView((state) => state.selectedTaskId);
  const selectTask = useTodoView((state) => state.selectTask);
  const detail = useTodoData((state) => state.detail);
  const detailLoading = useTodoData((state) => state.detailLoading);
  const queryResult = useTodoData((state) => state.queryResult);
  const navigation = useTodoData((state) => state.navigation);
  const loadDetail = useTodoData((state) => state.loadDetail);
  const loadMoveOptions = useTodoData((state) => state.loadMoveOptions);
  const patchTask = useTodoData((state) => state.patchTask);
  const replaceTaskTags = useTodoData((state) => state.replaceTaskTags);
  const moveTask = useTodoData((state) => state.moveTask);
  const setTaskCompletion = useTodoData((state) => state.setTaskCompletion);
  const softDeleteTask = useTodoData((state) => state.softDeleteTask);
  const restoreTask = useTodoData((state) => state.restoreTask);
  const deleteTaskPermanently = useTodoData((state) => state.deleteTaskPermanently);
  const restoreTaskList = useTodoData((state) => state.restoreTaskList);
  const createChecklistItem = useTodoData((state) => state.createChecklistItem);
  const updateChecklistItem = useTodoData((state) => state.updateChecklistItem);
  const setChecklistItemCompletion = useTodoData((state) => state.setChecklistItemCompletion);
  const reorderChecklistItems = useTodoData((state) => state.reorderChecklistItems);
  const deleteChecklistItem = useTodoData((state) => state.deleteChecklistItem);
  const workspaces = useWorkspace((state) => state.workspaces);
  const today = useLocalToday();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [titleError, setTitleError] = useState('');
  const [draftError, setDraftError] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [tagOverride, setTagOverride] = useState<string[] | null>(null);
  const [listOverride, setListOverride] = useState<string | null | undefined>(undefined);
  const [priorityOverride, setPriorityOverride] = useState<TaskPriority | null>(null);
  const [dueDateOverride, setDueDateOverride] = useState<string | null | undefined>(undefined);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveOptions, setMoveOptions] = useState<TodoNavigationSnapshot | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [newChecklistText, setNewChecklistText] = useState('');
  const [checklistCreating, setChecklistCreating] = useState(false);
  const [completionConfirm, setCompletionConfirm] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const titleRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<Draft>({ title: '', description: '', revision: 0 });
  const savedRef = useRef({ title: '', description: '' });
  const draftTaskIdRef = useRef<string | null>(null);
  const saveLoopRef = useRef<Promise<boolean> | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (selectedTaskId) void loadDetail(selectedTaskId);
  }, [loadDetail, selectedTaskId]);

  const syncDraftForTask = useCallback((nextTask: { id: string; title: string; description: string }) => {
    if (draftTaskIdRef.current === nextTask.id) return;
    draftTaskIdRef.current = nextTask.id;
    const nextDraft = { title: nextTask.title, description: nextTask.description, revision: 0 };
    draftRef.current = nextDraft;
    savedRef.current = { title: nextDraft.title, description: nextDraft.description };
    setTitle(nextDraft.title);
    setDescription(nextDraft.description);
    setTitleError('');
    setDraftError('');
    setTagOverride(null);
    setListOverride(undefined);
    setPriorityOverride(null);
    setDueDateOverride(undefined);
  }, []);

  useEffect(() => {
    if (detail?.task.id === selectedTaskId) syncDraftForTask(detail.task);
  }, [detail, selectedTaskId, syncDraftForTask]);

  const updateDraft = (patch: Partial<Pick<Draft, 'title' | 'description'>>) => {
    const current = draftRef.current;
    const next = { ...current, ...patch, revision: current.revision + 1 };
    draftRef.current = next;
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.description !== undefined) setDescription(patch.description);
  };
  const hasDirtyDraft = useCallback(() => {
    const draft = draftRef.current;
    const saved = savedRef.current;
    return draft.title !== saved.title || draft.description !== saved.description;
  }, []);
  const commitDraft = useCallback(async (): Promise<boolean> => {
    if (!detail || detail.task.id !== selectedTaskId || !hasDirtyDraft()) return true;
    if (saveLoopRef.current) return saveLoopRef.current;
    if (draftRef.current.title.trim() === '') {
      setTitleError('标题不能为空');
      titleRef.current?.focus();
      return false;
    }
    const taskId = detail.task.id;
    const saveLoop = (async () => {
      let spinnerTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        spinnerTimer = setTimeout(() => setSavingDraft(true), 300);
        while (true) {
          const snapshot = draftRef.current;
          if (snapshot.title.trim() === '') {
            setTitleError('标题不能为空');
            titleRef.current?.focus();
            return false;
          }
          try {
            await patchTask(taskId, { title: snapshot.title, description: snapshot.description });
          } catch (reason) {
            setDraftError(errorMessage(reason, '保存待办失败'));
            Toast.error('保存待办失败，请重试或放弃修改');
            return false;
          }
          savedRef.current = { title: snapshot.title, description: snapshot.description };
          if (draftRef.current.revision === snapshot.revision) {
            setTitleError('');
            setDraftError('');
            return true;
          }
        }
      } finally {
        if (spinnerTimer) clearTimeout(spinnerTimer);
        setSavingDraft(false);
        saveLoopRef.current = null;
      }
    })();
    saveLoopRef.current = saveLoop;
    return saveLoop;
  }, [detail, hasDirtyDraft, patchTask, selectedTaskId]);
  const discardDraft = useCallback(() => {
    const saved = savedRef.current;
    draftRef.current = { ...saved, revision: draftRef.current.revision + 1 };
    setTitle(saved.title);
    setDescription(saved.description);
    setTitleError('');
    setDraftError('');
  }, []);

  useImperativeHandle(ref, () => ({ commitDraft, discardDraft, hasDirtyDraft }), [commitDraft, discardDraft, hasDirtyDraft]);

  const task = detail?.task;
  const selectedTagIds = tagOverride ?? detail?.taskTags.map((tag) => tag.id) ?? [];
  const listId = listOverride === undefined ? task?.listId ?? null : listOverride;
  const priority = priorityOverride ?? task?.priority ?? 'none';
  const dueDate = dueDateOverride === undefined ? task?.dueDate ?? null : dueDateOverride;
  const archived = detail?.taskList?.archivedAt != null;
  const trashed = task?.deletedAt !== null;
  const readOnly = Boolean(archived || trashed);
  const workspaceGroup = navigation?.groups.find((group) => group.workspace.id === task?.workspaceId);
  const activeLists = workspaceGroup?.taskLists.filter((item) => item.archivedAt === null) ?? [];
  const availableTags = workspaceGroup?.taskTags ?? [];
  const isPending = (key: string) => pendingKeys.has(key);
  const runPending = async (key: string, action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    if (pendingRef.current.has(key)) return false;
    pendingRef.current.add(key);
    setPendingKeys((keys) => new Set(keys).add(key));
    try { await action(); return true; } catch (reason) { Toast.error(errorMessage(reason, fallback)); return false; }
    finally {
      pendingRef.current.delete(key);
      setPendingKeys((keys) => { const next = new Set(keys); next.delete(key); return next; });
    }
  };
  const openMove = () => {
    setMoveOptions(null);
    setMoveError(null);
    setMoveLoading(true);
    setMoveOpen(true);
    void loadMoveOptions(today).then(setMoveOptions).catch((reason) => setMoveError(errorMessage(reason, '读取移动目标失败'))).finally(() => setMoveLoading(false));
  };
  const changeList = (next: string | null) => {
    if (!task || pendingRef.current.has('list')) return;
    const nextListId = next === '__inbox__' ? null : next;
    setListOverride(nextListId);
    void runPending('list', async () => {
      try { await moveTask({ taskId: task.id, workspaceId: task.workspaceId, listId: nextListId, tagIds: selectedTagIds }); setListOverride(undefined); }
      catch (reason) { setListOverride(undefined); throw reason; }
    }, '移动待办失败');
  };
  const changeTags = (tagId: string, checked: boolean) => {
    if (!task || pendingRef.current.has('tags')) return;
    const next = checked ? [...selectedTagIds, tagId] : selectedTagIds.filter((id) => id !== tagId);
    setTagOverride(next);
    void runPending('tags', async () => {
      try { await replaceTaskTags(task.id, next); setTagOverride(null); } catch (reason) { setTagOverride(null); throw reason; }
    }, '更新任务标签失败');
  };
  const changePriority = (next: TaskPriority) => {
    if (!task || pendingRef.current.has('priority')) return;
    setPriorityOverride(next);
    void runPending('priority', async () => { try { await patchTask(task.id, { priority: next }); setPriorityOverride(null); } catch (reason) { setPriorityOverride(null); throw reason; } }, '更新待办失败');
  };
  const changeDueDate = (next: string | null) => {
    if (!task || pendingRef.current.has('dueDate')) return;
    setDueDateOverride(next);
    void runPending('dueDate', async () => { try { await patchTask(task.id, { dueDate: next }); setDueDateOverride(undefined); } catch (reason) { setDueDateOverride(undefined); throw reason; } }, '更新待办失败');
  };
  const toggleCompletion = async (completed: boolean, allowIncompleteChecklist = false) => {
    if (!task) return;
    await runPending('completion', async () => {
      const result = await setTaskCompletion(task.id, completed, { allowIncompleteChecklist });
      if (result.status === 'confirmation-required') setCompletionConfirm(result.incompleteChecklistCount);
      else setCompletionConfirm(null);
    }, '更新完成状态失败');
  };
  const moveChecklist = (item: ChecklistItem, direction: -1 | 1) => {
    if (!task || !detail) return;
    const ids = detail.checklistItems.map((current) => current.id);
    const index = ids.indexOf(item.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void runPending('check-reorder', () => reorderChecklistItems(task.id, ids), '重排检查项失败');
  };
  const addChecklist = async () => {
    if (!task || newChecklistText.trim() === '' || checklistCreating) return;
    setChecklistCreating(true);
    try {
      await createChecklistItem(task.id, newChecklistText.trim());
      setNewChecklistText('');
    } catch (reason) {
      Toast.error(errorMessage(reason, '创建检查项失败'));
    } finally {
      setChecklistCreating(false);
    }
  };
  const updateChecklist = (itemId: string, text: string) => runPending(`check-text-${itemId}`, () => updateChecklistItem(itemId, text), '更新检查项失败');
  const removeTask = () => {
    if (!task) return;
    void (async () => {
      if (!await commitDraft()) return;
      await runPending('task-delete', async () => {
        const rows = [...(queryResult?.active ?? []), ...(queryResult?.completed ?? [])];
        const index = rows.findIndex((row) => row.id === task.id);
        await softDeleteTask(task.id);
        selectTask(rows[index + 1]?.id ?? rows[index - 1]?.id ?? null);
      }, '删除待办失败');
    })();
  };
  const permanentlyRemoveTask = () => {
    if (!task) return;
    void runPending('task-permanent-delete', async () => { await deleteTaskPermanently(task.id); selectTask(null); setDeleteConfirm(false); }, '永久删除待办失败');
  };

  if (!selectedTaskId || (!detail && !detailLoading) || (detail && detail.task.id !== selectedTaskId)) {
    return <section className={styles.detailPane} aria-label="待办详情"><header className={styles.paneHeader}>{mobile && <IconButton label="返回列表" className={styles.mobileDetailAction} onClick={onBack}><ArrowLeft /></IconButton>}<h2>详情</h2></header><div className={styles.paneBody}>选择一条待办</div></section>;
  }
  if (!detail || !task) return <section className={styles.detailPane} aria-label="待办详情"><div className={styles.paneBody}><Spinner aria-label="加载详情" /></div></section>;

  const taskListName = detail.taskList?.name ?? '收集箱';
  const tagsText = detail.taskTags.length ? detail.taskTags.map((tag) => tag.name).join('、') : '无标签';
  const priorityLabel = PRIORITIES.find((item) => item.value === task.priority)?.label ?? '无优先级';

  return <section className={styles.detailPane} aria-label="待办详情">
    <header className={styles.paneHeader}>{mobile ? <IconButton label="返回列表" className={styles.mobileDetailAction} onClick={onBack}><ArrowLeft /></IconButton> : onClose ? <IconButton label="关闭详情" onClick={onClose}><X /></IconButton> : null}<h2>详情</h2>{savingDraft && <Spinner aria-label="保存中" />}</header>
    <div className={styles.detailBody}>
      {draftError && <div className={styles.draftError} role="alert">{draftError}<Button size="sm" variant="outline" onClick={() => void commitDraft()}>重试</Button><Button size="sm" variant="ghost" onClick={discardDraft}>放弃修改</Button></div>}
      <div className={styles.detailField}><Label htmlFor="task-title">标题</Label><Input ref={titleRef} id="task-title" aria-label="标题" value={title} disabled={readOnly} aria-invalid={Boolean(titleError)} onChange={(event) => { updateDraft({ title: event.target.value }); setTitleError(''); }} onBlur={() => void commitDraft()} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void commitDraft(); } }} />{titleError && <p className={styles.fieldError}>{titleError}</p>}</div>
      <div className={styles.detailField}><Label htmlFor="task-description">描述</Label><Textarea id="task-description" aria-label="描述" value={description} disabled={readOnly} onChange={(event) => updateDraft({ description: event.target.value })} onBlur={() => void commitDraft()} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void commitDraft(); } }} /></div>
      <div className={styles.detailGrid}>
        <ReadonlyField label="工作区"><span>{detail.workspace.name}</span>{!trashed && <Button size="sm" variant="outline" onClick={openMove}>移动待办</Button>}</ReadonlyField>
        {readOnly ? <ReadonlyField label="任务清单">{taskListName}</ReadonlyField> : <div className={styles.detailField}><Label>任务清单</Label><Select value={listId ?? '__inbox__'} disabled={isPending('list')} onValueChange={changeList}><SelectTrigger aria-label="任务清单"><SelectValue>{(value) => value === '__inbox__' ? '收集箱' : activeLists.find((item) => item.id === value)?.name ?? '收集箱'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="__inbox__">收集箱</SelectItem>{activeLists.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>}
        {readOnly ? <ReadonlyField label="任务标签">{tagsText}</ReadonlyField> : <div className={styles.detailField}><Label>任务标签</Label><Popover><PopoverTrigger render={<Button variant="outline" aria-label="任务标签" disabled={isPending('tags')}> {selectedTagIds.length ? `任务标签 ${selectedTagIds.length}` : '任务标签'}</Button>} /><PopoverContent>{availableTags.length === 0 ? <p>没有任务标签</p> : availableTags.map((tag) => <label key={tag.id} className={styles.tagOption}><Checkbox checked={selectedTagIds.includes(tag.id)} disabled={isPending('tags')} onCheckedChange={(checked) => changeTags(tag.id, Boolean(checked))} />{tag.name}</label>)}</PopoverContent></Popover></div>}
        {readOnly ? <ReadonlyField label="优先级">{priorityLabel}</ReadonlyField> : <div className={styles.detailField}><Label>优先级</Label><Select value={priority} disabled={isPending('priority')} onValueChange={(value) => { if (value && PRIORITIES.some((item) => item.value === value)) changePriority(value as TaskPriority); }}><SelectTrigger aria-label="优先级"><SelectValue>{(value) => PRIORITIES.find((item) => item.value === value)?.label ?? '无优先级'}</SelectValue></SelectTrigger><SelectContent>{PRIORITIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>}
        {readOnly ? <ReadonlyField label="截止日期">{task.dueDate ?? '未设置'}</ReadonlyField> : <div className={styles.detailField}><Label htmlFor="task-due-date">截止日期</Label><Input id="task-due-date" aria-label="截止日期" type="date" value={dueDate ?? ''} disabled={isPending('dueDate')} onChange={(event) => changeDueDate(event.target.value || null)} /></div>}
        {readOnly ? <ReadonlyField label="完成状态">{task.status === 'completed' ? '已完成' : '进行中'}</ReadonlyField> : <div className={styles.detailField}><Label>完成状态</Label><label className={styles.completeControl}><Checkbox aria-label={task.status === 'completed' ? '取消完成' : '完成待办'} checked={task.status === 'completed'} disabled={isPending('completion')} onCheckedChange={(checked) => void toggleCompletion(Boolean(checked))} />{task.status === 'completed' ? '已完成' : '进行中'}</label></div>}
      </div>
      {archived && detail.taskList && <Button variant="outline" disabled={isPending('list-restore')} onClick={() => void runPending('list-restore', () => restoreTaskList(detail.taskList!.id), '恢复清单失败')}><RotateCcw data-icon="inline-start" />恢复清单</Button>}
      <section className={styles.checklistSection} aria-label="检查项"><h3>检查项</h3>{!readOnly && <div className={styles.addChecklist}><Input aria-label="添加检查项" value={newChecklistText} disabled={checklistCreating} onChange={(event) => setNewChecklistText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addChecklist(); } }} /><Button size="sm" disabled={checklistCreating || newChecklistText.trim() === ''} onClick={() => void addChecklist()}>{checklistCreating ? <Spinner aria-label="创建检查项" /> : '添加'}</Button></div>}{detail.checklistItems.length === 0 ? <p className={styles.emptyChecklist}>暂无检查项</p> : detail.checklistItems.map((item) => <ChecklistRow key={`${item.id}-${item.updatedAt}`} item={item} editable={!readOnly} onUpdate={updateChecklist} pending={{ completion: isPending(`check-complete-${item.id}`), text: isPending(`check-text-${item.id}`), reorder: isPending('check-reorder'), delete: isPending(`check-delete-${item.id}`) }} onComplete={(itemId, completed) => void runPending(`check-complete-${itemId}`, () => setChecklistItemCompletion(itemId, completed), '更新检查项失败')} onMove={moveChecklist} onDelete={(itemId) => void runPending(`check-delete-${itemId}`, () => deleteChecklistItem(itemId), '删除检查项失败')}  />)}</section>
      <section className={styles.systemFields} aria-label="系统信息"><span>创建：{formatTime(task.createdAt)}</span><span>更新：{formatTime(task.updatedAt)}</span><span>完成：{formatTime(task.completedAt)}</span><span>删除：{formatTime(task.deletedAt)}</span></section>
      <div className={styles.detailActions}>{trashed ? <><Button variant="outline" disabled={isPending('task-restore')} onClick={() => void runPending('task-restore', () => restoreTask(task.id), '恢复待办失败')}><RotateCcw data-icon="inline-start" />恢复待办</Button><Button variant="destructive" disabled={isPending('task-permanent-delete')} onClick={() => setDeleteConfirm(true)}><Trash2 data-icon="inline-start" />永久删除</Button></> : <Button variant="destructive" disabled={isPending('task-delete')} onClick={removeTask}><Trash2 data-icon="inline-start" />删除待办</Button>}</div>
    </div>
    {moveOpen && <TaskMoveDialog key={moveOptions ? `ready-${task.id}` : `loading-${task.id}`} open onOpenChange={setMoveOpen} task={task} sourceTags={detail.taskTags} workspaces={workspaces} groups={moveOptions?.groups ?? []} loading={moveLoading} loadError={moveError} moveTask={moveTask} />}
    <AlertDialog open={completionConfirm !== null} onOpenChange={(open) => { if (!open) setCompletionConfirm(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>完成待办</AlertDialogTitle><AlertDialogDescription>还有 {completionConfirm ?? 0} 个未完成检查项。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void toggleCompletion(true, true)}><Check data-icon="inline-start" />仍然完成</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>永久删除待办</AlertDialogTitle><AlertDialogDescription>此操作无法撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={isPending('task-permanent-delete')} onClick={permanentlyRemoveTask}>永久删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
});
