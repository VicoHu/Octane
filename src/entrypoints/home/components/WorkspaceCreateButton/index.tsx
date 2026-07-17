import { useState } from 'react';
import { Plus } from 'lucide-react';
import { IconPicker } from '@/components/IconPicker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/store/useWorkspace';

interface WorkspaceCreateButtonProps {
  className?: string;
}

export function WorkspaceCreateButton({ className }: WorkspaceCreateButtonProps) {
  const createWorkspace = useWorkspace((state) => state.createWorkspace);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    await createWorkspace(trimmedName, icon);
    setName('');
    setIcon('📁');
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn(className)}
        aria-label="新建工作区"
        onClick={() => setOpen(true)}
      >
        <Plus />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建工作区</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="工作区名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreate();
            }}
          />
          <div className="mt-3">
            <IconPicker value={icon} onChange={setIcon} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => void handleCreate()}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
