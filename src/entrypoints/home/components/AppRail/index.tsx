import type { ReactNode } from 'react';
import { CheckSquare, ExternalLink, Home, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/store/useWorkspace';
import { Spinner } from '@/components/ui/spinner';
import { WorkspaceCreateButton } from '../WorkspaceCreateButton';

export type AppPage = 'home' | 'tasks';

interface AppRailProps {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  onWorkspaceSelect: (workspaceId: string) => void;
}

export function AppRail({ activePage, onNavigate, onWorkspaceSelect }: AppRailProps) {
  const workspaces = useWorkspace((state) => state.workspaces);
  const currentWorkspaceId = useWorkspace((state) => state.currentWorkspaceId);
  const switching = useWorkspace((state) => state.switching);

  return (
    <aside className="app-rail dark" aria-label="主导航">
      <img className="app-rail-logo" src="/icons/icon-128.png" alt="Octane" />
      <TooltipProvider>
        <div className="app-rail-workspaces">
          <div className="app-rail-workspace-list">
            {workspaces.map((workspace) => {
              const isCurrent = workspace.id === currentWorkspaceId;
              const isSwitching = switching?.toId === workspace.id;

              return (
                <Tooltip key={workspace.id}>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          'app-rail-button app-rail-workspace-button',
                          isCurrent && 'is-current',
                        )}
                        aria-label={`切换到工作区 ${workspace.name}`}
                        aria-pressed={isCurrent}
                        disabled={!!switching}
                        onClick={() => onWorkspaceSelect(workspace.id)}
                      />
                    }
                  >
                    <span className="app-rail-workspace-icon" aria-hidden="true">
                      {isSwitching ? <Spinner /> : workspace.icon}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" role="tooltip">{workspace.name}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <WorkspaceCreateButton className="app-rail-button app-rail-workspace-create" />
        </div>
        <Separator className="app-rail-separator" />
        <div className="app-rail-group">
          <PrimaryNavigationButton
            active={activePage === 'home'}
            label="主页"
            onClick={() => onNavigate('home')}
          >
            <Home />
          </PrimaryNavigationButton>
          <PrimaryNavigationButton
            active={activePage === 'tasks'}
            label="待办事项"
            onClick={() => onNavigate('tasks')}
          >
            <CheckSquare />
          </PrimaryNavigationButton>
          <Button variant="ghost" size="icon" className="app-rail-button" aria-label="搜索" disabled>
            <Search />
          </Button>
          <Button variant="ghost" size="icon" className="app-rail-button" aria-label="打开标签页" disabled>
            <ExternalLink />
          </Button>
        </div>
      </TooltipProvider>
      <div className="app-rail-spacer" />
      <div className="app-rail-avatar" aria-hidden="true" />
    </aside>
  );
}

function PrimaryNavigationButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn('app-rail-button', active && 'is-active')}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right" role="tooltip">{label}</TooltipContent>
    </Tooltip>
  );
}
