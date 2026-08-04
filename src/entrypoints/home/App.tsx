import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useCrypto } from '@/store/useCrypto';
import { useTodoData } from '@/store/useTodoData';
import { useTodoView } from '@/store/useTodoView';
import { AppRail, type AppPage } from './components/AppRail';
import { HomePageShell } from './components/HomePageShell';
import { TodoPage, type TodoLeaveGuard } from './components/TodoPage';
import { UnlockModal } from '@/components/UnlockModal';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { DB_NAME } from '@/shared/types';
import { IMPORT_CHANNEL_NAME, DB_CONTEXT_ID, type DbChangeEvent } from '@/shared/db/database';
import { useOpenTabs } from './hooks/useOpenTabs';
import { useRecoveryNotice } from './hooks/useRecoveryNotice';
import { switchWorkspace } from './utils/workspaceSwitcher';
import '@/styles/global.css';
import './App.css';
import '@/styles/semi-theme-override.css';

const TASK_STORES = new Set<DbChangeEvent['store']>([
  'taskLists',
  'tasks',
  'checklistItems',
  'taskTags',
  'taskTagAssignments',
]);

const App: React.FC = () => {
  const loadWorkspaces = useWorkspace((s) => s.loadWorkspaces);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const loadBookmarks = useBookmarks((s) => s.loadBookmarks);
  const checkStatus = useCrypto((s) => s.checkStatus);
  const openTabs = useOpenTabs();
  const [activePage, setActivePage] = useState<AppPage>('home');
  const [hasVisitedTasks, setHasVisitedTasks] = useState(false);
  const todoLeaveGuardRef = useRef<TodoLeaveGuard | null>(null);
  useRecoveryNotice();

  const registerTodoLeaveGuard = useCallback((guard: TodoLeaveGuard | null) => {
    todoLeaveGuardRef.current = guard;
  }, []);
  const navigate = (page: AppPage) => {
    const transition = () => {
      if (page === 'tasks') setHasVisitedTasks(true);
      setActivePage(page);
    };
    if (activePage === 'tasks' && page !== 'tasks' && todoLeaveGuardRef.current) {
      void todoLeaveGuardRef.current(transition);
      return;
    }
    transition();
  };

  const handleWorkspaceSelect = async (workspaceId: string) => {
    const transition = async () => {
      await switchWorkspace(workspaceId);
      if (activePage === 'tasks') {
        useTodoView.getState().onWorkspaceSelected(
          workspaceId,
          useTodoData.getState().detail?.task.workspaceId,
        );
      }
    };
    if (activePage === 'tasks' && todoLeaveGuardRef.current) {
      await todoLeaveGuardRef.current(transition);
      return;
    }
    await transition();
  };

  useEffect(() => {
    checkStatus();
    loadWorkspaces();
  }, [checkStatus, loadWorkspaces]);

  useEffect(() => {
    if (currentCategoryId) {
      loadBookmarks(currentCategoryId);
    }
  }, [currentCategoryId, loadBookmarks]);

  // 订阅全量导入事件：导入覆盖后（background 广播）整体 reload
  useEffect(() => {
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(IMPORT_CHANNEL_NAME) : null;
    const onMessage = async () => {
      checkStatus(); // salt 可能变更，重置解锁态
      await loadWorkspaces();
      // 兜底：loadWorkspaces 现从 storage 恢复 currentCategoryId（per-workspace last-cat）。
      // 自备份自恢复场景下若恢复的 ID 与当前一致 → useEffect([currentCategoryId]) 不触发 →
      // loadBookmarks 不调，书签列表陈旧。这里手动补一次。
      const cat = useWorkspace.getState().currentCategoryId;
      if (cat) loadBookmarks(cat);
      useTodoData.getState().invalidate();
      useTodoView.getState().selectTask(null);
    };
    channel?.addEventListener('message', onMessage);
    return () => {
      channel?.close();
    };
  }, [checkStatus, loadWorkspaces, loadBookmarks]);

  // 订阅跨 context 数据变更：sidepanel 等写入（putRecord/deleteRecord）后广播
  // {store, action}，按 store 分发刷新对应切片。getState() 在 callback 内取最新值，
  // 避免闭包陈旧（与上面 IMPORT_CHANNEL 订阅同一手法）。
  useEffect(() => {
    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DB_NAME) : null;
    const onMessage = async (e: MessageEvent<DbChangeEvent>) => {
      const { store, contextId } = e.data ?? {};
      if (TASK_STORES.has(store)) {
        // 跳过本上下文发起的广播：runMutation 已同步 refresh，避免重复全量查询。
        if (contextId !== DB_CONTEXT_ID) useTodoData.getState().invalidate();
      } else if (store === 'pinnedTabs') {
        const wsId = useWorkspace.getState().currentWorkspaceId;
        if (wsId) await usePinnedTabs.getState().loadPinnedTabs(wsId);
      } else if (store === 'bookmarks') {
        const cat = useWorkspace.getState().currentCategoryId;
        if (cat) await loadBookmarks(cat);
      } else if (store === 'workspaces' || store === 'categories') {
        // workspaces 表变更刷新工作区列表；categories 也走 loadWorkspaces——它会
        // 连带重载当前 ws 的 categories 并恢复 currentCategoryId（Sidebar 依赖此）。
        await loadWorkspaces();
      }
    };
    channel?.addEventListener('message', onMessage);
    return () => {
      channel?.close();
    };
  }, [loadWorkspaces, loadBookmarks]);

  return (
    <>
      <UnlockModal />
      <div className="app-frame">
        <div className="app-layout">
          <AppRail
            activePage={activePage}
            onNavigate={navigate}
            onWorkspaceSelect={(workspaceId) => void handleWorkspaceSelect(workspaceId)}
          />
          <HomePageShell
            active={activePage === 'home'}
            activePage={activePage}
            onNavigate={navigate}
            openTabs={openTabs}
          />
          {hasVisitedTasks && (
            <div
              hidden={activePage !== 'tasks'}
              inert={activePage !== 'tasks'}
              aria-hidden={activePage !== 'tasks'}
              className="todo-page-shell"
            >
              <TodoPage active={activePage === 'tasks'} activePage={activePage} onNavigate={navigate} onRegisterLeaveGuard={registerTodoLeaveGuard} />
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default App;
