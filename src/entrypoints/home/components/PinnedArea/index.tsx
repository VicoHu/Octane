import React, { useEffect, useState, useRef } from 'react';
import { Modal, Input, Toast } from '@douyinfe/semi-ui';
import { IconPlus, IconClose } from '@douyinfe/semi-icons';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { useFavicon } from '@/hooks/useFavicon';
import { BookmarkFaviconPreview } from '@/components/BookmarkFaviconPreview';
import { PINNED_TAB_CAP } from '@/services/PinnedTabService';
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
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PinnedTab } from '@/shared/types';
import styles from './index.module.css';

interface PinnedAreaProps {
  workspaceId: string;
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
export function PinnedArea({ workspaceId }: PinnedAreaProps) {
  const pinnedTabs = usePinnedTabs((s) => s.pinnedTabs);
  const loadPinnedTabs = usePinnedTabs((s) => s.loadPinnedTabs);
  const createPinnedTab = usePinnedTabs((s) => s.createPinnedTab);
  const deletePinnedTab = usePinnedTabs((s) => s.deletePinnedTab);
  const reorderPinnedTabs = usePinnedTabs((s) => s.reorderPinnedTabs);

  useEffect(() => {
    loadPinnedTabs(workspaceId);
  }, [workspaceId, loadPinnedTabs]);

  const [modalOpen, setModalOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');

  // === T7 chip 拖拽 ===
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const activePin = activePinId ? pinnedTabs.find((p) => p.id === activePinId) ?? null : null;
  // 连发锁:drop 写入期间锁定 chip 容器(防 store 乐观重排与回滚竞态)
  const [reordering, setReordering] = useState(false);
  // D7 插入线:chipRow 容器 ref 定位,axis/position/top/left 相对容器
  const containerRef = useRef<HTMLDivElement>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    axis: 'horizontal' | 'vertical';
    position: 'before' | 'after';
    top: number;
    left: number;
  } | null>(null);
  // M5 非法落区:over=null(拖出 chipRow)→ overlay 降透明 .5 + not-allowed
  const [invalid, setInvalid] = useState(false);

  const handleDragStart = (e: DragStartEvent) => setActivePinId(String(e.active.id));
  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) {
      // 拖出容器(无 collision 命中)→ 非法落区,清插入线
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
    const { axis, position } = computeDropIndicator({ activeRect, overRect, layout: '2d' });
    const cRect = containerEl.getBoundingClientRect();
    setDropIndicator({
      axis,
      position,
      top: overRect.top - cRect.top + (axis === 'horizontal' && position === 'after' ? overRect.height : 0),
      left: overRect.left - cRect.left + (axis === 'vertical' && position === 'after' ? overRect.width : 0),
    });
  };
  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActivePinId(null);
    setDropIndicator(null);
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
    setUrl('');
    setName('');
    setModalOpen(true);
  };

  const handleCreate = async () => {
    const u = url.trim();
    const n = name.trim();
    if (!u || !n) return;
    try {
      await createPinnedTab(workspaceId, { url: u, name: n });
      Toast.success(`已常驻「${n}」`);
      setModalOpen(false);
    } catch (e) {
      // cap/dedup 错误：Toast 提示，不抛到 UI（store 已保持切片不变）
      Toast.warning((e as Error).message);
    }
  };

  return (
    <div className={styles.area}>
      <div className={styles.sectionLabel}>常驻</div>
      {pinnedTabs.length === 0 && (
        <div className={styles.emptyHint}>点 + 添加常驻标签</div>
      )}
      <div className={styles.chipRow} ref={containerRef}>
        {pinnedTabs.length > 1 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => { setActivePinId(null); setDropIndicator(null); setInvalid(false); }}
          >
            <SortableContext
              items={pinnedTabs.map((p) => p.id)}
              strategy={rectSortingStrategy}
            >
              {pinnedTabs.map((pin) => (
                <SortablePinChip key={pin.id} pin={pin} disabled={reordering} onDelete={() => handleDelete(pin.id)} />
              ))}
            </SortableContext>
            {dropIndicator && (
              <div
                className={`${dndStyles.dropLine} ${dropIndicator.axis === 'horizontal' ? dndStyles.dropLineHorizontal : dndStyles.dropLineVertical}`}
                style={dropIndicator.axis === 'horizontal' ? { top: dropIndicator.top - 1.5 } : { left: dropIndicator.left - 1.5 }}
                aria-hidden="true"
              />
            )}
            <SortableOverlay tone="dark" invalid={invalid}>
              {activePin && <PinChip pin={activePin} onDelete={() => {}} />}
            </SortableOverlay>
          </DndContext>
        ) : (
          pinnedTabs.map((pin) => (
            <PinChip key={pin.id} pin={pin} onDelete={() => handleDelete(pin.id)} />
          ))
        )}
        <button
          type="button"
          className={styles.addBtn}
          aria-label="添加常驻标签"
          disabled={atCap}
          onClick={handleAddClick}
        >
          <IconPlus />
        </button>
      </div>

      <Modal
        title="添加常驻标签"
        visible={modalOpen}
        onOk={handleCreate}
        onCancel={() => setModalOpen(false)}
        okText="确定"
        maskClosable={false}
      >
        <div className={styles.modalForm}>
          <Input placeholder="链接 URL" value={url} onChange={setUrl} aria-label="常驻标签 URL" />
          <Input placeholder="名称" value={name} onChange={setName} aria-label="常驻标签名称" />
          <div className={styles.previewRow}>
            <BookmarkFaviconPreview url={url} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 单个常驻 chip:favicon 上 / 名称下,hover 出 × 删除 + grip(可选,sortable 注入) */
function PinChip({
  pin,
  onDelete,
  grip,
}: {
  pin: PinnedTab;
  onDelete: () => void;
  /** 拖拽手柄 slot(可选;由 SortablePinChip 注入 GripButton,纯 PinChip 不传) */
  grip?: React.ReactNode;
}) {
  const faviconSrc = useFavicon(pin.url);
  const src = faviconSrc?.src;
  const initial = (pin.name.charAt(0) || '?').toUpperCase();

  return (
    <div className={styles.chipWrap}>
      {grip && <span className={styles.gripSlot}>{grip}</span>}
      <button
        type="button"
        className={styles.chip}
        aria-label={`打开 ${pin.name}`}
        title={pin.name}
        onClick={() => window.open(pin.url, '_blank')}
      >
        <div className={styles.favicon}>
          {src ? (
            <img src={src} alt="" className={styles.faviconImg} />
          ) : (
            <span className={styles.fallback}>{initial}</span>
          )}
        </div>
        <span className={styles.chipName}>{pin.name}</span>
      </button>
      <button
        type="button"
        className={styles.deleteBtn}
        aria-label={`取消常驻 ${pin.name}`}
        data-no-dnd
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <IconClose />
      </button>
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
