import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sidebar } from './Sidebar';
import { Content } from './Content';
import { MobilePrimaryNavigation } from './MobilePrimaryNavigation';
import type { AppPage } from './AppRail';
import type { OpenTab } from '../hooks/useOpenTabs';

interface HomePageShellProps {
  active: boolean;
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  openTabs: OpenTab[];
}

/** 始终保留书签页面 subtree，避免页面切换丢失本地视图与滚动状态。 */
export function HomePageShell({ active, activePage, onNavigate, openTabs }: HomePageShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navigate = (page: AppPage) => {
    setMobileNavOpen(false);
    onNavigate(page);
  };

  return (
    <div hidden={!active} inert={!active} aria-hidden={!active} className="home-page-shell">
      <aside className={`app-sidebar${mobileNavOpen ? ' is-mobile-open' : ''}`} id="sidebar-container">
        <div className="app-sidebar-mobile-header">
          <span>导航</span>
          <Button variant="ghost" size="icon-sm" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}>
            <X />
          </Button>
        </div>
        <MobilePrimaryNavigation activePage={activePage} onNavigate={navigate} />
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
        <Content openTabs={openTabs} active={active} />
      </main>
    </div>
  );
}
