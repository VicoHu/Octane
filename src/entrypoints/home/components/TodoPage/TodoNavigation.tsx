import { useState, type ReactNode } from 'react';
import { Archive, ArchiveRestore, CalendarDays, Inbox, Menu, MoreVertical, Plus, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useTodoData } from '@/store/useTodoData';
import { useTodoView } from '@/store/useTodoView';
import { useWorkspace } from '@/store/useWorkspace';
import type { TaskList, TaskTag } from '@/shared/types';
import { MobilePrimaryNavigation } from '../MobilePrimaryNavigation';
import type { AppPage } from '../AppRail';
import { TaskListDialog } from './TaskListDialog';
import { TaskTagDialog } from './TaskTagDialog';
import styles from './index.module.css';

interface TodoNavigationProps { activePage: AppPage; onNavigate: (page: AppPage) => void; open: boolean; onOpenChange: (open: boolean) => void; }
type ListDialogState = { action: 'create' | 'edit' | 'archive' | 'delete'; taskList?: TaskList } | null;
type TagDialogState = { action: 'create' | 'edit' | 'delete'; taskTag?: TaskTag } | null;

function Count({ value }: { value: number }) { return value > 0 ? <span className={styles.navCount}>{value}</span> : null; }

function NavigationContents({ activePage, onNavigate, showPrimaryNavigation, closeSheet }: Pick<TodoNavigationProps, 'activePage' | 'onNavigate'> & { showPrimaryNavigation: boolean; closeSheet: () => void }) {
  const navigation = useTodoData((state) => state.navigation);
  const restoreTaskList = useTodoData((state) => state.restoreTaskList);
  const reorderTaskLists = useTodoData((state) => state.reorderTaskLists);
  const reorderTaskTags = useTodoData((state) => state.reorderTaskTags);
  const scopeMode = useTodoView((state) => state.scopeMode);
  const view = useTodoView((state) => state.view);
  const setScopeMode = useTodoView((state) => state.setScopeMode);
  const setView = useTodoView((state) => state.setView);
  const workspaces = useWorkspace((state) => state.workspaces);
  const currentWorkspaceId = useWorkspace((state) => state.currentWorkspaceId);
  const [listDialog, setListDialog] = useState<ListDialogState>(null);
  const [tagDialog, setTagDialog] = useState<TagDialogState>(null);
  const select = (next: typeof view) => { setView(next); closeSheet(); };
  const moveList = (list: TaskList, direction: -1 | 1) => {
    const group = navigation?.groups.find((item) => item.workspace.id === list.workspaceId);
    if (!group) return;
    const active = group.taskLists.filter((item) => item.archivedAt === null);
    const index = active.findIndex((item) => item.id === list.id);
    const target = index + direction;
    if (target < 0 || target >= active.length) return;
    const ids = active.map((item) => item.id); [ids[index]!, ids[target]!] = [ids[target]!, ids[index]!];
    void reorderTaskLists(list.workspaceId, ids);
  };
  const moveTag = (tag: TaskTag, direction: -1 | 1) => {
    const group = navigation?.groups.find((item) => item.workspace.id === tag.workspaceId);
    if (!group) return;
    const index = group.taskTags.findIndex((item) => item.id === tag.id);
    const target = index + direction;
    if (target < 0 || target >= group.taskTags.length) return;
    const ids = group.taskTags.map((item) => item.id); [ids[index]!, ids[target]!] = [ids[target]!, ids[index]!];
    void reorderTaskTags(tag.workspaceId, ids);
  };
  const navButton = (label: string, selected: boolean, count: number, onClick: () => void, icon: ReactNode) => <button type="button" className={`${styles.navItem} ${selected ? styles.navItemSelected : ''}`} aria-current={selected ? 'page' : undefined} aria-label={`${label}${count ? ` ${count}` : ''}`} onClick={onClick}>{icon}<span>{label}</span><Count value={count} /></button>;

  return <div className={styles.navigationContents}>
    {showPrimaryNavigation && <MobilePrimaryNavigation activePage={activePage} onNavigate={onNavigate} />}
    <ToggleGroup value={[scopeMode]} onValueChange={(value) => { const next = value[0]; if (next === 'current' || next === 'all') setScopeMode(next); }} spacing={0} variant="outline" className={styles.scopeToggle}>
      <ToggleGroupItem value="current">当前工作区</ToggleGroupItem><ToggleGroupItem value="all">所有工作区</ToggleGroupItem>
    </ToggleGroup>
    <nav aria-label="待办视图" className={styles.navSections}>
      {navButton('今天', view.kind === 'today', navigation?.counts.today ?? 0, () => select({ kind: 'today' }), <CalendarDays />)}
      {navButton('未来 7 天', view.kind === 'next7', navigation?.counts.next7 ?? 0, () => select({ kind: 'next7' }), <CalendarDays />)}
      {navButton('收集箱', view.kind === 'inbox', navigation?.counts.inbox ?? 0, () => select({ kind: 'inbox' }), <Inbox />)}
      <div className={styles.navSectionHeader}><span>任务清单</span><Button variant="ghost" size="icon-sm" aria-label="创建清单" onClick={() => setListDialog({ action: 'create' })}><Plus /></Button></div>
      {navigation?.groups.map((group) => <div key={group.workspace.id} className={styles.navGroup}>{scopeMode === 'all' && <h3>{group.workspace.icon} {group.workspace.name}</h3>}{group.taskLists.filter((list) => list.archivedAt === null).map((list) => <div key={list.id} className={styles.navEntity}>{navButton(list.name, view.kind === 'list' && view.listId === list.id, group.counts.list[list.id] ?? 0, () => select({ kind: 'list', listId: list.id }), <span className="size-2 rounded-full" style={{ backgroundColor: `var(--todo-${list.color})` }} />)}<DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${list.name}更多操作`}><MoreVertical /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setListDialog({ action: 'edit', taskList: list })}>重命名或颜色</DropdownMenuItem><DropdownMenuItem onClick={() => moveList(list, -1)}>上移</DropdownMenuItem><DropdownMenuItem onClick={() => moveList(list, 1)}>下移</DropdownMenuItem><DropdownMenuItem onClick={() => setListDialog({ action: 'archive', taskList: list })}><Archive />归档</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</div>)}
      <div className={styles.navSectionHeader}><span>已归档清单</span><Count value={navigation?.counts.archivedLists ?? 0} /></div>
      {navigation?.groups.map((group) => group.taskLists.filter((list) => list.archivedAt !== null).map((list) => <div key={list.id} className={styles.navEntity}>{navButton(list.name, view.kind === 'archivedList' && view.listId === list.id, 0, () => select({ kind: 'archivedList', listId: list.id }), <Archive />)}<DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${list.name}更多操作`}><MoreVertical /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void restoreTaskList(list.id)}><ArchiveRestore />恢复</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => setListDialog({ action: 'delete', taskList: list })}>永久删除</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>))}
      <div className={styles.navSectionHeader}><span>任务标签</span><Button variant="ghost" size="icon-sm" aria-label="创建标签" onClick={() => setTagDialog({ action: 'create' })}><Plus /></Button></div>
      {navigation?.groups.map((group) => <div key={group.workspace.id}>{scopeMode === 'all' && <h3>{group.workspace.icon} {group.workspace.name}</h3>}{group.taskTags.map((tag) => <div key={tag.id} className={styles.navEntity}>{navButton(tag.name, view.kind === 'tag' && view.tagId === tag.id, group.counts.tag[tag.id] ?? 0, () => select({ kind: 'tag', tagId: tag.id }), <Tag style={{ color: `var(--todo-${tag.color})` }} />)}<DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${tag.name}更多操作`}><MoreVertical /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setTagDialog({ action: 'edit', taskTag: tag })}>重命名或颜色</DropdownMenuItem><DropdownMenuItem onClick={() => moveTag(tag, -1)}>上移</DropdownMenuItem><DropdownMenuItem onClick={() => moveTag(tag, 1)}>下移</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => setTagDialog({ action: 'delete', taskTag: tag })}>删除标签</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>)}</div>)}
      {navButton('废纸篓', view.kind === 'trash', navigation?.counts.trash ?? 0, () => select({ kind: 'trash' }), <Trash2 />)}
    </nav>
    <TaskListDialog open={listDialog !== null} onOpenChange={(open) => { if (!open) setListDialog(null); }} workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} taskList={listDialog?.taskList} action={listDialog?.action} />
    <TaskTagDialog open={tagDialog !== null} onOpenChange={(open) => { if (!open) setTagDialog(null); }} workspaces={workspaces} currentWorkspaceId={currentWorkspaceId} taskTag={tagDialog?.taskTag} action={tagDialog?.action} />
  </div>;
}

export function TodoNavigation({ activePage, onNavigate, open, onOpenChange }: TodoNavigationProps) { return <><aside className={styles.desktopNavigation} aria-label="待办导航"><NavigationContents activePage={activePage} onNavigate={onNavigate} showPrimaryNavigation={false} closeSheet={() => undefined} /></aside><Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="left" className={styles.navigationSheet}><SheetHeader><SheetTitle>待办导航</SheetTitle></SheetHeader><NavigationContents activePage={activePage} onNavigate={onNavigate} showPrimaryNavigation closeSheet={() => onOpenChange(false)} /></SheetContent></Sheet></>; }
export function TodoNavigationTrigger({ onClick }: { onClick: () => void }) { return <Button variant="ghost" size="icon-sm" aria-label="打开待办导航" onClick={onClick}><Menu /></Button>; }
