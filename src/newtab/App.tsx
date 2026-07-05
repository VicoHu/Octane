import React, { useEffect } from 'react';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useCrypto } from '@/store/useCrypto';
import { Sidebar } from '@/newtab/components/Sidebar';
import { Content } from '@/newtab/components/Content';
import { UnlockModal } from '@/newtab/components/UnlockModal';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { DB_NAME } from '@/shared/types';
import { IMPORT_CHANNEL_NAME, type DbChangeEvent } from '@/shared/db/database';
import '@/styles/global.css';
import '@/newtab/App.css';
import '@/styles/semi-theme-override.css';

const App: React.FC = () => {
  const loadWorkspaces = useWorkspace((s) => s.loadWorkspaces);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const loadBookmarks = useBookmarks((s) => s.loadBookmarks);
  const checkStatus = useCrypto((s) => s.checkStatus);

  useEffect(() => {
    checkStatus();
    loadWorkspaces();
  }, []);

  useEffect(() => {
    if (currentCategoryId) {
      loadBookmarks(currentCategoryId);
    }
  }, [currentCategoryId]);

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
      const { store } = e.data ?? {};
      if (store === 'pinnedTabs') {
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
      <div className="app-layout">
        <aside className="app-sidebar semi-always-dark" id="sidebar-container">
          <Sidebar />
        </aside>
        <main className="app-content">
          <Content />
        </main>
      </div>
    </>
  );
};

export default App;
