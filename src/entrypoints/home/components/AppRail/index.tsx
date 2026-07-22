import { ExternalLink, Home, Search } from 'lucide-react';
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
import { switchWorkspace } from '@/entrypoints/home/utils/workspaceSwitcher';
import { Spinner } from '@/components/ui/spinner';
import { WorkspaceCreateButton } from '../WorkspaceCreateButton';

export function AppRail() {
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
                        onClick={() => void switchWorkspace(workspace.id)}
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
          <Button variant="ghost" size="icon" className="app-rail-button is-active" aria-label="主页">
            <Home />
          </Button>
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
