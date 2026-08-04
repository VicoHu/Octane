import { CheckSquare, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AppPage } from './AppRail';

interface MobilePrimaryNavigationProps {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
}

/** 移动端只暴露一级页面切换，业务导航仍由各页面自行负责。 */
export function MobilePrimaryNavigation({ activePage, onNavigate }: MobilePrimaryNavigationProps) {
  return (
    <nav className="mobile-primary-navigation" aria-label="主页面导航">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('mobile-primary-navigation-button', activePage === 'home' && 'is-active')}
        aria-current={activePage === 'home' ? 'page' : undefined}
        onClick={() => onNavigate('home')}
      >
        <Home data-icon="inline-start" />
        主页
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('mobile-primary-navigation-button', activePage === 'tasks' && 'is-active')}
        aria-current={activePage === 'tasks' ? 'page' : undefined}
        onClick={() => onNavigate('tasks')}
      >
        <CheckSquare data-icon="inline-start" />
        待办事项
      </Button>
    </nav>
  );
}
