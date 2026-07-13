import React, { useState, useRef } from 'react';
import { Modal, Input, Button, Toast } from '@douyinfe/semi-ui';
import { useWorkspace } from '@/store/useWorkspace';
import { IconPicker } from '@/components/IconPicker';
import { GripButton } from '../dnd/GripButton';
import { SortableOverlay } from '../dnd/SortableOverlay';
import { computeDropIndicator } from '../dnd/computeDropIndicator';
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
}

/** 单个 workspace/category 的可编辑行：点击展开名称 + 图标编辑。 */
const EntityEditRow: React.FC<EntityEditRowProps> = ({ id, name, icon, onSave }) => {
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

  if (!editing) {
    return (
      <div className={styles.item}>
        <div className={styles.itemDisplay} onClick={enterEdit}>
          <span className={styles.itemIcon}>{icon}</span>
          <span>{name}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.item}>
      <div className={styles.editRow}>
        {/* 编辑态 Input data-no-dnd:防拖拽时 Input 聚焦/输入冲突(D6 grip 收敛后额外保险) */}
        <Input value={draftName} onChange={setDraftName} placeholder="名称" data-no-dnd />
        <IconPicker value={draftIcon} onChange={setDraftIcon} />
        <div className={styles.editActions}>
          <Button size="small" theme="solid" onClick={handleSave}>保存</Button>
          <Button size="small" onClick={() => setEditing(false)}>取消</Button>
        </div>
      </div>
    </div>
  );
};

interface SortableWorkspaceProps {
  id: string;
  name: string;
  icon: string;
  onSave: (id: string, updates: { name: string; icon: string }) => Promise<void> | void;
  /** 连发锁:drop 写入期间禁用该 item 拖拽 */
  disabled?: boolean;
}

/**
 * SortableWorkspace —— workspace 行的拖拽 wrapper(T8)。
 *
 * - D6:listeners 收敛到 grip GripButton(常驻 gripAlwaysVisible,整理语境),EntityEditRow onClick(enterEdit)保留。
 * - 1D verticalListSortingStrategy:wrapper 承载 setNodeRef + translateY 让位。
 * - 浅色面(Modal 白底)overlay tone=light 炭灰描边;DragOverlay portal body z-index 1005 > Modal 1000。
 * - isDragging 原位 visibility:hidden 保留行高(measured rect 占位),DragOverlay 副本浮于指针。
 */
const SortableWorkspace: React.FC<SortableWorkspaceProps> = ({ id, name, icon, onSave, disabled }) => {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      className={styles.sortableRow}
      style={{ transform: CSS.Transform.toString(transform), transition, visibility: isDragging ? 'hidden' : undefined }}
    >
      <span className={styles.gripSlot}>
        <GripButton listeners={listeners} className={dndStyles.gripAlwaysVisible} />
      </span>
      <div className={styles.entityWrap}>
        <EntityEditRow id={id} name={name} icon={icon} onSave={onSave} />
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

  // === T8 workspace 拖拽 ===
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeWsId, setActiveWsId] = useState<string | null>(null);
  const activeWs = activeWsId ? workspaces.find((w) => w.id === activeWsId) ?? null : null;
  // 连发锁:drop 写入期间锁定 workspace 容器(防 store 乐观重排与回滚竞态)
  const [reordering, setReordering] = useState(false);
  // D7 插入线:wsList 容器 ref 定位(1D 恒横向)
  const containerRef = useRef<HTMLDivElement>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    axis: 'horizontal' | 'vertical';
    position: 'before' | 'after';
    top: number;
    left: number;
  } | null>(null);
  // M5 非法落区:over=null(拖出 wsList)→ overlay 降透明 .5
  const [invalid, setInvalid] = useState(false);

  const handleDragStart = (e: DragStartEvent) => setActiveWsId(String(e.active.id));
  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) {
      setDropIndicator(null);
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (active.id === over.id) {
      setDropIndicator(null);
      return;
    }
    const activeRect = active.rect.current.translated;
    const overRect = over.rect;
    if (!activeRect || !overRect) return;
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const { position } = computeDropIndicator({ activeRect, overRect, layout: '1d' });
    const cRect = containerEl.getBoundingClientRect();
    setDropIndicator({
      axis: 'horizontal',
      position,
      top: overRect.top - cRect.top + (position === 'after' ? overRect.height : 0),
      left: 0,
    });
  };
  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveWsId(null);
    setDropIndicator(null);
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
    <Modal
      title="管理工作区与分类"
      visible={visible}
      onCancel={onCancel}
      centered
      size="medium"
      footer={null}
      bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
    >
      <div className={styles.section}>工作区</div>
      {workspaces.length > 1 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={() => { setActiveWsId(null); setDropIndicator(null); setInvalid(false); }}
        >
          <div ref={containerRef} className={styles.wsList}>
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
                  disabled={reordering}
                />
              ))}
            </SortableContext>
            {dropIndicator && (
              <div
                className={`${dndStyles.dropLine} ${dndStyles.dropLineHorizontal}`}
                style={{ top: dropIndicator.top - 1.5 }}
                aria-hidden="true"
              />
            )}
          </div>
          <SortableOverlay tone="light" invalid={invalid}>
            {activeWs && (
              <div className={styles.ghostRow}>
                <span className={styles.itemIcon}>{activeWs.icon}</span>
                <span>{activeWs.name}</span>
              </div>
            )}
          </SortableOverlay>
        </DndContext>
      ) : (
        workspaces.map((w) => (
          <EntityEditRow key={w.id} id={w.id} name={w.name} icon={w.icon} onSave={updateWorkspace} />
        ))
      )}

      <div className={styles.section}>分类（当前工作区）</div>
      {categories.length === 0 ? (
        <div style={{ color: 'var(--semi-color-text-2)', fontSize: 'var(--font-xs)' }}>暂无分类</div>
      ) : (
        categories.map((c) => (
          <EntityEditRow key={c.id} id={c.id} name={c.name} icon={c.icon} onSave={updateCategory} />
        ))
      )}
    </Modal>
  );
};
