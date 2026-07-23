import React, { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Toast } from '@/components/ui/toast';
import { useWorkspace } from '@/store/useWorkspace';
import { IconPicker } from '@/components/IconPicker';
import { GripButton } from '../dnd/GripButton';
import { SortableOverlay } from '../dnd/SortableOverlay';
import { restrictToVerticalAxis, toVerticalTransform } from '../dnd/modifiers';
import { Trash2 } from 'lucide-react';
import dndStyles from '../dnd/dnd.module.css';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import styles from './index.module.css';

interface EntityEditRowProps {
  id: string;
  name: string;
  icon: string;
  onSave: (id: string, updates: { name: string; icon: string }) => Promise<void> | void;
  actions?: React.ReactNode;
}

interface WorkspaceDeleteActionProps {
  name: string;
  onDelete: () => Promise<boolean>;
  disabled?: boolean;
}

const WorkspaceDeleteAction: React.FC<WorkspaceDeleteActionProps> = ({ name, onDelete, disabled }) => {
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <AlertDialogTrigger
              render={
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-sm"
                  aria-label={`删除工作区 ${name}`}
                  disabled={disabled}
                />
              }
            />
          }
        >
          <Trash2 />
        </TooltipTrigger>
        <TooltipContent>删除工作区</TooltipContent>
      </Tooltip>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除工作区</AlertDialogTitle>
          <AlertDialogDescription>
            {`永久删除工作区「${name}」及其全部内容，此操作不可撤销。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={async () => {
              const deleted = await onDelete();
              if (deleted) setOpen(false);
            }}
          >
            删除工作区
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

/** 单个 workspace/category 的可编辑行：点击展开名称 + 图标编辑。 */
const EntityEditRow: React.FC<EntityEditRowProps> = ({ id, name, icon, onSave, actions }) => {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftIcon, setDraftIcon] = useState(icon);

  const enterEdit = () => {
    setDraftName(name);
    setDraftIcon(icon);
    setEditing(true);
  };

  const handleSave = async () => {
    await onSave(id, { name: draftName.trim() || name, icon: draftIcon });
    setEditing(false);
  };

  return (
    <li className={styles.item}>
      {!editing ? (
        <div className={styles.displayRow}>
          <Button
            type="button"
            variant="ghost"
            className={styles.itemDisplay}
            aria-label={`编辑 ${name}`}
            onClick={enterEdit}
          >
            <span className={styles.itemIcon}>{icon}</span>
            <span>{name}</span>
          </Button>
          {actions && <div className={styles.rowActions}>{actions}</div>}
        </div>
      ) : (
        <div className={styles.editRow}>
          {/* 编辑态 Input data-no-dnd:防拖拽时 Input 聚焦/输入冲突(D6 grip 收敛后额外保险) */}
          <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="名称" data-no-dnd />
          <IconPicker value={draftIcon} onChange={setDraftIcon} />
          <div className={styles.editActions}>
            <Button size="sm" variant="default" onClick={handleSave}>保存</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>取消</Button>
          </div>
        </div>
      )}
    </li>
  );
};

interface SortableWorkspaceProps {
  id: string;
  name: string;
  icon: string;
  onSave: (id: string, updates: { name: string; icon: string }) => Promise<void> | void;
  onDelete: () => Promise<boolean>;
  /** 连发锁:drop 写入期间禁用该 item 拖拽 */
  disabled?: boolean;
}

/**
 * SortableWorkspace —— workspace 行的拖拽 wrapper(T8)。
 *
 * - D6:listeners 收敛到 grip GripButton(常驻 gripAlwaysVisible,整理语境),EntityEditRow 主操作保留。
 * - 1D verticalListSortingStrategy:wrapper 承载 setNodeRef + translateY 让位。
 * - 浅色面(Modal 白底)overlay tone=light 炭灰描边;DragOverlay portal body z-index 1005 > Modal 1000。
 * - isDragging 原位 visibility:hidden 保留行高(measured rect 占位),DragOverlay 副本浮于指针。
 */
const SortableWorkspace: React.FC<SortableWorkspaceProps> = ({ id, name, icon, onSave, onDelete, disabled }) => {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      role="presentation"
      className={`${styles.sortableRow}${isDragging ? ` ${dndStyles.placeholder}` : ''}`}
      style={{ transform: CSS.Transform.toString(toVerticalTransform(transform)), transition }}
    >
      <div className={`${styles.rowInner}${isDragging ? ` ${styles.dragGhost}` : ''}`}>
        <span className={styles.gripSlot}>
          <GripButton listeners={listeners} className={dndStyles.gripAlwaysVisible} />
        </span>
        <div className={styles.entityWrap}>
          <EntityEditRow
            id={id}
            name={name}
            icon={icon}
            onSave={onSave}
            actions={<WorkspaceDeleteAction name={name} onDelete={onDelete} disabled={disabled} />}
          />
        </div>
      </div>
    </div>
  );
};

interface ManagePanelProps {
  visible: boolean;
  onCancel: () => void;
}

/**
 * 工作区与分类管理面板（居中 Modal）。
 * 列出所有 workspace 与当前 workspace 的 category,点击进入编辑态
 * 修改名称与图标,保存调用 store update action。
 *
 * T8:workspace 列表接 DndContext(1D vertical)+ SortableWorkspace 常驻 grip;
 * category 列表不排序(波3 仅 workspace 层);onDragEnd 调 reorderWorkspaces。
 */
export const ManagePanel: React.FC<ManagePanelProps> = ({ visible, onCancel }) => {
  const workspaces = useWorkspace((s) => s.workspaces);
  const categories = useWorkspace((s) => s.categories);
  const updateWorkspace = useWorkspace((s) => s.updateWorkspace);
  const updateCategory = useWorkspace((s) => s.updateCategory);
  const reorderWorkspaces = useWorkspace((s) => s.reorderWorkspaces);
  const deleteWorkspace = useWorkspace((s) => s.deleteWorkspace);

  // === T8 workspace 拖拽 ===
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeWsId, setActiveWsId] = useState<string | null>(null);
  const activeWs = activeWsId ? workspaces.find((w) => w.id === activeWsId) ?? null : null;
  const wsListRef = useRef<HTMLDivElement>(null);
  const [workspaceListWidth, setWorkspaceListWidth] = useState<number | null>(null);
  // 连发锁:drop 写入期间锁定 workspace 容器(防 store 乐观重排与回滚竞态)
  const [reordering, setReordering] = useState(false);
  const [deletingWsId, setDeletingWsId] = useState<string | null>(null);
  // M5 非法落区:over=null(拖出 wsList)→ overlay 降透明 .5
  const [invalid, setInvalid] = useState(false);

  const handleDeleteWorkspace = async (id: string): Promise<boolean> => {
    setDeletingWsId(id);
    try {
      await deleteWorkspace(id);
      Toast.success('工作区已删除');
      return true;
    } catch (e) {
      Toast.error('删除失败：' + (e as Error).message);
      return false;
    } finally {
      setDeletingWsId(null);
    }
  };

  const handleDragStart = (e: DragStartEvent) => {
    setActiveWsId(String(e.active.id));
    const list = wsListRef.current;
    if (list) {
      const width = list.getBoundingClientRect().width || list.offsetWidth;
      setWorkspaceListWidth(width || null);
    }
  };
  const handleDragOver = (e: DragOverEvent) => {
    // 只判非法落区(拖出容器 over=null);落点指示由 placeholder 虚线框承担(用户真机决策去绿线)
    if (!e.over) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
  };
  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveWsId(null);
    setWorkspaceListWidth(null);
    setInvalid(false);
    if (!over || active.id === over.id) return;
    const oldIndex = workspaces.findIndex((w) => w.id === active.id);
    const newIndex = workspaces.findIndex((w) => w.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const orderedIds = arrayMove(workspaces, oldIndex, newIndex).map((w) => w.id);
    setReordering(true);
    try {
      await reorderWorkspaces(orderedIds);
    } catch {
      Toast.error('排序未保存，请重试');
    } finally {
      setReordering(false);
    }
  };

  return (
    <Dialog
      open={visible}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>管理工作区与分类</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto">
      <div className={styles.section}>工作区</div>
      {workspaces.length > 1 ? (
        <DndContext
          sensors={sensors}
          modifiers={[restrictToVerticalAxis]}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => { setActiveWsId(null); setWorkspaceListWidth(null); setInvalid(false); }}
        >
          <div ref={wsListRef} className={styles.wsList} role="list">
            <SortableContext
              items={workspaces.map((w) => w.id)}
              strategy={verticalListSortingStrategy}
            >
              {workspaces.map((w) => (
                <SortableWorkspace
                  key={w.id}
                  id={w.id}
                  name={w.name}
                  icon={w.icon}
                  onSave={updateWorkspace}
                  onDelete={() => handleDeleteWorkspace(w.id)}
                  disabled={reordering || deletingWsId !== null}
                />
              ))}
            </SortableContext>
          </div>
          <SortableOverlay tone="light" invalid={invalid}>
            {activeWs && (
              <div
                className={styles.ghostRow}
                style={workspaceListWidth ? { width: `${workspaceListWidth}px` } : undefined}
              >
                <span className={styles.itemIcon}>{activeWs.icon}</span>
                <span>{activeWs.name}</span>
              </div>
            )}
          </SortableOverlay>
        </DndContext>
      ) : (
        <ul className={styles.entityList}>
          {workspaces.map((w) => (
            <EntityEditRow
              key={w.id}
              id={w.id}
              name={w.name}
              icon={w.icon}
              onSave={updateWorkspace}
              actions={<WorkspaceDeleteAction name={w.name} onDelete={() => handleDeleteWorkspace(w.id)} disabled={deletingWsId !== null} />}
            />
          ))}
        </ul>
      )}

      <div className={styles.section}>分类（当前工作区）</div>
      {categories.length === 0 ? (
        <div className="text-xs text-muted-foreground">暂无分类</div>
      ) : (
        <ul className={styles.entityList}>
          {categories.map((c) => (
            <EntityEditRow key={c.id} id={c.id} name={c.name} icon={c.icon} onSave={updateCategory} />
          ))}
        </ul>
      )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
