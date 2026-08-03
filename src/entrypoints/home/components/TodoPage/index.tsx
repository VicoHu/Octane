import { useEffect, useMemo, useState } from 'react';
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
import { TaskDetailPane } from './TaskDetailPane';
import { TaskListPane } from './TaskListPane';
import { TodoNavigation } from './TodoNavigation';
import styles from './index.module.css';

interface TodoPageProps {
  active: boolean;
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
}

function percentFromLayout(layout: Record<string, number>): number | null {
  const list = layout['task-list'];
  const detail = layout['task-detail'];
  if (typeof list !== 'number' || typeof detail !== 'number' || list + detail <= 0) return null;
  return Math.round((list / (list + detail)) * 100);
}

/** 待办页面骨架：数据加载与响应式 pane 编排在此集中，业务 UI 后续逐步填充。 */
export function TodoPage({ active, activePage, onNavigate }: TodoPageProps) {
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
        onNavigate={onNavigate}
        open={todoNavOpen}
        onOpenChange={setTodoNavOpen}
      />
      {isMobile ? (
        mobileDetailOpen ? (
          <TaskDetailPane mobile onBack={() => setMobileDetailOpen(false)} />
        ) : (
          <TaskListPane onOpenNavigation={() => setTodoNavOpen(true)} />
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
            <TaskListPane onOpenNavigation={() => setTodoNavOpen(true)} />
          </ResizablePanel>
          <ResizableHandle className={styles.resizeHandle} onDoubleClick={resetSplit} />
          <ResizablePanel id="task-detail" defaultSize={`${100 - splitPercent}%`} minSize={minDetailSize}>
            <TaskDetailPane mobile={false} onBack={() => undefined} />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
