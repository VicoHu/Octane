import React, { useEffect, useState } from 'react';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useCrypto } from '@/store/useCrypto';
import { Sidebar } from './components/Sidebar';
import { Content } from './components/Content';
import { UnlockModal } from '@/components/UnlockModal';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { DB_NAME } from '@/shared/types';
import { IMPORT_CHANNEL_NAME, type DbChangeEvent } from '@/shared/db/database';
import { useOpenTabs } from './hooks/useOpenTabs';
import '@/styles/global.css';
import './App.css';
import '@/styles/semi-theme-override.css';
import { Button } from '@/components/ui/button';
import { Home, Menu, Search, ExternalLink, X } from 'lucide-react';

const App: React.FC = () => {
  const loadWorkspaces = useWorkspace((s) => s.loadWorkspaces);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const loadBookmarks = useBookmarks((s) => s.loadBookmarks);
  const checkStatus = useCrypto((s) => s.checkStatus);
  const openTabs = useOpenTabs();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
      <div className="app-frame">
      <div className="app-layout">
        <aside className="app-rail" aria-label="主导航">
          <img className="app-rail-logo" src="/icons/icon-128.png" alt="Octane" />
          <div className="app-rail-group">
            <Button variant="ghost" size="icon" className="app-rail-button is-active" aria-label="主页">
              <Home />
            </Button>
            <Button variant="ghost" size="icon" className="app-rail-button" aria-label="搜索">
              <Search />
            </Button>
            <Button variant="ghost" size="icon" className="app-rail-button" aria-label="打开标签页">
              <ExternalLink />
            </Button>
          </div>
          <div className="app-rail-spacer" />
          <div className="app-rail-avatar" aria-hidden="true" />
        </aside>
        <aside className={`app-sidebar${mobileNavOpen ? ' is-mobile-open' : ''}`} id="sidebar-container">
          <div className="app-sidebar-mobile-header">
            <span>导航</span>
            <Button variant="ghost" size="icon-sm" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}>
              <X />
            </Button>
          </div>
          <Sidebar openTabs={openTabs} />
        </aside>
        {mobileNavOpen && <button className="app-mobile-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
        <main className="app-content" data-mobile-nav-open={mobileNavOpen}>
          <Button
            variant="outline"
            size="icon"
            className="app-mobile-menu"
            aria-label="打开导航"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu />
          </Button>
          <Content openTabs={openTabs} />
        </main>
      </div>
      </div>
    </>
  );
};

export default App;
