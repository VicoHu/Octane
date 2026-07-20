import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { Plus, X } from 'lucide-react';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { useFavicon } from '@/hooks/useFavicon';
import { PINNED_TAB_CAP } from '@/services/PinnedTabService';
import { AddPinnedTabDialog } from '../AddPinnedTabDialog';
import { GripButton } from '../dnd/GripButton';
import { SortableOverlay } from '../dnd/SortableOverlay';
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
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PinnedTab } from '@/shared/types';
import type { OpenTab } from '../../hooks/useOpenTabs';
import { pickMostRecentMatchingTab } from '@/shared/tabs/matchUrl';
import styles from './index.module.css';

interface PinnedAreaProps {
  workspaceId: string;
  openTabs: OpenTab[];
}

/**
 * 常驻标签区（per-workspace 跨分类）。挂在 Sidebar 工作区切换下方、分类列表上方。
 *
 * - 数据：mount/workspaceId 变更时 loadPinnedTabs；跨 context 实时刷新由 home App 订阅 BroadcastChannel（T6）
 * - 空状态（D4=B）：始终渲染「常驻」标题 + 空提示，chip 行末位「+」按钮始终在
 * - chip：方向 A 方形（图标上/名称下），中性炭灰抬升面，不用绿（守 §2.3 绿色预算）
 * - 上限：PINNED_TAB_CAP=8，满则「+」disabled + Toast
 * - T7 拖拽:>1 chip 接 DndContext(2D rectSortingStrategy),grip 收敛(D6),深色面浅描边 overlay
 */
export function PinnedArea({ workspaceId, openTabs }: PinnedAreaProps) {
  const pinnedTabs = usePinnedTabs((s) => s.pinnedTabs);
  const loadPinnedTabs = usePinnedTabs((s) => s.loadPinnedTabs);
  const deletePinnedTab = usePinnedTabs((s) => s.deletePinnedTab);
  const reorderPinnedTabs = usePinnedTabs((s) => s.reorderPinnedTabs);

  useEffect(() => {
    loadPinnedTabs(workspaceId);
  }, [workspaceId, loadPinnedTabs]);

  const [addOpen, setAddOpen] = useState(false);

  // === T7 chip 拖拽 ===
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const activePin = activePinId ? pinnedTabs.find((p) => p.id === activePinId) ?? null : null;
  // 连发锁:drop 写入期间锁定 chip 容器(防 store 乐观重排与回滚竞态)
  const [reordering, setReordering] = useState(false);
  // M5 非法落区:over=null(拖出 chipRow)→ overlay 降透明 .5 + not-allowed
  const [invalid, setInvalid] = useState(false);

  const handleDragStart = (e: DragStartEvent) => setActivePinId(String(e.active.id));
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
    setActivePinId(null);
    setInvalid(false);
    if (!over || active.id === over.id) return;
    const oldIndex = pinnedTabs.findIndex((p) => p.id === active.id);
    const newIndex = pinnedTabs.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const orderedIds = arrayMove(pinnedTabs, oldIndex, newIndex).map((p) => p.id);
    setReordering(true);
    try {
      await reorderPinnedTabs(workspaceId, orderedIds);
    } catch {
      Toast.error('排序未保存，请重试');
    } finally {
      setReordering(false);
    }
  };

  const atCap = pinnedTabs.length >= PINNED_TAB_CAP;

  const handleDelete = (id: string) => {
    // 失败也给用户反馈，避免 unhandled rejection 静默
    deletePinnedTab(id).catch(() => Toast.error('删除失败，请重试'));
  };

  const handleAddClick = () => {
    if (atCap) {
      Toast.warning(`该工作区常驻标签已满 (${PINNED_TAB_CAP}/${PINNED_TAB_CAP})`);
      return;
    }
    setAddOpen(true);
  };

  return (
    <div className={styles.area}>
      <div className={styles.sectionLabel}>常驻</div>
      {pinnedTabs.length === 0 && (
        <div className={styles.emptyHint}>点 + 添加常驻标签</div>
      )}
      <div className={styles.chipRow}>
        {pinnedTabs.length > 1 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => { setActivePinId(null); setInvalid(false); }}
          >
            <SortableContext
              items={pinnedTabs.map((p) => p.id)}
              strategy={rectSortingStrategy}
            >
              {pinnedTabs.map((pin) => (
                <SortablePinChip key={pin.id} pin={pin} disabled={reordering} onDelete={() => handleDelete(pin.id)} />
              ))}
            </SortableContext>
            <SortableOverlay tone="dark" invalid={invalid}>
              {activePin && <PinChip pin={activePin} onDelete={() => {}} />}
            </SortableOverlay>
          </DndContext>
        ) : (
          pinnedTabs.map((pin) => {
            const matchedTab = pickMostRecentMatchingTab(openTabs, pin.url);
            return (
              <PinChip
                key={pin.id}
                pin={pin}
                runtimeFavIconUrl={matchedTab?.favIconUrl}
                onDelete={() => handleDelete(pin.id)}
              />
            );
          })
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={styles.addBtn}
          aria-label="添加常驻标签"
          disabled={atCap}
          onClick={handleAddClick}
        >
          <Plus />
        </Button>
      </div>

      <AddPinnedTabDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        workspaceId={workspaceId}
        initialUrl=""
        initialName=""
      />
    </div>
  );
}

/** 单个常驻 chip:favicon 上 / 名称下,hover 出 × 删除 + grip(可选,sortable 注入) */
function PinChip({
  pin,
  runtimeFavIconUrl,
  onDelete,
  grip,
}: {
  pin: PinnedTab;
  runtimeFavIconUrl?: string;
  onDelete: () => void;
  /** 拖拽手柄 slot(可选;由 SortablePinChip 注入 GripButton,纯 PinChip 不传) */
  grip?: React.ReactNode;
}) {
  const faviconSrc = useFavicon(pin.url, runtimeFavIconUrl);
  const src = faviconSrc?.src;
  const initial = (pin.name.charAt(0) || '?').toUpperCase();

  return (
    <div className={styles.chipWrap}>
      {grip && <span className={styles.gripSlot}>{grip}</span>}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={styles.chip}
        aria-label={`打开 ${pin.name}`}
        title={pin.name}
        onClick={() => window.open(pin.url, '_blank')}
      >
        <div className={styles.favicon}>
          {src ? (
            <img src={src} alt="" className={styles.faviconImg} onError={faviconSrc.onError} />
          ) : (
            <span className={styles.fallback}>{initial}</span>
          )}
        </div>
        <span className={styles.chipName}>{pin.name}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={styles.deleteBtn}
        aria-label={`取消常驻 ${pin.name}`}
        data-no-dnd
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <X />
      </Button>
    </div>
  );
}

/** SortablePinChip —— chip 拖拽 wrapper(T7)。D6:listeners 收敛到 grip,chip onClick(window.open)保留。
 *  isDragging 时原位 visibility:hidden 保留盒子(measured rect 占位),DragOverlay 副本浮于指针。 */
function SortablePinChip({ pin, onDelete, disabled }: { pin: PinnedTab; onDelete: () => void; disabled?: boolean }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pin.id, disabled });
  return (
    <div
      ref={setNodeRef}
      className={`${styles.sortableChip}${isDragging ? ` ${dndStyles.placeholder} ${dndStyles.placeholderDark}` : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className={`${styles.pinInner}${isDragging ? ` ${styles.dragGhost}` : ''}`}>
        <PinChip pin={pin} onDelete={onDelete} grip={<GripButton listeners={listeners} />} />
      </div>
    </div>
  );
}
