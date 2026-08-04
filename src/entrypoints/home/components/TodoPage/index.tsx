import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { loadTodoUiPreferences, saveDetailSplitPercent } from '@/shared/todoUiPreferences';
import { useTodoData } from '@/store/useTodoData';
import { useTodoView } from '@/store/useTodoView';
import { useWorkspace } from '@/store/useWorkspace';
import { useLocalToday } from '../../hooks/useLocalToday';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import type { AppPage } from '../AppRail';
import { TaskDetailPane, type TaskDetailPaneHandle } from './TaskDetailPane';
import { TaskListPane } from './TaskListPane';
import { TodoNavigation } from './TodoNavigation';
import styles from './index.module.css';

type DeferredAction = () => void | Promise<void>;
export type TodoLeaveGuard = (action: DeferredAction) => Promise<void>;

interface TodoPageProps {
  active: boolean;
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  onRegisterLeaveGuard?: (guard: TodoLeaveGuard | null) => void;
}

function percentFromLayout(layout: Record<string, number>): number | null {
  const list = layout['task-list'];
  const detail = layout['task-detail'];
  if (typeof list !== 'number' || typeof detail !== 'number' || list + detail <= 0) return null;
  return Math.round((list / (list + detail)) * 100);
}

/** 待办页面集中编排响应式 pane、数据加载和详情草稿导航门控。 */
export function TodoPage({ active, activePage, onNavigate, onRegisterLeaveGuard }: TodoPageProps) {
  const isMobile = useMediaQuery('max-width:760px');
  const isWideDesktop = useMediaQuery('min-width:1200px');
  const today = useLocalToday();
  const currentWorkspaceId = useWorkspace((state) => state.currentWorkspaceId);
  const scopeMode = useTodoView((state) => state.scopeMode);
  const view = useTodoView((state) => state.view);
  const statusFilter = useTodoView((state) => state.statusFilter);
  const priorityFilter = useTodoView((state) => state.priorityFilter);
  const searchQuery = useTodoView((state) => state.searchQuery);
  const sortMode = useTodoView((state) => state.sortMode);
  const mobileDetailOpen = useTodoView((state) => state.mobileDetailOpen);
  const todoNavOpen = useTodoView((state) => state.todoNavOpen);
  const setTodoNavOpen = useTodoView((state) => state.setTodoNavOpen);
  const setMobileDetailOpen = useTodoView((state) => state.setMobileDetailOpen);
  const setDetailSplitPercent = useTodoView((state) => state.setDetailSplitPercent);
  const invalidated = useTodoData((state) => state.invalidated);
  const [splitPercent, setSplitPercent] = useState(50);
  const detailRef = useRef<TaskDetailPaneHandle>(null);
  const [blockedAction, setBlockedAction] = useState<DeferredAction | null>(null);

  const scope = useMemo(
    () => (scopeMode === 'all' ? { kind: 'all' as const } : currentWorkspaceId ? {
      kind: 'workspace' as const,
      workspaceId: currentWorkspaceId,
    } : null),
    [currentWorkspaceId, scopeMode],
  );

  useEffect(() => {
    let mounted = true;
    void loadTodoUiPreferences().then(({ detailSplitPercent }) => {
      if (!mounted || detailSplitPercent === null) return;
      const value = Math.max(1, Math.min(99, detailSplitPercent));
      setSplitPercent(value);
      setDetailSplitPercent(value);
    });
    return () => {
      mounted = false;
    };
  }, [setDetailSplitPercent]);

  useEffect(() => {
    if (!active || !scope) return;
    const data = useTodoData.getState();
    void data.loadNavigation(scope, today);
    void data.loadQuery({
      scope,
      view,
      status: statusFilter,
      priority: priorityFilter,
      search: searchQuery,
      sort: sortMode,
      today,
    });
  }, [active, invalidated, priorityFilter, scope, searchQuery, sortMode, statusFilter, today, view]);

  const runAfterDraft = useCallback(async (action: DeferredAction) => {
    const committed = await (detailRef.current?.commitDraft() ?? Promise.resolve(true));
    if (committed) await action();
    else setBlockedAction(() => action);
  }, []);
  useEffect(() => {
    onRegisterLeaveGuard?.(runAfterDraft);
    return () => onRegisterLeaveGuard?.(null);
  }, [onRegisterLeaveGuard, runAfterDraft]);
  const selectTaskWithDraft = useCallback((taskId: string) => runAfterDraft(() => {
    useTodoView.getState().selectTask(taskId);
    useTodoView.getState().setMobileDetailOpen(true);
  }), [runAfterDraft]);
  const changeViewWithDraft = useCallback((nextView: typeof view) => runAfterDraft(() => {
    useTodoView.getState().setView(nextView);
    setTodoNavOpen(false);
  }), [runAfterDraft, setTodoNavOpen]);
  const changeScopeWithDraft = useCallback((nextScope: 'current' | 'all') => runAfterDraft(() => {
    useTodoView.getState().setScopeMode(nextScope);
  }), [runAfterDraft]);
  const commitBeforeTaskDelete = useCallback(async () => detailRef.current?.commitDraft() ?? true, []);
  const navigateFromTodo = useCallback((page: AppPage) => {
    if (page === 'tasks') { onNavigate(page); return; }
    void runAfterDraft(() => onNavigate(page));
  }, [onNavigate, runAfterDraft]);

  const saveSplit = (next: number) => {
    const clamped = Math.max(1, Math.min(99, next));
    setSplitPercent(clamped);
    setDetailSplitPercent(clamped);
    void saveDetailSplitPercent(clamped);
  };
  const resetSplit = () => saveSplit(50);
  const minListSize = isWideDesktop ? 340 : 280;
  const minDetailSize = isWideDesktop ? 380 : 360;

  return (
    <div className={styles.todoPage} data-layout={isMobile ? 'mobile' : isWideDesktop ? 'desktop' : 'compact'}>
      <TodoNavigation
        activePage={activePage}
        onNavigate={navigateFromTodo}
        open={todoNavOpen}
        onOpenChange={setTodoNavOpen}
        onViewChange={changeViewWithDraft}
        onScopeModeChange={changeScopeWithDraft}
      />
      {isMobile ? (
        mobileDetailOpen ? (
          <TaskDetailPane ref={detailRef} mobile onBack={() => void runAfterDraft(() => setMobileDetailOpen(false))} />
        ) : (
          <TaskListPane onOpenNavigation={() => setTodoNavOpen(true)} onTaskSelect={selectTaskWithDraft} onBeforeTaskDelete={commitBeforeTaskDelete} />
        )
      ) : (
        <ResizablePanelGroup
          key={`${isWideDesktop}-${splitPercent}`}
          orientation="horizontal"
          className={styles.resizableGroup}
          onLayoutChanged={(layout, meta) => {
            if (!meta.isUserInteraction) return;
            const next = percentFromLayout(layout);
            if (next !== null) saveSplit(next);
          }}
        >
          <ResizablePanel id="task-list" defaultSize={`${splitPercent}%`} minSize={minListSize}>
            <TaskListPane onOpenNavigation={() => setTodoNavOpen(true)} onTaskSelect={selectTaskWithDraft} onBeforeTaskDelete={commitBeforeTaskDelete} />
          </ResizablePanel>
          <ResizableHandle className={styles.resizeHandle} onDoubleClick={resetSplit} />
          <ResizablePanel id="task-detail" defaultSize={`${100 - splitPercent}%`} minSize={minDetailSize}>
            <TaskDetailPane ref={detailRef} mobile={false} onBack={() => undefined} onClose={() => void runAfterDraft(() => useTodoView.getState().selectTask(null))} />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      <AlertDialog open={blockedAction !== null} onOpenChange={(open) => { if (!open) setBlockedAction(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>未保存的修改</AlertDialogTitle><AlertDialogDescription>无法保存当前标题或描述。请重试，或放弃修改后继续。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>留在当前待办</AlertDialogCancel><AlertDialogAction variant="outline" onClick={() => void (async () => { if (await detailRef.current?.commitDraft()) { const action = blockedAction; setBlockedAction(null); await action?.(); } })()}>重试保存</AlertDialogAction><AlertDialogAction variant="destructive" onClick={() => { detailRef.current?.discardDraft(); const action = blockedAction; setBlockedAction(null); void action?.(); }}>放弃修改</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
