import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { MobilePrimaryNavigation } from '../MobilePrimaryNavigation';
import type { AppPage } from '../AppRail';
import styles from './index.module.css';

interface TodoNavigationProps {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function NavigationContents({
  activePage,
  onNavigate,
  showPrimaryNavigation,
}: Pick<TodoNavigationProps, 'activePage' | 'onNavigate'> & { showPrimaryNavigation: boolean }) {
  return (
    <div className={styles.navigationContents}>
      {showPrimaryNavigation && <MobilePrimaryNavigation activePage={activePage} onNavigate={onNavigate} />}
      <div className={styles.navigationPlaceholder} aria-label="待办导航">
        <span>待办事项</span>
      </div>
    </div>
  );
}

export function TodoNavigation({ activePage, onNavigate, open, onOpenChange }: TodoNavigationProps) {
  return (
    <>
      <aside className={styles.desktopNavigation} aria-label="待办导航">
        <NavigationContents activePage={activePage} onNavigate={onNavigate} showPrimaryNavigation={false} />
      </aside>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className={styles.navigationSheet}>
          <SheetHeader>
            <SheetTitle>待办导航</SheetTitle>
          </SheetHeader>
          <NavigationContents activePage={activePage} onNavigate={onNavigate} showPrimaryNavigation />
        </SheetContent>
      </Sheet>
    </>
  );
}

export function TodoNavigationTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label="打开待办导航" onClick={onClick}>
      <Menu />
    </Button>
  );
}
