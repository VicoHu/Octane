import React, { useEffect } from 'react';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useCrypto } from '@/store/useCrypto';
import { Sidebar } from '@/newtab/components/Sidebar';
import { Content } from '@/newtab/components/Content';
import { UnlockModal } from '@/newtab/components/UnlockModal';
import '@/styles/global.css';
import '@/newtab/App.css';

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
